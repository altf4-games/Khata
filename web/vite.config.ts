import { defineConfig, loadEnv, type Plugin } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { handleSign } from "../api/_signer.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

/** Serves POST /api/sign in dev and preview with the same code the Vercel function runs. The keys are read from the ignored root .env into this server process only. */
function demoSigner(): Plugin {
  const env = loadEnv("development", root, "");
  const mw = (req: any, res: any, next: () => void) => {
    if (!req.url?.startsWith("/api/sign")) return next();
    if (req.method !== "POST") { res.statusCode = 405; res.end(JSON.stringify({ error: "POST only." })); return; }
    let data = "";
    req.on("data", (c: Buffer) => (data += c));
    req.on("end", async () => {
      let body: unknown;
      try { body = JSON.parse(data); } catch { body = undefined; }
      const r = await handleSign(body, env);
      if (r.status >= 400) console.warn(`[signer] ${r.status} ${r.body.error}`);
      res.statusCode = r.status;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(r.body));
    });
  };
  return { name: "khata-demo-signer", configureServer: (s) => void s.middlewares.use(mw), configurePreviewServer: (s) => void s.middlewares.use(mw) };
}

export default defineConfig({
  root: here,
  base: "./",
  envDir: root,
  // Only the Arkiv access key is exposed to client code (Arkiv says it is not secret). Demo wallet keys have no client prefix on purpose.
  envPrefix: ["ARKIV_"],
  plugins: [demoSigner()],
  build: { outDir: resolve(here, "../dist"), emptyOutDir: true },
  server: { host: "127.0.0.1", port: 5173, fs: { allow: [root] } },
});
