import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const target = process.env.IMA2_STUDIO_API ?? "http://127.0.0.1:8790";
const proxy = { target, changeOrigin: false, ws: false };

export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@ima2/studio-kit": fileURLToPath(new URL("../kit/src/index.ts", import.meta.url)),
    },
  },
  server: {
    port: Number(process.env.PORT ?? 5190),
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] },
    proxy: { "/api": proxy, "/files": proxy, "/generated": proxy },
  },
  build: { outDir: "dist", sourcemap: true },
});
