import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// GitHub Pages serves the app from /<repo>/, so all asset URLs are relative.
export default defineConfig({
  base: "./",
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  esbuild: { jsx: "automatic", jsxImportSource: "preact" },
  build: { target: "es2022", sourcemap: true },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
