import { chromium, type Browser, type Page } from "playwright-core";

export class AppointmentSlipRenderError extends Error {
  constructor(message: string, public readonly cause?: unknown) { super(message); this.name = "AppointmentSlipRenderError"; }
}

const RENDER_TIMEOUT_MS = 45_000;

type BrowserLauncher = (options: Parameters<typeof chromium.launch>[0]) => Promise<Browser>;

export async function renderAppointmentSlipPdf(renderUrl: string, launch: BrowserLauncher = chromium.launch.bind(chromium)): Promise<Buffer> {
  let browser: Browser | undefined;
  let page: Page | undefined;
  try {
    browser = await launch({
      executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || "/usr/bin/chromium",
      // The application image runs Node as root. Chromium therefore requires its sandbox disabled;
      // it is limited to this short-lived, token-scoped same-container render request.
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    page = await browser.newPage();
    page.setDefaultTimeout(RENDER_TIMEOUT_MS);
    await page.goto(renderUrl, { waitUntil: "networkidle", timeout: RENDER_TIMEOUT_MS });
    await page.waitForSelector('[data-appointment-slip-ready="true"]', { timeout: RENDER_TIMEOUT_MS });
    await page.evaluate(async () => { await document.fonts.ready; });
    return await page.pdf({ printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false });
  } catch (error) {
    throw new AppointmentSlipRenderError("Appointment-slip PDF rendering failed.", error);
  } finally {
    await page?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}
