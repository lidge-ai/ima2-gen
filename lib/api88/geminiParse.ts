import { api88Error, api88Record } from "./errors.js";

function candidate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return /^(?:data:image\/[a-zA-Z0-9.+-]+;base64,|https:\/\/)/.test(value) ? value : undefined;
}

function imagePart(value: unknown): string | undefined {
  const record = api88Record(value);
  return candidate(api88Record(record.image_url).url) ?? candidate(record.url);
}

export function parseApi88GeminiImage(value: unknown): string {
  const body = api88Record(value);
  const first = Array.isArray(body.choices) ? body.choices[0] : undefined;
  const message = api88Record(api88Record(first).message);
  if (Array.isArray(message.images)) {
    for (const image of message.images) { const found = imagePart(image); if (found) return found; }
  }
  if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (api88Record(part).type !== "image_url") continue;
      const found = imagePart(part); if (found) return found;
    }
  }
  const text = typeof message.content === "string" ? message.content : "";
  for (const match of text.matchAll(/!\[[^\]]*\]\((data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+|https:\/\/[^\s)]+)\)/g)) {
    const found = candidate(match[1]); if (found) return found;
  }
  const data = text.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/);
  if (data) return data[0];
  const url = text.match(/https:\/\/[^\s<>"')]+/);
  if (url) return url[0];
  throw api88Error("API88_EMPTY_RESULT", `88API Gemini response contained no image: ${text.slice(0, 200)}`, 502);
}
