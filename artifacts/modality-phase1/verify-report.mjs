import { chromium } from "playwright";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(pathToFileURL(resolve("artifacts/modality-phase1/index.html")).href);
const broken = await page.locator("img").evaluateAll(images => images.filter(image => !image.complete || !image.naturalWidth).map(image => image.getAttribute("src")));
console.log(JSON.stringify({ title: await page.title(), brokenImages: broken }));
await page.screenshot({ path: resolve("artifacts/modality-phase1/report-top.png") });
await browser.close();
if (broken.length) process.exitCode = 1;
