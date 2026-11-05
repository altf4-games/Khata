import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  base: "./",
  build: { outDir: resolve(here, "../dist"), emptyOutDir: true },
  server: { host: "127.0.0.1", port: 5173, fs: { allow: [resolve(here, "..")] } },
});
