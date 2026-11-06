// What the visitor pastes or scans becomes exactly the token the contract reads.
import { expect, test } from "@playwright/test";
import { normalizeToken } from "../src/token";

const T = "eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJOSUMiLCJkYXRhIjoie30ifQ.c2lnbmF0dXJlX2J5dGVzX2hlcmU";

test("a token pasted with line breaks and spaces inside is joined back together", () => {
  expect(normalizeToken(`  ${T.slice(0, 20)}\n${T.slice(20, 40)} \r\n${T.slice(40)}  `)).toEqual({ token: T });
});
test("a token inside a link or label is taken out", () => {
  expect(normalizeToken(`https://example.invalid/verify?qr=${T}&x=1`)).toEqual({ token: T });
  expect(normalizeToken(`Signed QR: ${T}`)).toEqual({ token: T });
});
test("a plain token is left as it is, and other text passes through for the contract to judge", () => {
  expect(normalizeToken(T)).toEqual({ token: T });
  expect(normalizeToken("not a token")).toEqual({ token: "notatoken" });
});
test("text larger than the contract accepts is refused here, before anything is sent", () => {
  expect(normalizeToken("a".repeat(5000))).toEqual({ token: "", tooLarge: true });
});

test("in the app, a sample QR pasted with line breaks still verifies, and an oversized paste is refused in plain words", async ({ page }) => {
  const { readFileSync } = await import("node:fs");
  const sample = readFileSync(new URL("../../contracts/test/fixtures/nic-sample.token", import.meta.url), "utf8").trim();
  await page.goto("/?reads=direct#app");
  await page.locator("textarea#token").fill(sample.match(/.{1,60}/g)!.join("\n"));
  await expect(page.locator(".badge.real").first()).toBeVisible({ timeout: 30_000 });
  await page.locator("textarea#token").fill("x".repeat(5000));
  await expect(page.getByText("That text is too long to be an e-invoice QR")).toBeVisible();
});
