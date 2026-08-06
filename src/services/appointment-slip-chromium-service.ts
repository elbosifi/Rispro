import { chromium, type Browser, type Page } from "playwright-core";

export class AppointmentSlipRenderError extends Error {
  constructor(message: string, public readonly cause?: unknown) { super(message); this.name = "AppointmentSlipRenderError"; }
}

const RENDER_TIMEOUT_MS = 45_000;

type BrowserLauncher = (options: Parameters<typeof chromium.launch>[0]) => Promise<Browser>;

export async function renderAppointmentSlipPdf(renderUrl: string, launch: BrowserLauncher = chromium.launch.bind(chromium)): Promise<Buffer> {
  let browser: Browser | undefined;
  let page: Page | undefined;
  let stage = "launch";
  try {
    browser = await launch({
      executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || "/usr/bin/chromium",
      // The application image runs Node as root. Chromium therefore requires its sandbox disabled;
      // it is limited to this short-lived, token-scoped same-container render request.
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    stage = "page";
    page = await browser.newPage();
    page.setDefaultTimeout(RENDER_TIMEOUT_MS);
    stage = "navigation";
    await page.goto(renderUrl, { waitUntil: "domcontentloaded", timeout: RENDER_TIMEOUT_MS });
    stage = "document";
    await page.waitForSelector('[data-appointment-slip-document="true"]', { timeout: RENDER_TIMEOUT_MS });
    stage = "resources";
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(document.images).map((image) => {
        if (image.complete) return Promise.resolve();
        return new Promise<void>((resolve) => {
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => resolve(), { once: true });
        });
      }));
    });
    stage = "pdf";
    return await page.pdf({ printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false });
  } catch (error) {
    console.error("Appointment-slip Chromium rendering failed", { stage, errorType: error instanceof Error ? error.name : "UnknownError" });
    throw new AppointmentSlipRenderError("Appointment-slip PDF rendering failed.", error);
  } finally {
    await page?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}
