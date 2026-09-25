{
  description = "ima2-gen — local OAuth image generation studio";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        inherit (pkgs) lib;

        # node_modules from the lockfiles (root + ui). callPackage injects
        # pkgs.nodejs, importNpmLock, lib; we supply the source. Narrow it to
        # just the dependency-relevant files (the package manifests and
        # lockfiles) so editing server/UI code doesn't force a node_modules
        # rebuild.
        depsSrc = lib.fileset.toSource {
          root = ./.;
          fileset = lib.fileset.unions [
            ./package.json
            ./package-lock.json
            ./ui/package.json
            ./ui/package-lock.json
          ];
        };
        nodeModules = pkgs.callPackage ./nix/node-modules.nix { src = depsSrc; };

        tests = pkgs.callPackage ./nix/tests.nix {
          src = self;
          rootModules = nodeModules.root;
          uiModules = nodeModules.ui;
        };

        ima2-gen = pkgs.callPackage ./nix/ima2-gen.nix {
          src = self;
          rootModules = nodeModules.root;
          uiModules = nodeModules.ui;
          inherit tests;
        };
      in
      {
        packages = {
          default = ima2-gen;
          inherit ima2-gen;
        };

        # `nix run` → start the studio (binds 127.0.0.1:3333 by default).
        apps.default = {
          type = "app";
          program = lib.getExe ima2-gen;
        };

        # `nix flake check` runs the suite (same derivation as
        # `nix build .#ima2-gen.tests`).
        checks.tests = ima2-gen.tests;

        devShells.default = pkgs.mkShell {
          packages = [
            pkgs.nodejs
            pkgs.importNpmLock.hooks.linkNodeModulesHook
          ];

          # linkNodeModulesHook materializes ./node_modules from this.
          npmDeps = nodeModules.root;

          shellHook = ''
            linkNodeModulesHook
            ln -sfn ${nodeModules.ui}/node_modules ui/node_modules

            echo ""
            echo "ima2-gen dev shell  ·  node $(node -v)  ·  deps from package-lock.json (no npm install)"
            echo ""
            echo "  npm run ui:build              # build the UI bundle (server serves ui/dist)"
            echo "  npm run dev:server            # run the server (tsx watch; binds 127.0.0.1:3333)"
            echo "  IMA2_HOST=\$(tailscale ip -4) npm run dev:server   # expose on your tailnet"
            echo ""
            echo "  Adding/removing deps: edit package.json, then"
            echo "    npm install --package-lock-only   # update lockfile only"
            echo "  and reload the shell so Nix rebuilds node_modules."
            echo ""
          '';
        };
      });
}
