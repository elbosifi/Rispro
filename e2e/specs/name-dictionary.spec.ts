import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import { E2E_PASSWORD, signInWithSession } from "../helpers/auth";
import { parseDictionaryCsv } from "../../frontend/src/lib/name-dictionary-csv";

test("dictionary recovery, fresh CSV round trips and responsive English/Arabic interfaces", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await signInWithSession(page, "e2e_supervisor");
  expect((await page.request.post("http://127.0.0.1:3100/api/auth/re-auth", { data: { password: E2E_PASSWORD } })).ok()).toBe(true);
  const marker = `قاموستجريبي${Date.now()}`;
  const mapping = { arabicText: marker, englishText: 'Dictionary, "Arabic"\nRound trip' };
  expect((await page.request.post("http://127.0.0.1:3100/api/name-dictionary/import", { data: { entries: [mapping] } })).ok()).toBe(true);
  let failCount = 1;
  let calls = 0;
  await page.route("**/api/settings/name-dictionary", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    calls += 1;
    if (failCount-- > 0) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { message: "Synthetic temporary outage" } }) });
    return route.continue();
  });
  await page.goto("/name-dictionary");
  await expect(page.getByText(marker, { exact: true })).toBeVisible();
  expect(calls).toBeGreaterThanOrEqual(2);

  for (const language of ["en", "ar"] as const) {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 960 });
      for (const [slug, path] of [["standalone", "/name-dictionary"], ["settings", "/settings?section=name_dictionary"]]) {
        await page.goto(path);
        if (language === "ar") {
          if (width < 1024) await page.setViewportSize({ width: 1440, height: 960 });
          await page.getByRole("button", { name: "Switch language to Arabic" }).click();
          await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
          if (width < 1024) await page.setViewportSize({ width, height: 960 });
        }
        await expect(page.getByText(marker, { exact: true })).toBeVisible();
        const search = page.getByPlaceholder(language === "ar" && slug === "standalone" ? "ابحث بالعربي أو الإنجليزي..." : /Search Arabic or English/i);
        await search.fill("no-match-synthetic-filter");
        await expect(page.getByText(marker, { exact: true })).toHaveCount(0);
        const downloadEvent = page.waitForEvent("download");
        await page.getByRole("button", { name: language === "ar" ? "تصدير CSV" : "Export CSV", exact: true }).click();
        const download = await downloadEvent;
        expect(download.suggestedFilename()).toMatch(/^RISpro_Name_Dictionary_\d{4}-\d{2}-\d{2}\.csv$/);
        const downloadPath = await download.path();
        const csv = await fs.readFile(downloadPath!, "utf8");
        expect(csv.charCodeAt(0)).toBe(0xFEFF);
        expect(parseDictionaryCsv(csv)).toContainEqual(mapping);
        if (width === 1440 && language === "en") {
          if (slug === "settings") page.once("dialog", (dialog) => dialog.accept());
          const imported = page.waitForResponse((response) => response.url().endsWith("/api/name-dictionary/import") && response.request().method() === "POST");
          await page.locator('input[type="file"]').setInputFiles({ name: download.suggestedFilename(), mimeType: "text/csv", buffer: Buffer.from(csv) });
          expect((await imported).status()).toBe(201);
        }
        await search.fill("");
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`${slug}-${language}-${width}.png`), fullPage: true });
      }
    }
  }

  // An exhausted retry sequence has a visible Retry action; recovery needs no restart.
  failCount = 3;
  await page.goto("/name-dictionary");
  await expect(page.getByText(/Could not load the name dictionary/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("No dictionary entries found.")).toHaveCount(0);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText(marker, { exact: true })).toBeVisible();
  await testInfo.attach("browser-console-errors", { body: JSON.stringify(consoleErrors), contentType: "application/json" });
  expect(consoleErrors.filter((message) => !message.includes("503"))).toEqual([]);
  expect(errors).toEqual([]);
});
