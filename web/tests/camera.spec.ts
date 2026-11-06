// The camera path with a fake camera: a canvas stream that shows the NIC sample QR the way a laptop webcam would see a
// printed or on-screen code (modest resolution, a little blur), unflipped and mirrored.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const qrPng = "data:image/png;base64," + readFileSync(new URL("./fixtures/nic-sample-qr.png", import.meta.url)).toString("base64");

async function fakeCamera(page: Page, opts: { w: number; h: number; qr: number; mirror?: boolean; blur?: number }) {
  await page.addInitScript(({ png, o }) => {
    const img = new Image();
    img.src = png;
    navigator.mediaDevices.getUserMedia = async () => {
      await img.decode();
      const c = document.createElement("canvas");
      c.width = o.w; c.height = o.h;
      const g = c.getContext("2d")!;
      const draw = () => {
        g.fillStyle = "#8a8f94"; g.fillRect(0, 0, o.w, o.h); // the room
        g.save();
        if (o.mirror) { g.translate(o.w, 0); g.scale(-1, 1); }
        g.filter = `blur(${o.blur ?? 0.6}px)`;
        g.drawImage(img, (o.w - o.qr) / 2, (o.h - o.qr) / 2, o.qr, o.qr);
        g.restore();
        requestAnimationFrame(draw);
      };
      draw();
      return c.captureStream(30);
    };
  }, { png: qrPng, o: opts });
}

const scan = async (page: Page) => {
  await page.goto("/?reads=direct#app");
  await page.getByRole("button", { name: "Scan with camera" }).click();
};

test("a QR in front of a 720p laptop camera is found and the invoice is verified without another tap", async ({ page }) => {
  await fakeCamera(page, { w: 1280, h: 720, qr: 420 });
  await scan(page);
  await expect(page.locator(".stamp").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".badge.real").first()).toBeVisible(); // read as the NIC sample, signed by the NIC key
  await expect(page.locator("textarea#token")).toHaveValue(/^eyJ/);
});

test("the page says it is looking, and says when it found the QR", async ({ page }) => {
  await fakeCamera(page, { w: 1280, h: 720, qr: 420 });
  await scan(page);
  await expect(page.getByRole("status").filter({ hasText: /Looking for a QR/ })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("status").filter({ hasText: /QR code found/ })).toBeVisible({ timeout: 30_000 });
});

test("a mirrored camera image is read as well", async ({ page }) => {
  await fakeCamera(page, { w: 1280, h: 720, qr: 420, mirror: true });
  await scan(page);
  await expect(page.locator(".stamp").first()).toBeVisible({ timeout: 30_000 });
});

test("a QR that is too small or blurred to read tells the visitor what to do, instead of staying silent", async ({ page }) => {
  await fakeCamera(page, { w: 640, h: 480, qr: 150, blur: 1.4 });
  await scan(page);
  await expect(page.getByRole("status").filter({ hasText: /Still looking.*closer/ })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("status").filter({ hasText: /640 px wide/ })).toBeVisible(); // and why: this camera is low resolution
});

test("a denied camera says so and does not look like it is running", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException("denied", "NotAllowedError"); };
  });
  await page.goto("/?reads=direct#app");
  await page.getByRole("button", { name: "Scan with camera" }).click();
  await expect(page.getByText(/Camera permission was denied/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Scan with camera" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop camera" })).toHaveCount(0);
});

test("leaving the app switches the camera off", async ({ page }) => {
  await fakeCamera(page, { w: 1280, h: 720, qr: 40 }); // too small to be read, so it keeps scanning
  await page.addInitScript(() => {
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    (window as any).__tracks = [];
    navigator.mediaDevices.getUserMedia = async (c) => { const s = await real(c); (window as any).__tracks.push(...s.getTracks()); return s; };
  });
  await scan(page);
  await expect(page.getByRole("button", { name: "Stop camera" })).toBeVisible();
  await page.evaluate(() => { location.hash = ""; });
  await expect.poll(() => page.evaluate(() => (window as any).__tracks.map((t: MediaStreamTrack) => t.readyState))).toEqual(["ended"]);
});
