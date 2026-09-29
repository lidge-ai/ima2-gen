const LAUNCHER_TEXT = {
  foreground: "A terminal ('ima2 serve')",
  background: "The background CLI ('ima2 start')",
  service: "The login service ('ima2 service')",
  desktop: "Another copy of the ima2 app",
};

export function describeLauncher(launcher, serviceManaged = false) {
  if (serviceManaged) return LAUNCHER_TEXT.service;
  return LAUNCHER_TEXT[launcher] ?? "Another ima2 install";
}

/** The text of the takeover question, kept pure so it can be tested. */
export function takeoverPromptOptions(status) {
  const r = status.runtime;
  const managed = status.serviceOwnership === "managed";
  const lines = [
    `${describeLauncher(r.launcher, managed)} is running ima2${r.version ? ` ${r.version}` : ""} at ${r.url} (pid ${r.pid}).`,
    "",
    "Use the bundled server: stop it and start the server inside this app.",
    "Keep using it: connect to it as it is. You can switch later from the tray menu.",
  ];
  if (managed) lines.push("", "It belongs to the login service, so it starts again at your next login unless you run 'ima2 service uninstall'.");
  return {
    type: "question",
    buttons: ["Use the bundled server", "Keep using it"],
    defaultId: 0,
    cancelId: 1,
    message: "Another ima2 server is already running",
    detail: lines.join("\n"),
    checkboxLabel: "Remember my choice",
    checkboxChecked: false,
  };
}

export async function askTakeover({ dialog, status, parent }) {
  const options = takeoverPromptOptions(status);
  const { response, checkboxChecked } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
  return { approve: response === 0, remember: checkboxChecked === true };
}
