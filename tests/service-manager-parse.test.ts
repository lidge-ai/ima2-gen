import test from "node:test";
import assert from "node:assert/strict";
import {
  inspectManager,
  parseLaunchctlPrint,
  parseServiceConfigDir,
  parseSystemctlShow,
  serviceOwnership,
  type ManagerState,
} from "../bin/lib/serviceManager.ts";

// devlog/_plan/260929_background_runtime/000 C1: a failed manager query is
// "unknown", never "no service" — otherwise stop kills what KeepAlive restarts.

const LAUNCHCTL = `gui/501/com.ima2.server = {
	active count = 1
	path = /Users/me/Library/LaunchAgents/com.ima2.server.plist
	state = running
	program = /usr/local/bin/node
	pid = 4242
}`;

test("launchctl print output yields pid and running state", () => {
  assert.deepEqual(parseLaunchctlPrint(LAUNCHCTL), { pid: 4242, active: true });
  assert.deepEqual(parseLaunchctlPrint("\tstate = not running\n"), { pid: null, active: false });
  assert.equal(parseLaunchctlPrint("garbage"), null);
});

test("systemctl show output yields MainPID and ActiveState", () => {
  assert.deepEqual(parseSystemctlShow("MainPID=77\nActiveState=active\n"), { pid: 77, active: true });
  assert.deepEqual(parseSystemctlShow("MainPID=0\nActiveState=inactive\n"), { pid: null, active: false });
  assert.equal(parseSystemctlShow("nothing"), null);
});

test("inspectManager distinguishes absent, bound and unknown", () => {
  const ok = (stdout: string) => () => ({ ok: true, stdout, stderr: "" });
  const fail = (stderr: string) => () => ({ ok: false, stdout: "", stderr });
  assert.deepEqual(inspectManager({ platform: "darwin", exists: () => false }), { state: "absent" });
  assert.deepEqual(inspectManager({ platform: "darwin", exists: () => true, run: fail("Could not find service") }), { state: "absent" });
  assert.equal(inspectManager({ platform: "darwin", exists: () => true, run: fail("Operation not permitted") }).state, "unknown");
  const readFile = () => "Environment=IMA2_CONFIG_DIR=/srv/ima2\n";
  assert.deepEqual(inspectManager({ platform: "darwin", exists: () => true, run: ok(LAUNCHCTL), readFile }), { state: "bound", kind: "launchd", pid: 4242, active: true, configDir: "/srv/ima2" });
  assert.deepEqual(inspectManager({ platform: "linux", exists: () => true, run: ok("MainPID=9\nActiveState=active"), readFile: () => { throw new Error("EACCES"); } }), { state: "bound", kind: "systemd", pid: 9, active: true, configDir: null });
  assert.equal(inspectManager({ platform: "linux", exists: () => true, run: fail("Failed to connect to bus") }).state, "unknown");
  assert.deepEqual(inspectManager({ platform: "win32" }), { state: "absent" });
});

test("service ownership needs the manager to report the runtime's own pid", () => {
  const bound = (pid: number | null, active = true): ManagerState => ({ state: "bound", kind: "launchd", pid, active, configDir: null });
  assert.equal(serviceOwnership({ pid: 5 }, bound(5)), "managed");
  // A pre-upgrade service server does not report its launcher: the pid match still decides.
  assert.equal(serviceOwnership({ pid: 5, launcher: null }, bound(5)), "managed");
  // A desktop server beside a dormant or unrelated service registration is not the service's.
  assert.equal(serviceOwnership({ pid: 5, launcher: "desktop" }, bound(null, false)), "unmanaged");
  assert.equal(serviceOwnership({ pid: 5, launcher: "desktop" }, bound(9)), "unmanaged");
  // A server claiming the service launcher without a matching manager is ambiguous.
  assert.equal(serviceOwnership({ pid: 5, launcher: "service" }, bound(9)), "unknown");
  assert.equal(serviceOwnership({ pid: 5, launcher: "service" }, { state: "absent" }), "unknown");
  assert.equal(serviceOwnership({ pid: 5 }, { state: "unknown", reason: "x" }), "unknown");
  assert.equal(serviceOwnership({ pid: 5 }, { state: "absent" }), "unmanaged");
});

test("the service's config dir comes from the plist or unit, else the default", () => {
  assert.equal(parseServiceConfigDir("<key>IMA2_CONFIG_DIR</key><string>/a &amp; b</string>"), "/a & b");
  assert.equal(parseServiceConfigDir("Environment=IMA2_CONFIG_DIR=/srv/ima2\n"), "/srv/ima2");
  assert.equal(parseServiceConfigDir("<key>IMA2_SERVICE</key><string>1</string>", "/home/me"), "/home/me/.ima2");
});
