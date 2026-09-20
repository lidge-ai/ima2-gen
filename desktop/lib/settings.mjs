import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const DEFAULT_PORT = 3333;

export const DEFAULT_SETTINGS = Object.freeze({
  port: DEFAULT_PORT,
  openAtLogin: false,
  startHidden: false,
  menubarOnly: false,
  keepRunningOnClose: true,
  devLogging: false,
  nodeBinary: "",
  configDir: "",
});

const BOOL_KEYS = ["openAtLogin", "startHidden", "menubarOnly", "keepRunningOnClose", "devLogging"];
const STR_KEYS = ["nodeBinary", "configDir"];

export function sanitizeSettings(input) {
  const src = input && typeof input === "object" ? input : {};
  const out = { ...DEFAULT_SETTINGS };
  const port = Number(src.port);
  if (Number.isInteger(port) && port >= 1024 && port <= 65535) out.port = port;
  for (const key of BOOL_KEYS) {
    if (typeof src[key] === "boolean") out[key] = src[key];
  }
  for (const key of STR_KEYS) {
    if (typeof src[key] === "string") out[key] = src[key].trim();
  }
  return out;
}

export class SettingsStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.value = this.#read();
    this.listeners = new Set();
  }

  #read() {
    if (!existsSync(this.filePath)) return { ...DEFAULT_SETTINGS };
    try {
      return sanitizeSettings(JSON.parse(readFileSync(this.filePath, "utf-8")));
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  get() {
    return { ...this.value };
  }

  update(patch) {
    const next = sanitizeSettings({ ...this.value, ...patch });
    const changed = Object.keys(next).filter((k) => next[k] !== this.value[k]);
    this.value = next;
    this.#write();
    if (changed.length) for (const fn of this.listeners) fn(this.get(), changed);
    return this.get();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  #write() {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.value, null, 2) + "\n", { mode: 0o600 });
    renameSync(tmp, this.filePath);
  }
}

export function createSettingsStore(userDataDir) {
  return new SettingsStore(join(userDataDir, "desktop-settings.json"));
}
