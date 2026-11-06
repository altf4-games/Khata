import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "web/tests",
  timeout: 60_000,
  use: { baseURL: "http://127.0.0.1:5173" },
  webServer: [
    { command: "npm run web:dev", url: "http://127.0.0.1:5173", reuseExistingServer: true, timeout: 60_000 },
    // the browser prover only works from the production build (the dev server's pre-bundler breaks its WebAssembly workers)
    { command: "npm run web:build && npm run web:preview", url: "http://127.0.0.1:4173", reuseExistingServer: true, timeout: 120_000 },
  ],
});
