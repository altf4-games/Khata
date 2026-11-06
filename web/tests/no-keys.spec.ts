// Regression test for the key-in-the-bundle problem: a demo wallet key must never be readable in the built site.
import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generatePrivateKey } from "viem/accounts";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
}

test("no demo wallet key appears anywhere in the production build", async () => {
  test.setTimeout(180_000);
  const planted = generatePrivateKey();
  const out = mkdtempSync(join(tmpdir(), "khata-build-"));
  // the build is given a key through the environment (as Vercel would) and must not embed it
  execFileSync("npx", ["vite", "build", "--config", "web/vite.config.ts", "--outDir", out, "--emptyOutDir", "--logLevel", "error"], {
    env: { ...process.env, DEMO_SUPPLIER_KEY: planted, DEMO_ATTESTER_KEY: planted }, stdio: "pipe",
  });
  const text = files(out).filter((f) => !/\.(woff2?|png|jpg)$/.test(f)).map((f) => readFileSync(f, "utf8")).join("\n").toLowerCase();
  expect(text.length).toBeGreaterThan(100_000);
  expect(text, "planted key").not.toContain(planted.slice(2).toLowerCase());
  // and none of the real keys in the ignored .env, when present
  let real: string[] = [];
  try {
    real = readFileSync(".env", "utf8").split("\n").filter((l) => /^DEMO_[A-Z0-9_]+_KEY=0x[0-9a-fA-F]{64}/.test(l)).map((l) => l.split("=")[1].trim().slice(2).toLowerCase());
  } catch {}
  for (const k of real) expect(text).not.toContain(k);
  expect(text).not.toMatch(/\b[0-9a-f]{64}\b.{0,40}demo_.*key/);
});
