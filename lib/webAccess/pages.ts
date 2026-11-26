import type { Response } from "express";

/** Small server-rendered pages for Google sign-in. No script; inline styles only. */
const escape = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function render(res: Response, status: number, title: string, body: string): void {
  res.status(status);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; form-action 'self'");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.type("html").send("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
    + "<title>" + escape(title) + " · ima2</title><style>"
    + "body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b0d;color:#e8e8ea;font:15px/1.5 system-ui,sans-serif}"
    + "main{max-width:360px;padding:32px;text-align:center}h1{font-size:20px;margin:0 0 12px}p{color:#a1a1aa;margin:0 0 20px}"
    + "a.button{display:inline-block;padding:10px 18px;border:1px solid #3f3f46;background:#18181b;color:#fff;text-decoration:none}"
    + "</style></head><body><main>" + body + "</main></body></html>");
}

export function loginPage(res: Response, returnTo: string): void {
  render(res, 200, "Sign in", "<h1>ima2</h1><p>Sign in with the Google account this site allows.</p>"
    + "<a class=\"button\" href=\"/auth/google/start?return=" + escape(encodeURIComponent(returnTo)) + "\">Sign in with Google</a>");
}

export function refusedPage(res: Response, kind: "not-allowed" | "cancelled" | "expired" | "failed", email?: string): void {
  // Cloudflare's Email Address Obfuscation rewrites bare addresses into a script-decoded link that the
  // page CSP blocks; email_off keeps the address readable.
  const who = email ? "<!--email_off-->" + escape(email) + "<!--/email_off-->" : "This account";
  const text = kind === "not-allowed" ? who + " is not allowed on this site."
    : kind === "cancelled" ? "Sign-in was cancelled."
    : kind === "expired" ? "The sign-in took too long or started in another browser. Start again."
    : "Sign-in could not be verified. Start again.";
  render(res, 403, "Not signed in", "<h1>Not signed in</h1><p>" + text + "</p><a class=\"button\" href=\"/auth/login\">Back to sign-in</a>");
}

export function signedOutPage(res: Response): void {
  render(res, 200, "Signed out", "<h1>Signed out</h1><p>You are signed out of ima2. Other sites keep their own sign-in.</p>"
    + "<a class=\"button\" href=\"/auth/login\">Sign in again</a>");
}
