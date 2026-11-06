// Anon-RPC in the real browser. The page must read through the worker by default, say so while it warms up,
// and never fall back to a direct read without the user choosing it.
import { expect, test, type Page } from "@playwright/test";

test.setTimeout(180_000);

const RPC_HOSTS = ["rpc.testnet.whitechain.io", "rpc.rabdi.db-chain.testnet.arkiv.network"];

/** Records every request the page itself makes to a chain RPC host, with its JSON-RPC method names. */
function watchDirectRpc(page: Page) {
  const seen: { host: string; methods: string[] }[] = [];
  page.on("request", (req) => {
    const host = new URL(req.url()).host;
    if (!RPC_HOSTS.includes(host)) return;
    let methods: string[] = [];
    try {
      const body = JSON.parse(req.postData() ?? "null");
      methods = (Array.isArray(body) ? body : [body]).map((b: any) => b?.method).filter(Boolean);
    } catch {}
    seen.push({ host, methods });
  });
  return seen;
}

// This one needs a browser whose WebRTC can reach the Anon-RPC gateway (EF's demo gateway is shared and flaky).
// The browser that Playwright launches here could not reach it in repeated runs ("all gateways failed"), while the Claude
// app's browser pane reached it intermittently. Run it with ANON_E2E=1 where the gateway answers.
test("reads go through Anon-RPC by default and the page makes no direct chain RPC request", async ({ page }) => {
  test.skip(process.env.ANON_E2E !== "1", "needs a browser that can reach the Anon-RPC gateway; set ANON_E2E=1");
  const direct = watchDirectRpc(page);
  await page.goto("/#app");

  // while Tor warms up, the page says what is happening (cold start is 8 to 17 s)
  await expect(page.getByRole("status").filter({ hasText: "Starting Anon-RPC" })).toBeVisible({ timeout: 10_000 });

  // then it is ready, and the notes and Arkiv panels load through it
  const chip = page.getByTestId("reads-chip");
  // "starting Anon-RPC…" also contains the words, so wait for the ready form with a percentage
  await expect(chip).toHaveText(/Reads: Anon-RPC/, { timeout: 90_000 });
  await page.getByRole("tab", { name: /Investor/ }).click();
  await expect(page.locator(".note").first()).toBeVisible({ timeout: 120_000 });
  await expect(page.locator("#h-market")).toBeVisible();

  // share of read traffic through Anon-RPC is shown, and it is all of it
  await expect(chip).toContainText("100%");
  expect(direct, `direct chain RPC requests from the page: ${JSON.stringify(direct)}`).toEqual([]);
});

test("if Anon-RPC cannot start, the page says so and reads nothing directly until the user chooses to", async ({ page }) => {
  const direct = watchDirectRpc(page);
  // a specifier address with no contract behind it: the worker cannot boot
  await page.goto("/?anonSpecifier=0x0000000000000000000000000000000000000001#app");

  const alert = page.getByRole("alert").filter({ hasText: "Anonymous reads are unavailable" });
  await expect(alert).toBeVisible({ timeout: 60_000 });
  await expect(alert.getByRole("button", { name: "Retry anonymous reads" })).toBeVisible();
  await page.waitForTimeout(3000);
  expect(direct, "no silent fallback: nothing may be read directly before the user chooses").toEqual([]);

  // an explicit choice switches to direct reads, and the page says it is not anonymous
  await alert.getByRole("button", { name: "Read directly (not anonymous)" }).click();
  await expect(page.getByTestId("reads-chip")).toContainText("direct", { timeout: 10_000 });
  await expect(page.getByTestId("reads-chip")).toContainText("not anonymous");
  await expect.poll(() => direct.length, { timeout: 30_000 }).toBeGreaterThan(0);
});

test("?reads=direct is an explicit opt-out and is labelled as such", async ({ page }) => {
  await page.goto("/?reads=direct#app");
  await expect(page.getByTestId("reads-chip")).toContainText("direct");
  await expect(page.getByTestId("reads-chip")).toContainText("not anonymous");
  await page.getByRole("tab", { name: /Investor/ }).click();
  await expect(page.locator(".note").first()).toBeVisible({ timeout: 60_000 });
});

test("an unreachable gateway is reported in plain words within seconds, with a choice and nothing read directly", async ({ page }) => {
  const direct = watchDirectRpc(page);
  // 203.0.113.0/24 is reserved for documentation and is not routed
  await page.goto("/?anonFallback=off&anonGateway=203.0.113.1:12298:uEiCH0VdbhryzJcMtCfB0vLA4sOvHdQ4hq5w7CopcwU59bQ#app");
  const alert = page.getByRole("alert").filter({ hasText: "Anonymous reads are unavailable" });
  await expect(alert).toBeVisible({ timeout: 60_000 });
  await expect(alert).toContainText("could not be reached over WebRTC");
  await expect(alert.getByRole("button", { name: "Retry anonymous reads" })).toBeVisible();
  expect(direct, "an unreachable gateway must not turn into a direct read").toEqual([]);
});

test("a slow start offers the choice while it keeps waiting", async ({ page }) => {
  const direct = watchDirectRpc(page);
  await page.goto("/?anonSlowAfter=1500&anonFallback=off&anonGateway=203.0.113.1:12298:uEiCH0VdbhryzJcMtCfB0vLA4sOvHdQ4hq5w7CopcwU59bQ#app");
  await expect(page.getByText("This is taking longer than usual")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: "Start over" })).toBeVisible();
  expect(direct).toEqual([]);
});

// Nym needs no gateway, so unlike Tor it does not depend on EF's shared demo gateway.
test("on Nym, reads go through Anon-RPC and the page makes no direct chain RPC request", async ({ page }) => {
  const direct = watchDirectRpc(page);
  await page.goto("/?anonNetwork=nym&anonFallback=off#app");
  const chip = page.getByTestId("reads-chip");
  await expect(chip).toHaveText(/Reads: Anon-RPC \(Nym\)/, { timeout: 120_000 });
  await page.getByRole("tab", { name: /Investor/ }).click();
  await expect(page.locator(".note").first()).toBeVisible({ timeout: 120_000 });
  await expect(chip).toContainText("100%");
  expect(direct, `direct chain RPC requests from the page: ${JSON.stringify(direct)}`).toEqual([]);
});

test("when the Tor gateway is down the page says so, switches to Nym, and still reads nothing directly", async ({ page }) => {
  const direct = watchDirectRpc(page);
  await page.goto("/?anonGateway=203.0.113.1:12298:uEiCH0VdbhryzJcMtCfB0vLA4sOvHdQ4hq5w7CopcwU59bQ#app");
  await expect(page.getByText(/Trying Nym instead/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("reads-chip")).toHaveText(/Reads: Anon-RPC \(Nym\)/, { timeout: 120_000 });
  expect(direct, `direct chain RPC requests from the page: ${JSON.stringify(direct)}`).toEqual([]);
});

// A Tor start that neither fails nor finishes (guards that cannot be reached keep it retrying) must not leave the user waiting.
test("a Tor start that takes longer than its deadline switches to Nym and says why", async ({ page }) => {
  const direct = watchDirectRpc(page);
  await page.goto("/?anonBootDeadline=1000#app");
  await expect(page.getByText(/Tor did not finish starting in 1 s\. Trying Nym instead/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("reads-chip")).toHaveText(/Reads: Anon-RPC \(Nym\)/, { timeout: 120_000 });
  expect(direct, `direct chain RPC requests from the page: ${JSON.stringify(direct)}`).toEqual([]);
});

// Some visitors only want to get in. The switch is always one tap away, honest about what it gives up, and reversible.
test("a visitor can switch to direct reads straight away, it sticks across a reload, and they can switch back", async ({ page }) => {
  await page.goto("/#app");
  const toggle = page.getByTestId("reads-toggle");
  await expect(toggle).toBeVisible({ timeout: 10_000 });
  await expect(toggle).toContainText("Read directly");
  await expect(toggle).toContainText("not anonymous");
  const box = await toggle.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);

  await toggle.click();
  await expect(page.getByTestId("reads-chip")).toContainText("direct");
  await expect(page.getByTestId("reads-chip")).toContainText("not anonymous");
  await page.getByRole("tab", { name: /Investor/ }).click();
  await expect(page.locator(".note").first()).toBeVisible({ timeout: 60_000 });

  await page.reload();
  await expect(page.getByTestId("reads-chip")).toContainText("direct"); // remembered
  await expect(page.getByTestId("reads-toggle")).toContainText("Use Anon-RPC");

  await page.getByTestId("reads-toggle").click();
  await expect(page.getByTestId("reads-chip")).not.toContainText("not anonymous");
  await expect(page.getByTestId("reads-toggle")).toContainText("Read directly");
});

test("the choice to read directly is not made for the visitor: a fresh visit starts on Anon-RPC", async ({ page }) => {
  const direct = watchDirectRpc(page);
  await page.goto("/#app");
  await expect(page.getByTestId("reads-chip")).toContainText(/Anon-RPC/);
  await page.waitForTimeout(2000);
  expect(direct).toEqual([]);
});

// The Privacy page shows evidence, not a promise: the self-test gates "ready", the audit holds, and the outside service sees
// a different address through the route than straight from the browser.
test("on Nym, the Privacy page audits that every read was private and shows the route hides the address", async ({ page }) => {
  const direct = watchDirectRpc(page);
  await page.goto("/?anonNetwork=nym&anonFallback=off#app");
  await expect(page.getByTestId("reads-chip")).toHaveText(/Reads: Anon-RPC \(Nym\)/, { timeout: 120_000 });
  await page.getByRole("tab", { name: /Investor/ }).click();
  await expect(page.locator(".note").first()).toBeVisible({ timeout: 120_000 });
  await page.getByTestId("reads-chip").click();
  await expect(page.getByTestId("privacy-audit")).toBeVisible();
  await expect(page.locator('tr[data-route="anon"]').first()).toBeVisible();
  await expect(page.locator('tr[data-route="direct"]')).toHaveCount(0);
  await page.getByTestId("privacy-compare").click();
  await expect(page.getByTestId("privacy-verdict")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("privacy-verdict")).toContainText("not you");
  expect(direct, `direct chain RPC requests from the page: ${JSON.stringify(direct)}`).toEqual([]);
});
