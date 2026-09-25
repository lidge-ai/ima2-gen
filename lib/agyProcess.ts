import type { CodedError } from "./errInfo.js";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { AGY_PROCESS_POLICY } from "../config.js";
import { buildAgyPathEnv, resolveAgyBin } from "./agyCli.js";

type AgyOutput = { stdout: string; stderr: string };

export function agyError(message: string, status: number, code: string): Error {
  const err: CodedError = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

class AgyProcessLifetime {
  private stdout = "";
  private stderr = "";
  private settled = false;
  private reason: Error | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private graceTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly signal: AbortSignal | undefined,
    private readonly resolve: (output: AgyOutput) => void,
    private readonly reject: (error: Error) => void,
  ) {}

  start(prompt: string): void {
    this.child.stdout.on("data", this.onStdout);
    this.child.stderr.on("data", this.onStderr);
    this.child.on("error", this.onError);
    this.child.once("close", this.finish);
    this.child.stdin.on("error", this.onStdinError);
    this.timer = setTimeout(() => {
      this.terminate(agyError("Agy generation timed out", 504, "AGY_TIMEOUT"));
    }, AGY_PROCESS_POLICY.timeoutMs);
    this.signal?.addEventListener("abort", this.onAbort, { once: true });
    if (this.signal?.aborted) {
      this.onAbort();
      return;
    }
    this.child.stdin.write(prompt);
    this.child.stdin.end();
  }

  private readonly onStdout = (chunk: Buffer): void => {
    if (this.stdout.length < AGY_PROCESS_POLICY.maxOutputBytes) this.stdout += chunk.toString();
  };

  private readonly onStderr = (chunk: Buffer): void => {
    if (this.stderr.length < AGY_PROCESS_POLICY.maxOutputBytes) this.stderr += chunk.toString();
  };

  private readonly onStdinError = (): void => {
    // Preserve ignored stdin errors; the child error/close owns the result.
  };

  private readonly onAbort = (): void => {
    this.terminate(agyError("Generation canceled", 499, "GENERATION_CANCELED"));
  };

  private terminate(reason: Error): void {
    if (this.settled || this.reason) return;
    this.reason = reason;
    clearTimeout(this.timer);
    // Arm before TERM so even a synchronous close clears the grace timer.
    this.graceTimer = setTimeout(() => {
      if (!this.settled) this.child.kill("SIGKILL");
    }, AGY_PROCESS_POLICY.terminateGraceMs);
    this.child.kill("SIGTERM");
  }

  private readonly onError = (err: NodeJS.ErrnoException): void => {
    if (this.settled || this.reason) return;
    const bin = resolveAgyBin();
    const hint = err.code === "ENOENT"
      ? `. "${bin}" was not found — install agy or set IMA2_AGY_BIN=/absolute/path/to/agy`
      : "";
    this.reason = agyError(`Agy process error: ${err.message}${hint}`, 502, "AGY_PROCESS_ERROR");
  };

  private readonly finish = (code: number | null): void => {
    if (this.settled) return;
    this.settled = true;
    clearTimeout(this.timer);
    clearTimeout(this.graceTimer);
    this.signal?.removeEventListener("abort", this.onAbort);
    this.child.stdout.removeListener("data", this.onStdout);
    this.child.stderr.removeListener("data", this.onStderr);
    this.child.stdin.removeListener("error", this.onStdinError);
    this.child.removeListener("error", this.onError);
    this.child.removeListener("close", this.finish);
    if (this.reason) {
      this.reject(this.reason);
      return;
    }
    if (code !== 0 && !this.stdout.trim()) {
      this.reject(agyError(`Agy exited with code ${code}: ${this.stderr.slice(0, 200)}`, 502, "AGY_PROCESS_ERROR"));
      return;
    }
    this.resolve({ stdout: this.stdout, stderr: this.stderr });
  };
}

export function spawnAgy(prompt: string, signal?: AbortSignal): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(agyError("Generation canceled", 499, "GENERATION_CANCELED"));
      return;
    }
    const child = spawn(resolveAgyBin(), ["-p", "-"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        PATH: buildAgyPathEnv(),
        HOME: process.env.HOME,
        USERPROFILE: process.env.USERPROFILE,
        TMPDIR: process.env.TMPDIR,
        TEMP: process.env.TEMP,
        LANG: process.env.LANG,
        GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      },
    });
    new AgyProcessLifetime(child, signal, resolve, reject).start(prompt);
  });
}
