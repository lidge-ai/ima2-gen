export type GuardReport = {
  accept(message: unknown): void;
  readonly ready: boolean;
  readonly readyPromise: Promise<void>;
  readonly failure: Promise<never>;
  readonly deniedConnections: ReadonlyArray<{ transport: string; host: string; port: number }>;
  readonly deniedProcesses: ReadonlyArray<{ api: string }>;
  readonly deniedFilesystem: ReadonlyArray<{ operation: string; category: "outside-fixture" }>;
  readonly expectedDiscoveries: ReadonlyArray<{ api: string; discovery: string }>;
  readonly expectedLegacyProbes: number;
  readonly expectedPlatformProbes: ReadonlyArray<{ operation: string }>;
  assertClean(): void;
};
const PROCESS_APIS = new Set(["spawn", "exec", "execFile", "fork", "spawnSync", "execSync", "execFileSync", "ChildProcess.spawn", "Worker"]);
const DISCOVERIES = new Set(["agy-version", "grok-version", "codex-login-status"]);
const TRANSPORTS = new Set(["tcp", "dns", "tls", "http2", "udp", "websocket"]);
function exact(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
export function createGuardReport(): GuardReport {
  let resolveReady!: () => void, rejectReady!: (error: Error) => void, rejectFailure!: (error: Error) => void;
  const readyPromise = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const failure = new Promise<never>((_resolve, reject) => { rejectFailure = reject; });
  void readyPromise.catch(() => {}); void failure.catch(() => {});
  let ready = false, protocolError = false, expectedLegacyProbes = 0;
  const connections: Array<{ transport: string; host: string; port: number }> = [];
  const processes: Array<{ api: string }> = [];
  const filesystem: Array<{ operation: string; category: "outside-fixture" }> = [];
  const discoveries: Array<{ api: string; discovery: string }> = [];
  const platformProbes: Array<{ operation: string }> = [];
  const invalid = () => {
    protocolError = true;
    const error = new Error("E2E_GUARD_IPC_INVALID");
    rejectReady(error); rejectFailure(error);
  };
  const accept = (message: unknown): void => {
    if (!message || typeof message !== "object" || Array.isArray(message)) { invalid(); return; }
    const value = message as Record<string, unknown>;
    if (value.type === "ima2-e2e-guard-ready" && exact(value, ["type", "version"]) && value.version === 1 && !ready) {
      ready = true; resolveReady(); return;
    }
    if (value.type === "ima2-e2e-denied" && exact(value, ["type", "transport", "host", "port"])
      && typeof value.transport === "string" && TRANSPORTS.has(value.transport)
      && typeof value.host === "string" && /^[a-zA-Z0-9.:\[\]-]{1,253}$/.test(value.host)
      && Number.isSafeInteger(value.port) && Number(value.port) >= 0 && Number(value.port) <= 65535) {
      connections.push({ transport: value.transport, host: value.host, port: Number(value.port) }); return;
    }
    if (value.type === "ima2-e2e-process-denied" && exact(value, ["type", "api", "discovery"])
      && typeof value.api === "string" && PROCESS_APIS.has(value.api)
      && (value.discovery === null || (typeof value.discovery === "string" && DISCOVERIES.has(value.discovery)))) {
      if (value.discovery === null) processes.push({ api: value.api });
      else discoveries.push({ api: value.api, discovery: value.discovery as string });
      return;
    }
    if (value.type === "ima2-e2e-file-denied" && exact(value, ["type", "operation", "category"])
      && typeof value.operation === "string" && /^[a-zA-Z.]{1,64}$/.test(value.operation)
      && typeof value.category === "string" && ["outside-fixture", "expected-discovery-metadata", "expected-platform-probe"].includes(value.category)) {
      if (value.category === "expected-platform-probe") {
        if (!/^(?:(?:open(?:Sync)?|readFile(?:Sync)?|promises\.(?:open|readFile))\.platform(?:Ldd|Executable)|readFileSync\.platformMaps)$/.test(value.operation)) { invalid(); return; }
        platformProbes.push({ operation: value.operation });
      } else if (value.category === "expected-discovery-metadata") expectedLegacyProbes++;
      else filesystem.push({ operation: value.operation, category: "outside-fixture" });
      return;
    }
    invalid();
  };
  return { accept, readyPromise, failure, get ready() { return ready; },
    get deniedConnections() { return [...connections]; }, get deniedProcesses() { return [...processes]; },
    get deniedFilesystem() { return [...filesystem]; }, get expectedDiscoveries() { return [...discoveries]; },
    get expectedLegacyProbes() { return expectedLegacyProbes; },
    get expectedPlatformProbes() { return [...platformProbes]; },
    assertClean() {
      if (protocolError || !ready || connections.length || processes.length || filesystem.length) {
        throw new Error("E2E_GUARD_UNEXPECTED_DENIAL:" + JSON.stringify({ ready, protocolError,
          connections: connections.slice(0, 8), processes: processes.slice(0, 8), filesystem: filesystem.slice(0, 8),
          counts: { connections: connections.length, processes: processes.length, filesystem: filesystem.length },
        }));
      }
    },
  };
}
