import { inspectGeneratedStorage } from "../../lib/storageMigration.js";
import type { RouteRuntimeContext } from "../../lib/runtimeContext.js";

export async function buildStorageDoctorLines(ctx: RouteRuntimeContext) {
  const status = await inspectGeneratedStorage(ctx);
  const lines = [
    "  Storage",
    `    Current gallery: ${status.generatedDirLabel}`,
    `    Source: ${status.overrides.generatedDir ? "IMA2_GENERATED_DIR" : "default"}`,
    `    Images in current gallery: ${status.targetFileCount}`,
    `    Legacy folders scanned: ${status.legacyCandidatesScanned}`,
    `    Legacy folders found: ${status.legacySourcesFound}`,
  ];

  for (const source of status.legacySources.slice(0, 5)) {
    lines.push(`      - ${source.path} (${source.fileCount} files)`);
  }
  if (status.legacySources.length > 5) {
    lines.push(`      ...and ${status.legacySources.length - 5} more`);
  }

  lines.push("");
  lines.push("  Next step");
  if (status.state === "recoverable") {
    lines.push("    Old images may still be recoverable. Restart ima2 or copy them manually.");
  } else if (status.state === "not_found") {
    lines.push("    No previous generated folder was found on this machine.");
    lines.push("    If the old global install folder was replaced during update, backups may be required.");
  } else if (status.state === "unknown") {
    lines.push("    Storage status could not be fully checked.");
  } else {
    lines.push("    Current gallery storage looks available.");
  }
  lines.push(`    See: ${status.recoveryDocsPath}`);
  lines.push("    macOS/Linux: cp -n \"/old/ima2-gen/generated/\"* ~/.ima2/generated/");
  lines.push("    Windows: Copy old generated files into %USERPROFILE%\\.ima2\\generated");

  return lines;
}
