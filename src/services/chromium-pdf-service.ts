import { chromium, type Browser, type Page } from "playwright-core";

export type ChromiumPdfSource =
  | { kind: "url"; url: string; readySelector: string }
  | { kind: "html"; html: string };

export class ChromiumPdfRenderError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "ChromiumPdfRenderError";
  }
}

const RENDER_TIMEOUT_MS = 45_000;
type BrowserLauncher = (options: Parameters<typeof chromium.launch>[0]) => Promise<Browser>;

export async function renderChromiumPdf(
  options: { source: ChromiumPdfSource; pdfOptions?: Parameters<Page["pdf"]>[0]; documentKind: string },
  launch: BrowserLauncher = chromium.launch.bind(chromium),
): Promise<Buffer> {
  let browser: Browser | undefined;
  let page: Page | undefined;
  let stage = "launch";
  try {
    browser = await launch({
      executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || "/usr/bin/chromium",
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    stage = "page";
    page = await browser.newPage();
    page.setDefaultTimeout(RENDER_TIMEOUT_MS);
    stage = "document";
    if (options.source.kind === "url") {
      await page.goto(options.source.url, { waitUntil: "domcontentloaded", timeout: RENDER_TIMEOUT_MS });
      await page.waitForSelector(options.source.readySelector, { timeout: RENDER_TIMEOUT_MS });
    } else {
      await page.setContent(options.source.html, { waitUntil: "domcontentloaded", timeout: RENDER_TIMEOUT_MS });
    }
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
    return await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
      ...options.pdfOptions,
    });
  } catch (error) {
    console.error("Chromium PDF rendering failed", {
      documentKind: options.documentKind,
      stage,
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    throw new ChromiumPdfRenderError("PDF rendering failed.", error);
  } finally {
    await page?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}
