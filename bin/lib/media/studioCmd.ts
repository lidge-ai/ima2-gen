import type { ParsedArgs } from "../args.js";
import { request } from "../client.js";
import { MediaApiError } from "../mediaErrors.js";
import { openUrl } from "../platform.js";
import type { Dict } from "./common.js";

export async function studioCommand(base: string, args: ParsedArgs): Promise<unknown> {
  const [, action, name] = args.positional;
  if (!action) return request(base, "/api/studios");
  if (!name) throw new Error("Studio name required");
  if (action === "default") return request(base, "/api/studios/default", { method: "PUT", body: { name } });
  if (action !== "open") throw new Error("Unknown studio command");
  const list = await request<{ studios: Dict[] }>(base, "/api/studios");
  const studio = list.studios.find((item) => item.name === name && item.built && typeof item.url === "string");
  if (!studio) throw new MediaApiError("STUDIO_UNKNOWN", `Unknown or unbuilt studio: ${name}`);
  const url = new URL(String(studio.url), base).href;
  if (args["no-open"] !== true) openUrl(url);
  return { url };
}
