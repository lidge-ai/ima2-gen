import type { MediaModelSpec, MediaSubmitRequest } from "./contract.js";

/**
 * The option values a result keeps (sidecar media.options), so the same settings can be chosen again.
 * Only options the route declares for the task are kept, and only in the shape it declares: a switch,
 * a listed choice, a voice id. Free text is not kept, and neither is anything whose name or value
 * looks like a credential, even if a route declares it.
 */
const SECRET_NAME = /key|token|secret|password|passwd|auth|credential|bearer|cookie|session/i;
const SECRET_VALUE = /^(?:sk-|xai-|aiza|fal-|r8_|ghp_|gho_|key-|bearer)/i;
/** Voice ids are short opaque ids (20 characters at ElevenLabs, a UUID at Cartesia). */
const VOICE_ID = /^[A-Za-z0-9_-]{1,40}$/;

function looksSecret(value: string): boolean {
  return SECRET_VALUE.test(value) || value.length > 80;
}

export function declaredResultOptions(spec: Pick<MediaModelSpec, "params">, request: Pick<MediaSubmitRequest, "task" | "vendorOptions">): Record<string, string | boolean> | undefined {
  const sent = request.vendorOptions;
  if (!sent) return undefined;
  const kept: Record<string, string | boolean> = {};
  for (const option of spec.params.options ?? []) {
    if (option.tasks && !option.tasks.includes(request.task)) continue;
    if (SECRET_NAME.test(option.name) || !Object.hasOwn(sent, option.name)) continue;
    const value = sent[option.name];
    if (option.type === "boolean") { if (typeof value === "boolean") kept[option.name] = value; continue; }
    if (typeof value !== "string" || looksSecret(value)) continue;
    if (option.type === "enum" && option.values?.includes(value)) kept[option.name] = value;
    if (option.type === "voice" && VOICE_ID.test(value)) kept[option.name] = value;
  }
  return Object.keys(kept).length > 0 ? kept : undefined;
}
