import assert from "node:assert/strict";
import childProcess, { type ChildProcess, type ExecFileException, type ExecFileOptions } from "node:child_process";
import { accessSync, constants, lstatSync, realpathSync, statSync, type Stats } from "node:fs";
import { delimiter, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { promisify } from "node:util";
import { setTimeout as setTimer, clearTimeout as clearTimer } from "node:timers";

const MAX_TIMEOUT = 30_000;
const MAX_BUFFER = 1024 * 1024;
const DRAIN_TIMEOUT = MAX_TIMEOUT + 5_000;
const KILL_SIGNAL = process.platform === "win32" ? "SIGTERM" : "SIGKILL";
const CLIP_PREFIX = ["-y", "-f", "lavfi", "-i"];
type Callback = (error: ExecFileException | null, stdout: string, stderr: string) => void;
type Guard = (file: string, args: string[], options: ExecFileOptions, callback?: Callback) => ChildProcess;

export interface FfmpegAttempt {
  args: readonly string[];
  executable: string;
  input?: string;
  output?: string;
  pid?: number;
  callbackDone: boolean;
  closed: boolean;
  error: unknown | null;
  code: number | null;
  signal: NodeJS.Signals | null;
  canceled: boolean;
  outputExists?: boolean;
}

interface RetainedChild {
  child: ChildProcess;
  kill: ChildProcess["kill"];
  attempt: FfmpegAttempt;
  done: Promise<void>;
}
interface State {
  root: string;
  executable: string | null;
  absent: string;
  binary: Stats | null;
  nativeExecFile: typeof childProcess.execFile;
  previous: PropertyDescriptor;
  violations: unknown[];
  attempts: FfmpegAttempt[];
  children: RetainedChild[];
  writers: Set<string>;
  closing: boolean;
  restored: boolean;
}
interface Command { input?: string; output?: string; keys: string[] }

/** Capture before isolateExecution; neither capture nor installation runs a process. */
export function captureFfmpegCapability() {
  return { nativeExecFile: childProcess.execFile, originalPath: process.env.PATH ?? "" };
}

function absentStat(path: string): Stats | null {
  try { return lstatSync(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Whether a PATH entry is a directory that can be searched. One that cannot be read at all (missing,
 * denied, or a link Node cannot follow, which Windows reports as UNKNOWN) offers no executable; that is
 * the machine's PATH, not something the test did. Errors about the executable itself are still raised.
 */
export function usablePathDirectory(dir: string, stat: (path: string) => { isDirectory(): boolean } = statSync): boolean {
  try { return stat(dir).isDirectory(); } catch { return false; }
}

function findExecutable(originalPath: string): string | null {
  for (const dir of originalPath.split(delimiter)) {
    if (!isAbsolute(dir)) continue; // Never search cwd or a relative PATH entry.
    if (!usablePathDirectory(dir)) continue;
    try {
      const path = realpathSync(join(dir, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"));
      if (!statSync(path).isFile()) continue;
      accessSync(path, constants.X_OK);
      return path;
    } catch (error) {
      if (!["ENOENT", "ENOTDIR", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    }
  }
  return null;
}

function assertInside(root: string, path: string): void {
  const rel = relative(root, path);
  assert.ok(rel && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel),
    `FFmpeg path escapes fixture (relativeEmpty=${rel === ""}, absolute=${isAbsolute(rel)})`);
}

function ownedPath(state: State, path: string, extension: string, input = false): string {
  assert.equal(typeof path, "string", "FFmpeg requires a local path");
  assert.ok(isAbsolute(path) && !/[\x00-\x1f]/.test(path), "FFmpeg requires an absolute local path");
  assert.equal(extname(path), extension, "Unexpected FFmpeg media extension");
  const resolved = resolve(path);
  const parent = realpathSync(dirname(resolved));
  if (parent !== state.root) assertInside(state.root, parent);
  const canonical = join(parent, resolved.slice(dirname(resolved).length + 1));
  const info = absentStat(canonical);
  if (input) assert.ok(info, "FFmpeg input is missing");
  if (info) {
    assert.ok(info.isFile() && !info.isSymbolicLink(), "FFmpeg leaf must be a regular nonlink file");
    assert.equal(realpathSync(canonical), canonical, "FFmpeg leaf is not canonical");
    assert.equal(info.nlink, 1, "FFmpeg media must not have hardlink aliases");
  }
  return canonical;
}

function pathKey(path: string): string {
  // Also conservative on case-insensitive macOS/Windows fixture filesystems.
  return path.normalize("NFC").toLowerCase();
}

function validatePaths(state: State, input: string | undefined, output: string, extension: string): Command {
  const source = input === undefined ? undefined : ownedPath(state, input, ".mp4", true);
  const target = ownedPath(state, output, extension);
  const keys = [pathKey(target)];
  const targetInfo = absentStat(target);
  if (source) {
    assert.notEqual(pathKey(source), pathKey(target), "FFmpeg input/output alias");
    const sourceInfo = statSync(source);
    if (targetInfo) assert.ok(sourceInfo.dev !== targetInfo.dev || sourceInfo.ino !== targetInfo.ino, "FFmpeg inode alias");
    assert.ok(!state.writers.has(pathKey(source)), "FFmpeg input has an active writer");
  }
  if (targetInfo) keys.push(`inode:${targetInfo.dev}:${targetInfo.ino}`);
  for (const key of keys) assert.ok(!state.writers.has(key), "FFmpeg output already has a writer");
  return { input: source, output: target, keys };
}

function validateArgs(state: State, args: string[]): Command {
  assert.ok(Array.isArray(args) && args.every(arg => typeof arg === "string"));
  if (args.length === 1 && args[0] === "-version") return { keys: [] };
  if (args.length === 8 && args[2] === "lavfi") {
    assert.deepEqual(args.slice(0, 4), CLIP_PREFIX);
    assert.ok(["color=c=blue:s=64x64:d=1", "color=c=green:s=64x64:d=1"].includes(args[4]!));
    assert.deepEqual(args.slice(5, 7), ["-pix_fmt", "yuv420p"]);
    return validatePaths(state, undefined, args[7]!, ".mp4");
  }
  if (args.length === 10 && args[1] === "-sseof") {
    assert.deepEqual(args.slice(0, 4), ["-y", "-sseof", "-3", "-i"]);
    assert.deepEqual(args.slice(5, 9), ["-update", "1", "-q:v", "1"]);
    return validatePaths(state, args[4]!, args[9]!, ".png");
  }
  if (args.length === 8 && args[1] === "-ss") {
    assert.deepEqual([args[0], args[1], args[3], ...args.slice(5, 7)], ["-y", "-ss", "-i", "-vframes", "1"]);
    const position = Number(args[2]);
    assert.ok(Number.isFinite(position) && position >= 0 && position <= 3600 && String(position) === args[2]);
    return validatePaths(state, args[4]!, args[7]!, ".png");
  }
  assert.deepEqual([args[0], args[1], ...args.slice(3, 9)],
    ["-y", "-i", "-vframes", "1", "-q:v", "4", "-vf", "scale='min(320,iw)':-2"]);
  assert.equal(args.length, 10, "Unapproved FFmpeg command");
  assert.equal(args[9], `${args[2]}.thumb.jpg`, "Unapproved thumbnail output");
  return validatePaths(state, args[2]!, args[9]!, ".jpg");
}

function validateOptions(options: ExecFileOptions): ExecFileOptions {
  assert.ok(options && Object.getPrototypeOf(options) === Object.prototype, "FFmpeg options required");
  const allowed = ["timeout", "maxBuffer", "killSignal", "signal"];
  assert.ok(Reflect.ownKeys(options).every(key => typeof key === "string" && allowed.includes(key)), "FFmpeg option forbidden");
  assert.ok(Number.isSafeInteger(options.timeout) && options.timeout! > 0 && options.timeout! <= MAX_TIMEOUT);
  assert.ok(Number.isSafeInteger(options.maxBuffer) && options.maxBuffer! > 0 && options.maxBuffer! <= MAX_BUFFER);
  assert.ok(options.killSignal === undefined || options.killSignal === KILL_SIGNAL);
  assert.ok(options.signal === undefined || options.signal instanceof AbortSignal);
  return { timeout: options.timeout, maxBuffer: options.maxBuffer, killSignal: KILL_SIGNAL,
    ...(options.signal ? { signal: options.signal } : {}) };
}

function nativeOptions(state: State, options: ExecFileOptions): ExecFileOptions {
  return { ...options, cwd: state.root, shell: false, encoding: "utf8", env: {
    PATH: state.executable ? dirname(state.executable) : state.root,
    HOME: state.root, USERPROFILE: state.root, TMPDIR: state.root, TMP: state.root, TEMP: state.root,
    LANG: "C", LC_ALL: "C",
    ...(process.platform === "win32" && process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
  } };
}

function assertPinned(state: State): void {
  assert.equal(realpathSync(state.root), state.root, "Fixture root replaced");
  if (!state.executable) {
    assert.equal(absentStat(state.absent), null, "Missing FFmpeg path must remain absent");
    return;
  }
  const info = lstatSync(state.executable);
  assert.ok(info.isFile() && !info.isSymbolicLink(), "FFmpeg executable replaced");
  assert.equal(realpathSync(state.executable), state.executable);
  for (const key of ["dev", "ino", "size", "mtimeMs"] as const) assert.equal(info[key], state.binary![key]);
}

function retainChild(state: State, child: ChildProcess, attempt: FfmpegAttempt,
  completion: { callback: Promise<void>; keys: string[] }): void {
  let closed!: () => void;
  const close = new Promise<void>(resolve => { closed = resolve; });
  const kill = child.kill.bind(child);
  const entry = { child, kill, attempt, done: Promise.all([close, completion.callback]).then(() => {}) };
  state.children.push(entry);
  attempt.pid = child.pid;
  const watchdog = setTimer(() => {
    if (attempt.closed) return;
    state.violations.push(new Error("FFmpeg native watchdog expired"));
    attempt.canceled = true;
    kill(KILL_SIGNAL);
  }, DRAIN_TIMEOUT);
  child.kill = (signal) => { attempt.canceled = true; return kill(signal); };
  child.once("error", error => { attempt.error = error; });
  child.once("close", (code, signal) => {
    attempt.closed = true; attempt.code = code; attempt.signal = signal;
    clearTimer(watchdog);
    for (const key of completion.keys) state.writers.delete(key);
    try { if (attempt.output) attempt.outputExists = absentStat(attempt.output) !== null; }
    catch (error) { state.violations.push(error); }
    closed();
  });
}

function delegate(state: State, args: string[], options: ExecFileOptions, command: Command, callback?: Callback): ChildProcess {
  const attempt: FfmpegAttempt = { args: [...args], executable: state.executable ?? state.absent,
    input: command.input, output: command.output, callbackDone: false, closed: false,
    error: null, code: null, signal: null, canceled: false };
  state.attempts.push(attempt);
  for (const key of command.keys) state.writers.add(key);
  let callbackDone!: () => void;
  const completion = new Promise<void>(resolve => { callbackDone = resolve; });
  try {
    const child = state.nativeExecFile(attempt.executable, args, nativeOptions(state, options), (error, stdout, stderr) => {
      attempt.error = error;
      try { callback?.(error, String(stdout), String(stderr)); }
      catch (failure) { state.violations.push(failure); }
      finally { attempt.callbackDone = true; callbackDone(); }
    });
    retainChild(state, child, attempt, { callback: completion, keys: command.keys });
    return child;
  } catch (error) {
    attempt.error = error; attempt.callbackDone = true; attempt.closed = true;
    callbackDone();
    for (const key of command.keys) state.writers.delete(key);
    throw error;
  }
}

function makeGuard(state: State): Guard {
  return function guarded(file, args, options, callback) {
    try {
      assert.ok(!state.closing && !state.restored, "FFmpeg fixture closed");
      assert.equal(file, "ffmpeg", "Only literal ffmpeg is allowed");
      assert.ok(callback === undefined || typeof callback === "function");
      const safeOptions = validateOptions(options);
      const command = validateArgs(state, args);
      assertPinned(state);
      return delegate(state, args.slice(), safeOptions, command, callback);
    } catch (error) { state.violations.push(error); throw error; }
  };
}

function asyncGuard(guard: Guard, args: string[], options: ExecFileOptions) {
  let child: ChildProcess | undefined;
  const promise = new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    child = guard("ffmpeg", args, options, (error, stdout, stderr) => {
      if (error) { Object.assign(error, { stdout, stderr }); reject(error); }
      else resolve({ stdout, stderr });
    });
  });
  return Object.assign(promise, { child });
}

function installGuard(state: State): Guard {
  const guard = makeGuard(state);
  Object.defineProperty(guard, promisify.custom, { value: (file: string, args: string[], options: ExecFileOptions) => {
    // The fresh customizer delegates to the guard, never native promisify.custom.
    const checked: Guard = (_file, argv, opts, callback) => guard(file, argv, opts, callback);
    return asyncGuard(checked, args, options);
  } });
  Object.defineProperty(childProcess, "execFile", { ...state.previous, value: guard });
  syncBuiltinESMExports();
  return guard;
}

async function drain(state: State): Promise<void> {
  let timer: ReturnType<typeof setTimer> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimer(() => reject(new Error("FFmpeg callback/close did not drain")), DRAIN_TIMEOUT);
    });
    let count: number;
    do {
      count = state.children.length;
      await Promise.race([Promise.all(state.children.map(entry => entry.done)), timeout]);
    } while (state.children.length !== count);
  } catch (error) { state.violations.push(error); throw error; }
  finally { if (timer) clearTimer(timer); }
}

function restore(state: State): void {
  if (state.restored) return;
  try {
    assert.ok(state.children.every(entry => entry.attempt.closed && entry.attempt.callbackDone), "FFmpeg still active");
    Object.defineProperty(childProcess, "execFile", state.previous);
    syncBuiltinESMExports();
    state.restored = true;
  } catch (error) { state.violations.push(error); throw error; }
}

async function close(state: State): Promise<void> {
  state.closing = true;
  try {
    for (const entry of state.children) if (!entry.attempt.closed) {
      entry.attempt.canceled = true;
      entry.kill(KILL_SIGNAL);
    }
    await drain(state);
  } catch (error) { throw error; } // Keep guards/handles/root if native work is unsettled.
}

export async function installVideoFfmpeg(root: string,
  capability: ReturnType<typeof captureFfmpegCapability>, violations: unknown[]) {
  try {
    assert.ok(isAbsolute(root) && statSync(root).isDirectory());
    const canonical = realpathSync(root);
    assert.notEqual(dirname(canonical), canonical, "A filesystem root is not a fixture");
    const executable = findExecutable(capability.originalPath);
    const previous = Object.getOwnPropertyDescriptor(childProcess, "execFile");
    assert.ok(previous && "value" in previous, "Missing execFile descriptor");
    assert.notEqual(previous.value, capability.nativeExecFile, "Install base process isolation first");
    const state: State = { root: canonical, executable, absent: join(canonical, "ffmpeg-owned-absent"),
      binary: executable ? statSync(executable) : null, nativeExecFile: capability.nativeExecFile,
      previous, violations, attempts: [], children: [], writers: new Set(), closing: false, restored: false };
    assertPinned(state);
    const guard = installGuard(state);
    return { available: executable !== null, executable, get attempts(): readonly FfmpegAttempt[] { return state.attempts; },
      async createClip(path: string, color: "blue" | "green" = "blue"): Promise<void> {
        try {
          await asyncGuard(guard, [...CLIP_PREFIX, `color=c=${color}:s=64x64:d=1`, "-pix_fmt", "yuv420p", path],
            { timeout: MAX_TIMEOUT, maxBuffer: MAX_BUFFER });
        } catch (error) { throw error; }
      },
      drain: () => drain(state), close: () => close(state), restore: () => restore(state),
    };
  } catch (error) { violations.push(error); throw error; }
}
