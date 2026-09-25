# node_modules built reproducibly from the committed lockfiles, via
# importNpmLock — no `npm install`, no npmDepsHash to maintain (it uses the
# integrity/SRI hashes already present in package-lock.json).
#
# There are two npm projects: the root server/CLI and the Vite frontend under
# ui/. Each gets its own node_modules derivation.
#
# NOTE on the node version: importNpmLock's npmConfigHook compiles native
# modules (better-sqlite3) against the *default* `nodejs` it is called with —
# not a version injected into buildNodeModules. Whoever consumes these
# derivations must run them on the SAME `nodejs`, or better-sqlite3 crashes at
# `new Database()` with a NODE_MODULE_VERSION ABI mismatch. callPackage injects
# pkgs.nodejs here, matching the hook default; keep it that way.
{
  lib,
  importNpmLock,
  nodejs,
  src,
}:
let
  # A vendored `file:vendor/<name>.tgz` dependency (none today; openai-oauth was one
  # until GPT OAuth moved in process). importNpmLock resolves a `file:` entry as
  # `npmRoot + "/" + resolved`, which keeps the literal `file:` prefix and points
  # outside the tree. Strip it so it resolves to the committed tgz; npm then
  # installs it by extraction. (buildNodeModules does not forward
  # packageSourceOverrides, so patch the lock.) Every `file:` entry is patched so
  # adding or removing a vendored tarball needs no change here.
  rootLock = lib.importJSON (src + "/package-lock.json");
  stripFilePrefix = entry:
    if entry ? resolved && lib.hasPrefix "file:" entry.resolved
    then entry // { resolved = lib.removePrefix "file:" entry.resolved; }
    else entry;
  patchedRootLock = rootLock // {
    packages = lib.mapAttrs (_: stripFilePrefix) rootLock.packages;
  };
in
{
  root = importNpmLock.buildNodeModules {
    npmRoot = src;
    packageLock = patchedRootLock;
    inherit nodejs;
  };

  ui = importNpmLock.buildNodeModules {
    npmRoot = src + "/ui";
    inherit nodejs;
  };
}
