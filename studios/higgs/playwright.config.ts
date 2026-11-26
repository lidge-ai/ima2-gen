import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://127.0.0.1:5199", browserName: "chromium" },
  webServer: [
    { command: "PORT=8799 node ../kit/src/fake/cli.ts", url: "http://127.0.0.1:8799/api/media/catalog", reuseExistingServer: false },
    { command: "IMA2_STUDIO_API=http://127.0.0.1:8799 PORT=5199 npx vite --host 127.0.0.1", url: "http://127.0.0.1:5199", reuseExistingServer: false },
  ],
});
