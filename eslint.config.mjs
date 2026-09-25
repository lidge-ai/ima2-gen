import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

const tsFiles = [
  "server.ts",
  "config.ts",
  "routes/**/*.ts",
  "lib/**/*.ts",
  "bin/**/*.ts",
  "scripts/**/*.ts",
  "scripts/**/*.mts",
  "ui/src/**/*.{ts,tsx}",
];

const jsFiles = ["scripts/**/*.mjs", "desktop/**/*.{js,mjs,cjs}"];

const unusedVars = [
  "error",
  {
    args: "after-used",
    argsIgnorePattern: "^_",
    varsIgnorePattern: "^_",
    caughtErrors: "all",
    caughtErrorsIgnorePattern: "^_",
    destructuredArrayIgnorePattern: "^_",
    ignoreRestSiblings: true,
  },
];

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "server.js",
      "config.js",
      "lib/**/*.js",
      "routes/**/*.js",
      "bin/**/*.js",
      "ui/src/generated/**",
      "desktop/dist/**",
    ],
  },
  {
    linterOptions: { reportUnusedDisableDirectives: "error" },
  },
  {
    files: [...tsFiles, ...jsFiles],
    extends: [js.configs.recommended],
    rules: {
      "no-unused-vars": unusedVars,
      "prefer-const": ["error", { ignoreReadBeforeAssign: true }],
      "no-empty": "warn",
      "no-useless-catch": "warn",
      "no-useless-assignment": "warn",
      "preserve-caught-error": "warn",
      // Sanitizers and YAML-shaped matchers spell out control ranges and indentation.
      "no-control-regex": "off",
      "no-regex-spaces": "off",
    },
  },
  {
    files: tsFiles,
    extends: [tseslint.configs.recommended],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["scripts/*.ts", "scripts/lib/*.d.mts"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": unusedVars,
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "warn",
    },
  },
  {
    files: ["ui/src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    files: ["server.ts", "config.ts", "routes/**", "lib/**", "bin/**", "scripts/**", "desktop/**"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ["ui/src/**"],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ["desktop/pages/**/*.js"],
    languageOptions: { sourceType: "script", globals: { ...globals.browser } },
  },
  {
    files: ["desktop/preload.cjs", "scripts/package-published-ui-smoke.mjs"],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ["**/*.cjs"],
    languageOptions: { sourceType: "commonjs" },
  },
);
