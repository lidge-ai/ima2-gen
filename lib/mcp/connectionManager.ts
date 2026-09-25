import { randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { listProviders, resolveProviderEndpoint } from "./providerRegistry.js";
import { createServerOAuthProvider, type ServerOAuthProvider } from "./oauthProvider.js";
import { tombstoneTokenRecord } from "./tokenStore.js";
import { addCandidate, inspectRestore, isTerminalTransportError, markSessionInvalid, publicStatus, removeCandidate, runBounded, sameConnection } from "./connectionRuntime.js";
import type { McpConnectionIdentity, McpConnectionManagerOptions, PendingAuth, ProviderSession } from "./connectionRuntime.js";
import type { McpConnectionStatus, McpToolListing } from "./types.js";

function connectClient(
  client: Client,
  transport: StreamableHTTPClientTransport,
  requestOptions?: { signal?: AbortSignal; timeout?: number; maxTotalTimeout?: number },
): Promise<void> {
  const connect = client.connect.bind(client) as (
    nextTransport: StreamableHTTPClientTransport,
    options?: { signal?: AbortSignal; timeout?: number; maxTotalTimeout?: number },
  ) => Promise<void>;
  return requestOptions ? connect(transport, requestOptions) : connect(transport);
}
const DEFAULT_PENDING_AUTH_TTL_MS = 10 * 60 * 1000;
/** Cap on consecutive automatic reconnects without a successful real RPC (010-B). */
const MAX_AUTO_RECONNECTS = 3;
export class McpConnectionManager {
  private readonly sessions = new Map<string, ProviderSession>();
  private readonly pendingAuth = new Map<string, PendingAuth>();
  private readonly activeCallbacks = new Map<string, PendingAuth>();
  private readonly generations = new Map<string, number>();
  private readonly candidates = new Map<string, Set<StreamableHTTPClientTransport>>();
  private readonly connectFlights = new Map<string, { generation: number; promise: Promise<McpConnectionStatus> }>();
  private readonly resetFlights = new Map<string, Promise<void>>();
  private readonly refreshFlights = new Map<string, Promise<McpConnectionStatus>>();
  private readonly callbackFlights = new Map<string, { generation: number; promise: Promise<McpConnectionStatus> }>();
  private readonly disconnectFlights = new Map<string, Promise<McpConnectionStatus>>();
  private readonly disconnectIntents = new Set<string>();
  private readonly reconnectTimers = new Map<string, NodeJS.Timeout>();
  /** Consecutive auto-reconnects used per provider; reset only by real RPC
   *  success, explicit connect/OAuth callback, disconnect, or reset (010-B). */
  private readonly reconnectBudget = new Map<string, number>();
  private readonly restoreControllers = new Map<string, { generation: number; controller: AbortController }>();
  private epoch = 0;
  private shuttingDown = false;
  constructor(private readonly options: McpConnectionManagerOptions) {}
  private now(): number { return this.options.now?.() ?? Date.now(); }
  private generation(provider: string): number { return this.generations.get(provider) ?? 0; }
  private bumpGeneration(provider: string): number {
    const next = this.generation(provider) + 1;
    this.generations.set(provider, next);
    return next;
  }
  private makeTransport(endpoint: string, authProvider: ServerOAuthProvider): StreamableHTTPClientTransport {
    if (this.options.transportFactory) return this.options.transportFactory(endpoint, authProvider);
    return new StreamableHTTPClientTransport(new URL(endpoint), { authProvider });
  }
  private makeClient(): Client {
    if (this.options.clientFactory) return this.options.clientFactory();
    return new Client({ name: "ima2-gen", version: "2.x" }, { capabilities: {} });
  }
  private knownProvider(provider: string): { enabled: boolean } {
    const descriptor = listProviders(this.options.enabledProviders).find((entry) => entry.id === provider);
    if (!descriptor) throw new Error(`MCP_PROVIDER_UNKNOWN:${provider}`);
    return descriptor;
  }
  private mutableSession(provider: string): ProviderSession {
    let session = this.sessions.get(provider);
    if (!session) { session = { state: "disconnected" }; this.sessions.set(provider, session); }
    return session;
  }
  status(provider: string): McpConnectionStatus {
    this.sweepExpiredPendingAuth();
    const descriptor = this.knownProvider(provider);
    if (!descriptor.enabled) return publicStatus(provider);
    const session = this.sessions.get(provider);
    return publicStatus(provider, session);
  }
  /** Reap abandoned OAuth attempts: without a callback the pending entry, its
   *  candidate transport, and a stale auth_required session would otherwise
   *  linger for the process lifetime. Same teardown as rejectInvalidCallback. */
  private sweepExpiredPendingAuth(): void {
    const now = this.now();
    for (const [state, pending] of this.pendingAuth) {
      if (pending.expiresAt >= now) continue;
      this.pendingAuth.delete(state);
      removeCandidate(this.candidates, pending.provider, pending.transport);
      void pending.transport.close().catch(() => undefined);
      // Only a still-auth_required session belongs to the expired attempt — a
      // successful reconnect may already have attached a connected session.
      const session = this.sessions.get(pending.provider);
      if (session?.state === "auth_required" && this.isCurrent(pending.provider, pending.generation)) {
        this.markDisconnected(pending.provider);
      }
    }
  }
  /** A successful connect supersedes the provider's pending OAuth attempts;
   *  dropping them keeps their expiry from touching the attached session. */
  private dropProviderPendings(provider: string): void {
    for (const [state, pending] of this.pendingAuth) {
      if (pending.provider !== provider) continue;
      this.pendingAuth.delete(state);
      removeCandidate(this.candidates, provider, pending.transport);
      void pending.transport.close().catch(() => undefined);
    }
  }
  private isCurrent(provider: string, generation: number): boolean {
    return this.generation(provider) === generation && !this.disconnectIntents.has(provider);
  }
  async connect(provider: string): Promise<McpConnectionStatus> {
    if (this.shuttingDown) throw new Error("MCP_SHUTTING_DOWN");
    const endpoint = resolveProviderEndpoint(provider, this.options.enabledProviders);
    this.reconnectBudget.delete(provider); // explicit user path: fresh budget (010-B)
    const restore = this.restoreControllers.get(provider);
    if (restore) {
      this.restoreControllers.delete(provider);
      restore.controller.abort();
      this.bumpGeneration(provider);
      this.markDisconnected(provider);
      await this.closeProviderWork(provider);
    }
    const disconnect = this.disconnectFlights.get(provider);
    if (disconnect || this.disconnectIntents.has(provider)) return disconnect ?? publicStatus(provider);
    const reset = this.resetFlights.get(provider);
    if (reset) { await reset; return this.status(provider); }
    const refresh = this.refreshFlights.get(provider);
    if (refresh) return refresh;
    const callback = this.callbackFlights.get(provider);
    if (callback?.generation === this.generation(provider)) return callback.promise;
    if (callback) this.callbackFlights.delete(provider);
    return this.connectAtGeneration(provider, endpoint, this.generation(provider));
  }
  private connectAtGeneration(
    provider: string,
    endpoint: string,
    generation: number,
    requestOptions?: { signal?: AbortSignal; timeout?: number; maxTotalTimeout?: number },
  ): Promise<McpConnectionStatus> {
    if (!this.isCurrent(provider, generation)) return Promise.resolve(this.status(provider));
    const session = this.sessions.get(provider);
    if (session?.state === "connected") return Promise.resolve(this.status(provider));
    const current = this.connectFlights.get(provider);
    if (current?.generation === generation) return current.promise;
    const promise = this.performConnect(provider, endpoint, generation, requestOptions);
    this.connectFlights.set(provider, { generation, promise });
    void promise.finally(() => {
      if (this.connectFlights.get(provider)?.promise === promise) this.connectFlights.delete(provider);
    }).catch(() => undefined);
    return promise;
  }
  private async performConnect(
    provider: string,
    endpoint: string,
    generation: number,
    requestOptions?: { signal?: AbortSignal; timeout?: number; maxTotalTimeout?: number },
  ): Promise<McpConnectionStatus> {
    const session = this.mutableSession(provider);
    session.state = "connecting";
    session.authorizationUrl = undefined;
    session.detail = undefined;
    const oauthState = randomBytes(24).toString("base64url");
    const authProvider = createServerOAuthProvider({
      provider,
      tokenDir: this.options.tokenDir,
      origin: this.options.getOrigin(),
      endpoint,
      oauthState,
      isCurrent: () => this.isCurrent(provider, generation),
    });
    const transport = this.makeTransport(endpoint, authProvider);
    const client = this.makeClient();
    const identity = { generation, epoch: ++this.epoch };
    client.onerror = (error) => this.handleRuntimeError(provider, identity, error);
    client.onclose = () => this.handleRuntimeClose(provider, identity);
    addCandidate(this.candidates, provider, transport);
    try {
      await connectClient(client, transport, requestOptions);
      if (!this.isCurrent(provider, generation)) return this.closeStale(provider, transport);
      removeCandidate(this.candidates, provider, transport);
      this.dropProviderPendings(provider);
      Object.assign(session, {
        state: "connected",
        client,
        transport,
        connectedAt: new Date(this.now()).toISOString(),
        detail: undefined,
        identity,
        expectedClose: false,
      });
      return this.status(provider);
    } catch (error) {
      if (!this.isCurrent(provider, generation)) return this.closeStale(provider, transport);
      if (error instanceof UnauthorizedError || /unauthorized/i.test(String((error as Error)?.message))) {
        const retained = await this.replacePending(provider, oauthState, generation, transport);
        if (!retained || !this.isCurrent(provider, generation)) return this.closeStale(provider, transport);
        session.state = "auth_required";
        session.authorizationUrl = authProvider.lastAuthorizationUrl ?? undefined;
        return this.status(provider);
      }
      removeCandidate(this.candidates, provider, transport);
      await transport.close().catch(() => undefined);
      if (!this.isCurrent(provider, generation)) return this.status(provider);
      session.state = "error";
      session.detail = "MCP_CONNECT_FAILED";
      return this.status(provider);
    }
  }
  private handleRuntimeError(provider: string, identity: McpConnectionIdentity, error: Error): void {
    const session = this.sessions.get(provider);
    if (!session || !sameConnection(session.identity, identity) || session.expectedClose) return;
    if (isTerminalTransportError(error)) { this.markOffline(provider, identity); return; }
    session.detail = "MCP_TRANSPORT_DEGRADED";
  }
  private handleRuntimeClose(provider: string, identity: McpConnectionIdentity): void {
    const session = this.sessions.get(provider);
    if (!sameConnection(session?.identity, identity) || session?.expectedClose) return;
    this.markOffline(provider, identity);
  }
  private markOffline(provider: string, identity: McpConnectionIdentity): void {
    const session = this.sessions.get(provider);
    if (!session || !sameConnection(session.identity, identity)) return;
    session.state = "offline";
    session.detail = "MCP_TRANSPORT_OFFLINE";
    const used = this.reconnectBudget.get(provider) ?? 0;
    if (used >= MAX_AUTO_RECONNECTS || this.shuttingDown) return;
    if (this.reconnectTimers.has(provider)) return; // duplicate-registration guard (010-B)
    this.reconnectBudget.set(provider, used + 1);
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(provider);
      if (!sameConnection(this.sessions.get(provider)?.identity, identity)) return;
      void this.refresh(provider).catch(() => undefined);
    }, (this.options.reconnectDelayMs ?? 250) * 2 ** used);
    // No unref: the timer is lifecycle-managed (shutdown clears it) and
    // Node 22's test runner resolves the loop while tests await it (260719).
    this.reconnectTimers.set(provider, timer);
  }
  private async closeStale(provider: string, transport: StreamableHTTPClientTransport): Promise<McpConnectionStatus> {
    removeCandidate(this.candidates, provider, transport);
    await transport.close().catch(() => undefined);
    return this.status(provider);
  }

  private async replacePending(
    provider: string,
    state: string,
    generation: number,
    transport: StreamableHTTPClientTransport,
  ): Promise<boolean> {
    const old = [...this.pendingAuth.entries()].find(([, value]) => value.provider === provider);
    if (old) {
      this.pendingAuth.delete(old[0]);
      removeCandidate(this.candidates, provider, old[1].transport);
      await old[1].transport.close().catch(() => undefined);
    }
    if (!this.isCurrent(provider, generation)) return false;
    this.pendingAuth.set(state, {
      provider,
      generation,
      transport,
      expiresAt: this.now() + (this.options.pendingAuthTtlMs ?? DEFAULT_PENDING_AUTH_TTL_MS),
    });
    return true;
  }

  handleOAuthCallback(state: string, code: string): Promise<McpConnectionStatus> {
    const pending = this.pendingAuth.get(state);
    this.pendingAuth.delete(state);
    if (!pending || pending.expiresAt < this.now() || !this.isCurrent(pending.provider, pending.generation)) {
      return this.rejectInvalidCallback(pending);
    }
    this.reconnectBudget.delete(pending.provider); // explicit user path: fresh budget (010-B)
    if (this.callbackFlights.get(pending.provider)?.generation === pending.generation) {
      return this.rejectInvalidCallback(pending);
    }
    this.activeCallbacks.set(state, pending);
    const promise = this.performOAuthCallback(state, code, pending);
    const flight = { generation: pending.generation, promise };
    this.callbackFlights.set(pending.provider, flight);
    void promise.finally(() => {
      if (this.activeCallbacks.get(state) === pending) this.activeCallbacks.delete(state);
      if (this.callbackFlights.get(pending.provider) === flight) this.callbackFlights.delete(pending.provider);
    }).catch(() => undefined);
    return promise;
  }

  private async rejectInvalidCallback(pending?: PendingAuth): Promise<never> {
    if (pending) {
      removeCandidate(this.candidates, pending.provider, pending.transport);
      await pending.transport.close().catch(() => undefined);
      if (this.isCurrent(pending.provider, pending.generation)) this.markDisconnected(pending.provider);
    }
    throw new Error("MCP_OAUTH_STATE_INVALID");
  }

  private async performOAuthCallback(
    state: string,
    code: string,
    pending: PendingAuth,
  ): Promise<McpConnectionStatus> {
    try {
      await pending.transport.finishAuth(code);
      if (this.activeCallbacks.get(state) !== pending || !this.isCurrent(pending.provider, pending.generation)) {
        throw new Error("MCP_OAUTH_GENERATION_STALE");
      }
      await pending.transport.close().catch(() => undefined);
      if (this.activeCallbacks.get(state) !== pending || !this.isCurrent(pending.provider, pending.generation)) {
        throw new Error("MCP_OAUTH_GENERATION_STALE");
      }
      removeCandidate(this.candidates, pending.provider, pending.transport);
      this.sessions.set(pending.provider, { state: "disconnected" });
      const endpoint = resolveProviderEndpoint(pending.provider, this.options.enabledProviders);
      return this.connectAtGeneration(pending.provider, endpoint, pending.generation);
    } catch (error) {
      await pending.transport.close().catch(() => undefined);
      removeCandidate(this.candidates, pending.provider, pending.transport);
      const codeOnly = String((error as Error)?.message ?? error).split(":")[0];
      if (codeOnly === "MCP_OAUTH_GENERATION_STALE" || codeOnly === "MCP_TOKEN_REVISION_STALE") {
        throw new Error("MCP_OAUTH_GENERATION_STALE");
      }
      throw new Error("MCP_OAUTH_CALLBACK_FAILED");
    }
  }

  private async closeProviderWork(provider: string): Promise<void> {
    const transports = new Set<StreamableHTTPClientTransport>(this.candidates.get(provider) ?? []);
    const session = this.sessions.get(provider);
    if (session?.transport) transports.add(session.transport);
    for (const [state, pending] of this.pendingAuth) {
      if (pending.provider === provider) { this.pendingAuth.delete(state); transports.add(pending.transport); }
    }
    for (const [state, pending] of this.activeCallbacks) {
      if (pending.provider === provider) { this.activeCallbacks.delete(state); transports.add(pending.transport); }
    }
    this.candidates.delete(provider);
    await Promise.all([...transports].map((transport) => transport.close().catch(() => undefined)));
    const current = this.sessions.get(provider);
    if (current && current === session) {
      delete current.client;
      delete current.transport;
      delete current.connectedAt;
      delete current.toolCount;
      delete current.identity;
      delete current.expectedClose;
    }
  }

  private markDisconnected(provider: string): void {
    const session = this.sessions.get(provider);
    if (!session) { this.sessions.set(provider, { state: "disconnected" }); return; }
    session.state = "disconnected";
    session.expectedClose = true;
    session.authorizationUrl = undefined;
    session.detail = undefined;
    session.snapshotDiff = undefined;
  }
  reset(provider: string): Promise<void> {
    if (this.shuttingDown) return Promise.reject(new Error("MCP_SHUTTING_DOWN"));
    resolveProviderEndpoint(provider, this.options.enabledProviders);
    const disconnect = this.disconnectFlights.get(provider);
    if (disconnect || this.disconnectIntents.has(provider)) return disconnect?.then(() => undefined) ?? Promise.resolve();
    const existing = this.resetFlights.get(provider);
    if (existing) return existing;
    this.reconnectBudget.delete(provider); // intentional teardown: fresh budget (010-B)
    this.bumpGeneration(provider);
    this.markDisconnected(provider);
    const promise = this.closeProviderWork(provider);
    this.resetFlights.set(provider, promise);
    void promise.finally(() => {
      if (this.resetFlights.get(provider) === promise) this.resetFlights.delete(provider);
    }).catch(() => undefined);
    return promise;
  }
  refresh(provider: string): Promise<McpConnectionStatus> {
    if (this.shuttingDown) return Promise.reject(new Error("MCP_SHUTTING_DOWN"));
    const endpoint = resolveProviderEndpoint(provider, this.options.enabledProviders);
    const disconnect = this.disconnectFlights.get(provider);
    if (disconnect || this.disconnectIntents.has(provider)) return disconnect ?? Promise.resolve(publicStatus(provider));
    const reset = this.resetFlights.get(provider);
    if (reset) return reset.then(() => this.status(provider));
    const existing = this.refreshFlights.get(provider);
    if (existing) return existing;
    const generation = this.bumpGeneration(provider);
    this.markDisconnected(provider);
    const promise = this.performRefresh(provider, endpoint, generation);
    this.refreshFlights.set(provider, promise);
    void promise.finally(() => {
      if (this.refreshFlights.get(provider) === promise) this.refreshFlights.delete(provider);
    }).catch(() => undefined);
    return promise;
  }

  private async performRefresh(provider: string, endpoint: string, generation: number): Promise<McpConnectionStatus> {
    await this.closeProviderWork(provider);
    if (!this.isCurrent(provider, generation)) return this.status(provider);
    return this.connectAtGeneration(provider, endpoint, generation);
  }
  disconnect(provider: string): Promise<McpConnectionStatus> {
    if (this.shuttingDown) return Promise.reject(new Error("MCP_SHUTTING_DOWN"));
    const endpoint = resolveProviderEndpoint(provider, this.options.enabledProviders);
    const existing = this.disconnectFlights.get(provider);
    if (existing) return existing;
    this.disconnectIntents.add(provider);
    this.reconnectBudget.delete(provider); // intentional teardown: fresh budget (010-B)
    this.bumpGeneration(provider);
    this.markDisconnected(provider);
    const promise = this.performDisconnect(provider, endpoint);
    this.disconnectFlights.set(provider, promise);
    void promise.finally(() => {
      if (this.disconnectFlights.get(provider) === promise) this.disconnectFlights.delete(provider);
      this.disconnectIntents.delete(provider);
    }).catch(() => undefined);
    return promise;
  }

  private async performDisconnect(provider: string, endpoint: string): Promise<McpConnectionStatus> {
    let storeError: unknown;
    try {
      tombstoneTokenRecord(this.options.tokenDir, provider, {
        provider,
        endpoint,
        redirectOrigin: this.options.getOrigin(),
      });
    } catch (error) { storeError = error; }
    await this.closeProviderWork(provider);
    if (storeError) throw storeError;
    return this.status(provider);
  }

  async restoreStoredConnections(): Promise<void> {
    if (this.shuttingDown) return;
    await runBounded(this.options.enabledProviders, 2, async (provider) => {
      const endpoint = resolveProviderEndpoint(provider, this.options.enabledProviders);
      const inspection = inspectRestore(this.options.tokenDir, provider, endpoint, this.options.getOrigin());
      if (inspection.state === "binding-mismatch") {
        const session = this.mutableSession(provider);
        session.state = "auth_required";
        session.detail = "MCP_CREDENTIAL_BINDING_MISMATCH";
        return;
      }
      if (inspection.state !== "usable") return;
      const timeout = this.options.restoreTimeoutMs ?? 15_000;
      const controller = new AbortController();
      const generation = this.generation(provider);
      this.restoreControllers.set(provider, { generation, controller });
      const timer = setTimeout(() => {
        controller.abort();
        if (this.isCurrent(provider, generation)) {
          this.bumpGeneration(provider);
          this.markDisconnected(provider);
          void this.closeProviderWork(provider);
        }
      }, timeout);
      // No unref: cleared on success (~below) and aborted on shutdown (260719).
      try {
        await this.connectAtGeneration(provider, endpoint, generation, {
          signal: controller.signal,
          timeout,
          maxTotalTimeout: timeout,
        });
      } finally {
        clearTimeout(timer);
        if (this.restoreControllers.get(provider)?.controller === controller) this.restoreControllers.delete(provider);
      }
    });
  }

  connectionIdentity(provider: string): McpConnectionIdentity | null {
    const session = this.sessions.get(provider);
    return session?.state === "connected" && session.identity ? { ...session.identity } : null;
  }

  /** A successful real RPC proves the transport works: clear the sticky
   *  degraded detail (010-A) and restore the auto-reconnect budget (010-B). */
  private noteRpcSuccess(provider: string, identity: McpConnectionIdentity | null): void {
    const session = this.sessions.get(provider);
    if (!session || !sameConnection(session.identity, identity)) return;
    this.reconnectBudget.delete(provider);
    if (session.detail === "MCP_TRANSPORT_DEGRADED") session.detail = undefined;
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    for (const value of this.restoreControllers.values()) value.controller.abort();
    this.restoreControllers.clear();
    for (const timer of this.reconnectTimers.values()) clearTimeout(timer);
    this.reconnectTimers.clear();
    const providers = listProviders(this.options.enabledProviders).filter((entry) => entry.enabled).map((entry) => entry.id);
    const closing = Promise.all(providers.map(async (provider) => {
      this.bumpGeneration(provider);
      this.markDisconnected(provider);
      await this.closeProviderWork(provider);
    }));
    await Promise.race([closing, new Promise<void>((resolve) => setTimeout(resolve, 2_000))]);
  }

  async listTools(provider: string): Promise<McpToolListing> {
    const session = this.sessions.get(provider);
    if (session?.state !== "connected" || !session.client) throw new Error("MCP_NOT_CONNECTED");
    const identity = this.connectionIdentity(provider);
    const tools: Array<Record<string, unknown>> = [];
    let cursor: string | undefined;
    try {
      do {
        const page = await session.client.listTools(cursor ? { cursor } : {});
        tools.push(...(page.tools as Array<Record<string, unknown>>));
        cursor = page.nextCursor;
      } while (cursor);
    } catch (error) { markSessionInvalid(this.sessions.get(provider), identity, error); throw error; }
    this.noteRpcSuccess(provider, identity);
    if (sameConnection(this.connectionIdentity(provider), identity)) session.toolCount = tools.length;
    const client = session.client as unknown as { getServerVersion?: () => Record<string, unknown> | undefined };
    const transport = session.transport as unknown as { protocolVersion?: string } | undefined;
    return {
      provider,
      fetchedAt: new Date(this.now()).toISOString(),
      tools,
      serverInfo: client.getServerVersion?.() ?? null,
      ...(transport?.protocolVersion ? { protocolVersion: transport.protocolVersion } : {}),
    };
  }

  attachSnapshotDiff(
    provider: string,
    identity: McpConnectionIdentity | null,
    diff: { drifted: string[]; missing: string[]; added: string[] },
  ): void {
    const session = this.sessions.get(provider);
    if (!session || session.state !== "connected" || !sameConnection(session.identity, identity)) return;
    session.snapshotDiff = diff;
  }

  async callTool(
    provider: string,
    name: string,
    args: Record<string, unknown>,
    options: { signal?: AbortSignal | undefined; timeoutMs?: number | undefined } = {},
  ): Promise<Record<string, unknown>> {
    const session = this.sessions.get(provider);
    if (session?.state !== "connected" || !session.client) throw new Error("MCP_NOT_CONNECTED");
    const identity = this.connectionIdentity(provider);
    try {
      const raw = await (session.client.callTool as unknown as (
      params: { name: string; arguments: Record<string, unknown> },
      schema?: undefined,
      opts?: { signal?: AbortSignal; timeout?: number },
    ) => Promise<Record<string, unknown>>)(
      { name, arguments: args },
      undefined,
      { ...(options.signal ? { signal: options.signal } : {}), timeout: options.timeoutMs ?? 120_000 },
    );
      if ((raw as { isError?: boolean }).isError) {
        const content = (raw as { content?: unknown[] }).content;
        const text = Array.isArray(content)
          ? content.map((c) => (c as { text?: string }).text ?? "").filter(Boolean).join(" ")
          : JSON.stringify(raw).slice(0, 300);
        throw new Error(`MCP_TOOL_ERROR:${name}:${text.slice(0, 300)}`);
      }
      this.noteRpcSuccess(provider, identity);
      return raw;
    } catch (error) {
      markSessionInvalid(this.sessions.get(provider), identity, error);
      throw error;
    }
  }
}
