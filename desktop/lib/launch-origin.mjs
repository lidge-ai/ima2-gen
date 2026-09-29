/** The flag the login registration passes back to us on Linux and Windows. */
export const AUTOSTART_FLAG = "--autostart";

/**
 * "login" when the OS started the app at sign-in, else "user". A login launch
 * is unattended: it never shows a takeover prompt.
 */
export function launchOrigin(argv = process.argv, loginSettings = {}) {
  if (argv.includes(AUTOSTART_FLAG)) return "login";
  if (loginSettings?.wasOpenedAtLogin === true) return "login";
  return "user";
}
