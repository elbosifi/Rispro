import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { signInWithSession } from "../helpers/auth.js";

// Real cross-origin HTTP/CORS transport, synthetic eSCL responses, no hardware.
const endpoint = "http://127.0.0.1:9849";
const capabilities = '<scan:ScannerCapabilities xmlns:scan="http://schemas.hp.com/imaging/escl/2011/05/03"><scan:DocumentFormatExt>application/pdf</scan:DocumentFormatExt></scan:ScannerCapabilities>';
let server: Server;
let jobs = 0;
let deletes = 0;
let delivered = false;

test.beforeAll(async () => {
  const pdf = readFileSync("e2e/e2e-request.pdf");
  server = createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "content-type");
    res.setHeader("Access-Control-Expose-Headers", "Location");
    if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }
    if (req.url?.endsWith("ScannerCapabilities")) { res.setHeader("Content-Type", "text/xml"); res.end(capabilities); return; }
    if (req.method === "POST") { jobs++; delivered = false; res.writeHead(201, { Location: "/eSCL/ScanJobs/test" }).end(); return; }
    if (req.method === "DELETE") { deletes++; res.writeHead(204).end(); return; }
    if (req.url?.endsWith("NextDocument") && !delivered) { delivered = true; res.writeHead(200, { "Content-Type": "application/pdf" }).end(pdf); return; }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(9849, "127.0.0.1", resolve));
});
test.afterAll(async () => { await new Promise<void>((resolve) => server?.close(() => resolve())); });

test("desktop and mobile NAPS2 setup separates connection, scan and attachment", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signInWithSession(page, "e2e_reception");
  await page.route("**/api/integrations/status", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.status.scanner.naps2WebScanEnabled = true;
    body.status.scanner.naps2WebScanEndpoint = "";
    await route.fulfill({ response, json: body });
  });
  await page.goto("/workstation/printing");
  const section = page.locator('section[aria-labelledby="workstation-naps2-title"]');
  await expect(section.getByText("Enabled", { exact: true })).toBeVisible();
  await expect(section.getByText("Not tested on this workstation")).toBeVisible();
  await expect(section.getByRole("link", { name: "Download NAPS2 setup" })).toHaveAttribute("href", "/api/scanner-bootstrap/windows-setup");
  await section.getByText("Advanced endpoint override").click();
  await section.getByLabel("NAPS2 eSCL endpoint").fill(endpoint);
  await section.getByRole("button", { name: "Save workstation endpoint" }).click();
  await section.getByRole("button", { name: "Test connection" }).click();
  await expect(section.getByText(/Connected/)).toBeVisible();
  expect(jobs).toBe(0);
  for (let scan = 1; scan <= 3; scan++) {
    await section.getByRole("button", { name: "Test scan", exact: true }).click();
    await expect(section.getByText(/Test scan succeeded:/)).toBeVisible();
    await expect(section.getByRole("button", { name: "Test scan", exact: true })).toBeEnabled();
    expect(jobs).toBe(scan);
    expect(deletes).toBe(scan);
  }
  await expect(section.getByText(/No patient document was uploaded or linked/)).toBeVisible();
  await section.getByRole("button", { name: "Reset to system default" }).click();
  await section.getByRole("button", { name: "Test connection" }).click();
  await expect(section.getByText(/Connected/)).toBeVisible({ timeout: 10_000 });
  await expect(section.getByText(endpoint, { exact: true })).toBeVisible();
  expect(jobs).toBe(3);
  await section.getByText("Advanced endpoint override").click();
  await expect(page.getByText("NAPS2 endpoint saved", { exact: true })).not.toBeVisible({ timeout: 15_000 });
  for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await expect(section).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await section.screenshot({ path: testInfo.outputPath(`naps2-${viewport.width}.png`) });
  }
  expect(errors).toEqual([]);
});
