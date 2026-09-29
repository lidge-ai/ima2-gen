import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Seeds an isolated HOME with a ~/.progrok/auth.json so the grok lane resolves an OAuth
 * bearer without touching the developer's real session. Pass the returned homeDir as
 * `grokAuthHomeDir` on the runtime context.
 */
export const GROK_FIXTURE_TOKEN = "grok-oauth-fixture-token";
/** The Authorization header every seeded OAuth (`grok`) lane fixture must send. */
export const GROK_FIXTURE_BEARER = `Bearer ${GROK_FIXTURE_TOKEN}`;

export function seedGrokAuth(options: {
  accessToken?: string; refreshToken?: string; expiresAt?: number; homeDir?: string;
} = {}): { homeDir: string; accessToken: string; bearer: string; cleanup: () => void } {
  const homeDir = options.homeDir ?? mkdtempSync(join(tmpdir(), "ima2-grok-auth-"));
  const accessToken = options.accessToken ?? GROK_FIXTURE_TOKEN;
  const dir = join(homeDir, ".progrok");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, "auth.json"), JSON.stringify({
    accessToken,
    refreshToken: options.refreshToken ?? "grok-oauth-fixture-refresh",
    expiresAt: options.expiresAt ?? Date.now() + 60 * 60 * 1000,
    tokenEndpoint: "https://auth.x.ai/oauth2/token",
  }, null, 2), { mode: 0o600 });
  return {
    homeDir, accessToken, bearer: `Bearer ${accessToken}`,
    cleanup: () => rmSync(homeDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
  };
}
