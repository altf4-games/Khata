import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  base: "./",
  // Demo wallet keys (DEMO_*_KEY) are read from the ignored root .env for local runs only.
  envDir: resolve(here, ".."),
  envPrefix: "DEMO_",
  build: { outDir: resolve(here, "../dist"), emptyOutDir: true },
  server: { host: "127.0.0.1", port: 5173, fs: { allow: [resolve(here, "..")] } },
});
