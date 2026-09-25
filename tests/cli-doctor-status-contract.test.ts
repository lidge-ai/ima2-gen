import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function readSource(path) {
  return readFileSync(path, "utf-8");
}

describe("CLI doctor/status hardening contract", () => {
  it("surfaces generated dir, advertised server, skill integrity, and native binding health", () => {
    const ima2 = readSource("bin/ima2.ts");
    const doctorCommand = readSource("bin/commands/doctor.ts");
    const doctorChecks = readSource("bin/lib/doctor-checks.ts");

    assert.match(ima2, /Generated dir:/);
    assert.match(ima2, /Advertised server:/);
    assert.match(doctorCommand, /buildHardeningDoctorLines/);
    assert.match(doctorChecks, /Preferred backend port/);
    assert.match(doctorChecks, /Card News:/);
    const runtime = readSource("bin/lib/doctor-runtime.ts");
    assert.match(doctorChecks, /checkPackagedSkills/);
    assert.match(runtime, /"ima2", "ima2-front", "ima2-uiux"/);
    assert.match(runtime, /better-sqlite3 native binding/);
    assert.match(doctorChecks, /chmod 600/);
  });
});
