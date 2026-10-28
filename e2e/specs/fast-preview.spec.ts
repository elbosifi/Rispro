import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

const root = "http://127.0.0.1:5173";
const base = "/api/doctor/reporting-board/cases/42/fast-preview";
const series = [
  { id: "ct", description: "Axial CT preview", number: "1", modality: "CT", count: 12 },
  { id: "mr", description: "Coronal MR preview", number: "2", modality: "MR", count: 6 },
];

async function mockPreview(page: Page, mode: "normal" | "delayed" | "empty" | "error" = "normal") {
  const requests: string[] = [];
  const smallImage = await sharp(Buffer.from(`<svg width="128" height="128" xmlns="http://www.w3.org/2000/svg">
    <rect width="128" height="128" fill="#030609"/>
    <ellipse cx="64" cy="62" rx="47" ry="54" fill="#b5b8bb"/>
    <ellipse cx="64" cy="62" rx="42" ry="49" fill="#52565b"/>
    <ellipse cx="48" cy="61" rx="19" ry="40" fill="#8b9097"/>
    <ellipse cx="80" cy="61" rx="19" ry="40" fill="#8b9097"/>
    <path d="M62 26 L62 48 L55 60 L62 69 L64 95 L66 69 L73 60 L66 48 L66 26" fill="#262b31"/>
    <text x="64" y="124" text-anchor="middle" font-size="5" fill="#97a0aa">SYNTHETIC TEST IMAGE</text>
  </svg>`)).jpeg().toBuffer();
  const wideImage = await sharp(smallImage).resize(320, 160, { fit: "contain", background: "#030609" }).jpeg().toBuffer();
  await page.route(`${root}/api/**`, async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth/me") return route.fulfill({ json: { user: { id: 1, username: "synthetic", fullName: "Synthetic Preview", role: "doctor" } } });
    if (url.pathname === base) return route.fulfill({ json: {
      study: { patientName: "Synthetic Preview", accessionNumber: "TEST-ONLY", description: "Synthetic study", date: "20261029" },
      series, settings: { quality: 75, maximumWidth: 128 },
    } });
    if (url.pathname.startsWith(`${base}/series/`)) {
      if (mode === "error") return route.fulfill({ status: 503, json: { error: { message: "Preview temporarily unavailable." } } });
      const selected = series.find(item => url.pathname.endsWith(`/${item.id}`))!;
      return route.fulfill({ json: { instances: mode === "empty" ? [] : Array.from({ length: selected.count }, (_, i) => ({ id: `${selected.id}-${i}`, number: i + 1 })) } });
    }
    if (url.pathname.startsWith(`${base}/images/`)) {
      requests.push(url.pathname + url.search);
      if (mode === "delayed" && !url.pathname.endsWith("ct-0")) await new Promise(resolve => setTimeout(resolve, 2000));
      return route.fulfill({ contentType: "image/jpeg", body: url.pathname.includes("mr-") ? wideImage : smallImage });
    }
    return route.fulfill({ json: {} });
  });
  return requests;
}

async function expectSingleScreen(page: Page) {
  const size = page.viewportSize()!;
  const main = await page.getByRole("main").boundingBox();
  expect(main).toEqual({ x: 0, y: 0, width: size.width, height: size.height });
  expect(await page.evaluate(() => ({
    x: scrollX, y: scrollY,
    overflowX: document.documentElement.scrollWidth > innerWidth,
    overflowY: document.documentElement.scrollHeight > innerHeight,
  }))).toEqual({ x: 0, y: 0, overflowX: false, overflowY: false });
}

for (const [name, viewport, mobile] of [
  ["desktop", { width: 1440, height: 960 }, false],
  ["mobile", { width: 390, height: 844 }, true],
  ["small-mobile", { width: 320, height: 568 }, true],
  ["mobile-landscape", { width: 844, height: 390 }, true],
] as const) {
  test.describe(name, () => {
    test.use({ viewport, isMobile: mobile, hasTouch: mobile });
    test("fills the screen, preloads whole series, and contains image navigation", async ({ page }, testInfo) => {
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
      const requests = await mockPreview(page);
      await page.goto("/reporting/fast-preview/42");
      const status = page.getByRole("status");
      await expect(status).toHaveText("1 / 12 · Series loaded");
      expect(requests).toHaveLength(12);
      await expect(page.getByRole("combobox")).toHaveCount(2);
      await expect(page.getByRole("button")).toHaveCount(0);
      const viewer = page.getByRole("region", { name: "Image viewer" });
      const bounds = (await viewer.boundingBox())!;
      const image = page.getByRole("img", { name: "Non-diagnostic study preview" });
      expect(await image.evaluate((element: HTMLImageElement) => ({ width: element.naturalWidth, fit: getComputedStyle(element).objectFit }))).toEqual({ width: 128, fit: "contain" });
      expect(await image.boundingBox()).toEqual(bounds);
      expect(Math.min(bounds.width, bounds.height)).toBeGreaterThan(128);
      await expectSingleScreen(page);
      await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });

      if (mobile) {
        const session = await page.context().newCDPSession(page);
        const x = Math.round(viewport.width / 2);
        const y = Math.round(bounds.y + bounds.height / 2);
        await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
        for (let offset = 10; offset <= 60; offset += 10) {
          await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - offset }] });
        }
        await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await expect(status).toHaveText("4 / 12 · Series loaded");
        await session.detach();
      } else {
        await page.mouse.move(viewport.width / 2, bounds.y + bounds.height / 2);
        await page.mouse.wheel(0, 180);
        await expect(status).toHaveText("2 / 12 · Series loaded");
      }
      await expectSingleScreen(page);
      await viewer.focus();
      await page.keyboard.press("End");
      await expect(status).toHaveText("12 / 12 · Series loaded");
      await page.mouse.move(viewport.width / 2, bounds.y + bounds.height / 2);
      await page.mouse.wheel(0, 200);
      await expect(status).toHaveText("12 / 12 · Series loaded");
      await page.keyboard.press("Home");
      await expect(status).toHaveText("1 / 12 · Series loaded");
      await page.mouse.wheel(0, -200);
      await expectSingleScreen(page);
      expect(requests).toHaveLength(12);

      await page.getByLabel("Window", { exact: true }).selectOption("Brain");
      await expect(status).toHaveText("1 / 12 · Series loaded");
      await expect.poll(() => requests.filter(path => path.endsWith("?center=40&width=80")).length).toBe(12);
      await page.getByLabel("Series", { exact: true }).selectOption("mr");
      await expect(status).toHaveText("1 / 6 · Series loaded");
      expect(requests.filter(path => path.includes("/mr-"))).toHaveLength(6);
      await expect(page.getByLabel("Window", { exact: true })).toHaveValue("dicom");
      expect(await image.evaluate((element: HTMLImageElement) => [element.naturalWidth, element.naturalHeight])).toEqual([320, 160]);
      await expectSingleScreen(page);
      await page.screenshot({ path: testInfo.outputPath(`${name}-wide-image.png`), fullPage: true });
      const source = await image.getAttribute("src");
      await page.setViewportSize({ width: viewport.height, height: viewport.width });
      await expectSingleScreen(page);
      await expect(image).toHaveAttribute("src", source!);
      expect(await image.boundingBox()).toEqual(await viewer.boundingBox());
      expect(await image.evaluate((element: HTMLImageElement) => ({
        width: element.naturalWidth, height: element.naturalHeight, fit: getComputedStyle(element).objectFit,
      }))).toEqual({ width: 320, height: 160, fit: "contain" });
      await expect(status).toHaveText("1 / 6 · Series loaded");
      expect(requests.filter(path => path.includes("/mr-"))).toHaveLength(6);
      await page.screenshot({ path: testInfo.outputPath(`${name}-rotated.png`), fullPage: true });
      expect(errors).toEqual([]);
    });
  });
}

test.describe("mobile states", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  for (const mode of ["delayed", "empty", "error"] as const) {
    test(`keeps ${mode} state inside the screen`, async ({ page }, testInfo) => {
      await mockPreview(page, mode);
      await page.goto("/reporting/fast-preview/42");
      if (mode === "delayed") {
        await expect(page.getByRole("img")).toBeVisible();
        await expect(page.getByRole("status")).toContainText("Loading series");
      } else {
        await expect(page.getByRole("alert")).toHaveText(mode === "empty" ? "This series contains no images." : "Preview temporarily unavailable.");
      }
      await expectSingleScreen(page);
      await page.screenshot({ path: testInfo.outputPath(`${mode}.png`), fullPage: true });
    });
  }
});
