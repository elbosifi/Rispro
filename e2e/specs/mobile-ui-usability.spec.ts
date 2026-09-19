import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { signInWithSession } from "../helpers/auth";

type AuditRole = "anonymous" | "e2e_reception" | "e2e_supervisor" | "e2e_super_admin" | "e2e_doctor";

type AuditRoute = {
  slug: string;
  path: string;
  role: AuditRole;
  notes?: string;
};

const routes: AuditRoute[] = [
  { slug: "login", path: "/login", role: "anonymous" },
  { slug: "public-appointment", path: "/public/appointment", role: "anonymous" },
  { slug: "public-cancel-appointment", path: "/public/cancel-appointment", role: "anonymous" },
  { slug: "dashboard", path: "/dashboard", role: "e2e_super_admin" },
  { slug: "patients", path: "/patients", role: "e2e_super_admin" },
  { slug: "patients-new", path: "/patients/new", role: "e2e_reception" },
  { slug: "patients-edit", path: "/patients/1/edit", role: "e2e_reception", notes: "Synthetic first patient from the E2E seed" },
  { slug: "patients-merge", path: "/patients/merge", role: "e2e_supervisor" },
  { slug: "name-dictionary", path: "/name-dictionary", role: "e2e_supervisor" },
  { slug: "appointments", path: "/appointments", role: "e2e_reception" },
  { slug: "scheduling-override-requests", path: "/scheduling/override-requests", role: "e2e_super_admin" },
  { slug: "recall-requests", path: "/recall-requests", role: "e2e_super_admin" },
  { slug: "appointments-admin", path: "/v2/appointments/admin", role: "e2e_super_admin" },
  { slug: "calendar", path: "/calendar", role: "e2e_super_admin" },
  { slug: "registrations", path: "/registrations", role: "e2e_super_admin" },
  { slug: "request-scans", path: "/request-scans", role: "e2e_super_admin" },
  { slug: "queue", path: "/queue", role: "e2e_reception" },
  { slug: "queue-check-in", path: "/queue/check-in", role: "e2e_super_admin" },
  { slug: "queue-no-shows", path: "/queue/no-shows", role: "e2e_super_admin" },
  { slug: "modality", path: "/modality?modalityId=1", role: "e2e_super_admin", notes: "Synthetic E2E_CT modality" },
  { slug: "modality-document-ingestion", path: "/modality/document-ingestion", role: "e2e_super_admin" },
  { slug: "comparisons", path: "/comparisons", role: "e2e_super_admin" },
  { slug: "comparison-detail", path: "/comparisons/1", role: "e2e_super_admin", notes: "Synthetic not-found/detail shell" },
  { slug: "comparison-ir-detail", path: "/comparisons/ir/1", role: "e2e_super_admin", notes: "Synthetic not-found/detail shell" },
  { slug: "comparison-remap", path: "/comparisons/1/remap", role: "e2e_super_admin", notes: "Synthetic not-found/detail shell" },
  { slug: "print", path: "/print", role: "e2e_super_admin" },
  { slug: "day-list-print", path: "/print/day-list", role: "e2e_super_admin" },
  { slug: "reporting-board-print", path: "/print/reporting-board", role: "e2e_super_admin" },
  { slug: "print-internal-appointment-slip", path: "/print/internal/appointment-slip", role: "e2e_super_admin", notes: "Print route without its required query payload" },
  { slug: "print-internal-registration-list", path: "/print/internal/registration-list", role: "e2e_super_admin", notes: "Print route without its required query payload" },
  { slug: "statistics", path: "/statistics", role: "e2e_super_admin" },
  { slug: "search", path: "/search", role: "e2e_super_admin" },
  { slug: "pacs", path: "/pacs", role: "e2e_super_admin" },
  { slug: "pacs-remap", path: "/pacs/remap", role: "e2e_super_admin" },
  { slug: "authoritative-orthanc", path: "/systems/authoritative-orthanc", role: "e2e_super_admin" },
  { slug: "worklist-monitor", path: "/worklist-monitor", role: "e2e_supervisor" },
  { slug: "settings", path: "/settings", role: "e2e_super_admin" },
  { slug: "incidents", path: "/incidents", role: "e2e_super_admin" },
  { slug: "sops", path: "/sops", role: "e2e_super_admin" },
  { slug: "sops-new", path: "/sops/new", role: "e2e_super_admin" },
  { slug: "workstation-printing", path: "/workstation/printing", role: "e2e_super_admin" },
  { slug: "legacy-access-viewer", path: "/legacy-access-viewer", role: "e2e_super_admin" },
  { slug: "doctor-dashboard", path: "/doctor/dashboard", role: "e2e_doctor" },
  { slug: "doctor-my-work", path: "/doctor/my-work", role: "e2e_doctor" },
  { slug: "doctor-today-cases", path: "/doctor/today-cases", role: "e2e_doctor" },
  { slug: "doctor-protocols", path: "/doctor/protocols", role: "e2e_doctor" },
  { slug: "doctor-additional-imaging", path: "/doctor/additional-imaging", role: "e2e_doctor" },
  { slug: "doctor-ir-consultations", path: "/doctor/ir-consultations", role: "e2e_doctor" },
  { slug: "doctor-roster", path: "/doctor/roster", role: "e2e_doctor" },
  { slug: "doctor-availability", path: "/doctor/availability", role: "e2e_doctor" },
  { slug: "doctor-reporting-board", path: "/doctor/reporting-board", role: "e2e_supervisor" },
  { slug: "doctor-reporting-board-saved", path: "/doctor/reporting-board/saved/e2e-mobile-reporting-token", role: "e2e_supervisor" },
  { slug: "doctor-worklists", path: "/doctor/doctor-worklists", role: "e2e_supervisor" },
  { slug: "doctor-roster-planner", path: "/doctor/roster-planner", role: "e2e_supervisor" },
  { slug: "doctor-doctors-directory", path: "/doctor/doctors-directory", role: "e2e_supervisor" },
  { slug: "doctor-advanced-setup", path: "/doctor/advanced-setup", role: "e2e_supervisor" },
  { slug: "doctor-team-workload", path: "/doctor/team-workload", role: "e2e_supervisor" },
  { slug: "doctor-ir-consultation-detail", path: "/doctor/ir-consultations/1", role: "e2e_doctor", notes: "Synthetic not-found/detail shell" },
  { slug: "reporting-worklist", path: "/reporting/worklist/e2e-mobile-reporting-token", role: "e2e_doctor" },
  { slug: "legacy-reporting-redirect", path: "/mobile/reporting-view/e2e-mobile-reporting-token", role: "e2e_doctor" },
  { slug: "queue-check-in-anonymous", path: "/queue/check-in", role: "anonymous", notes: "Protected route should redirect to login" },
];

const metricFilesInitialized = new Set<number>();

function artifactPath(viewport: number, slug: string): string {
  const directory = path.join(process.cwd(), "test-results", "mobile-usability", String(viewport));
  fs.mkdirSync(directory, { recursive: true });
  return path.join(directory, `${slug}-${viewport}.png`);
}

async function preparePage(page: Page, route: AuditRoute, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  if (route.role !== "anonymous") {
    try {
      await signInWithSession(page, route.role);
    } catch (error) {
      if (!String(error).includes("ECONNRESET")) throw error;
      await page.waitForTimeout(250);
      await signInWithSession(page, route.role);
    }
  }
  await page.goto(route.path, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
  await page.waitForTimeout(500);
}

async function captureRoute(
  page: Page,
  route: AuditRoute,
  viewport: { width: number; height: number },
  testInfo: { attach: (name: string, body: { body: Buffer; contentType: string }) => Promise<void> },
  options: { failOnPageErrors?: boolean } = {},
) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await preparePage(page, route, viewport);
  const metrics = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    bodyText: document.body.innerText.slice(0, 2_000),
    overflowingElements: Array.from(document.querySelectorAll("*"))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          className: typeof element.className === "string" ? element.className.slice(0, 160) : "",
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        };
      })
      .filter((element) => element.left < -2 || element.right > window.innerWidth + 2)
      .slice(0, 20),
    visibleButtons: Array.from(document.querySelectorAll("button"))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .slice(0, 30)
      .map((element) => ({ text: element.textContent?.trim().slice(0, 100), aria: element.getAttribute("aria-label") })),
  }));
  const screenshot = artifactPath(viewport.width, route.slug);
  if (metrics.documentWidth > metrics.clientWidth + 2) {
    console.log(`[mobile-usability] overflow ${route.path} ${viewport.width}px`, metrics.overflowingElements);
  }
  await page.screenshot({ path: screenshot, fullPage: true });
  await testInfo.attach(`${route.slug}-${viewport.width}-metrics.json`, {
    body: Buffer.from(JSON.stringify({ route, viewport, url: page.url(), metrics, pageErrors, consoleErrors }, null, 2)),
    contentType: "application/json",
  });
  const metricFile = path.join(process.cwd(), "test-results", "mobile-usability", `metrics-${viewport.width}.jsonl`);
  if (!metricFilesInitialized.has(viewport.width)) {
    fs.rmSync(metricFile, { force: true });
    metricFilesInitialized.add(viewport.width);
  }
  fs.appendFileSync(metricFile, `${JSON.stringify({ route, viewport, url: page.url(), metrics, pageErrors, consoleErrors })}\n`);

  expect(metrics.viewportWidth).toBe(viewport.width);
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.clientWidth + 2);
  expect(metrics.bodyText).not.toMatch(/application error|cannot read properties of undefined/i);
  if (options.failOnPageErrors) {
    expect(pageErrors, `${route.path} emitted page errors`).toEqual([]);
  }
  // Baseline audit evidence records runtime errors for classification; the focused
  // regression suite will fail on unexpected errors after the responsive fixes.
}

test.describe("mobile route audit", () => {
  for (const route of routes) {
    test(`captures ${route.slug} at 390px`, async ({ page }, testInfo) => {
      test.setTimeout(90_000);
      await captureRoute(page, route, { width: 390, height: 844 }, testInfo);
    });
  }
});

test.describe("desktop route audit", () => {
  for (const route of routes) {
    test(`captures ${route.slug} at 1440px`, async ({ page }, testInfo) => {
      test.setTimeout(90_000);
      await captureRoute(page, route, { width: 1440, height: 960 }, testInfo);
    });
  }
});

const criticalResponsiveRoutes = routes.filter((route) => [
  "dashboard",
  "patients",
  "patients-new",
  "appointments",
  "registrations",
  "queue",
  "modality",
  "comparisons",
  "doctor-reporting-board",
  "reporting-worklist",
].includes(route.slug));

const responsiveViewports = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 1440, height: 960 },
];

test.describe("critical responsive regression", () => {
  for (const route of criticalResponsiveRoutes) {
    for (const viewport of responsiveViewports) {
      test(`${route.slug} stays usable at ${viewport.width}px`, async ({ page }, testInfo) => {
        test.setTimeout(90_000);
        await captureRoute(page, route, viewport, testInfo, { failOnPageErrors: true });
      });
    }
  }
});

test("keeps mobile patient identity and registration actions usable", async ({ page }) => {
  test.setTimeout(90_000);

  await preparePage(page, { slug: "patients", path: "/patients", role: "e2e_super_admin" }, { width: 390, height: 844 });
  const patientNames = page.locator('[data-patient-id] p.font-semibold');
  await expect(patientNames.first()).toBeVisible();
  const patientNameOverflow = await patientNames.evaluateAll((elements) => elements.map((element) => ({
    textOverflow: getComputedStyle(element).textOverflow,
    whiteSpace: getComputedStyle(element).whiteSpace,
  })));
  expect(patientNameOverflow.length).toBeGreaterThan(0);
  expect(patientNameOverflow.every((item) => item.textOverflow !== "ellipsis" && item.whiteSpace !== "nowrap")).toBe(true);

  await preparePage(page, { slug: "registrations", path: "/registrations", role: "e2e_super_admin" }, { width: 390, height: 844 });
  const actionButtons = page.locator('[class~="grid-cols-3"][class*="sm:grid-cols-6"] button');
  await expect(actionButtons.first()).toBeVisible();
  const actionMetrics = await actionButtons.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height, ariaLabel: element.getAttribute("aria-label") };
  }));
  expect(actionMetrics.length).toBeGreaterThanOrEqual(6);
  expect(actionMetrics.every((item) => item.width >= 36 && item.height >= 36 && item.ariaLabel)).toBe(true);
});

test("captures the mobile navigation shell and representative operational states", async ({ page }, testInfo) => {
  await preparePage(page, { slug: "dashboard", path: "/dashboard", role: "e2e_super_admin" }, { width: 390, height: 844 });
  await page.getByRole("button", { name: /menu|navigation/i }).first().click().catch(() => undefined);
  await page.screenshot({ path: artifactPath(390, "navigation-open") , fullPage: true });

  await preparePage(page, { slug: "appointments", path: "/appointments", role: "e2e_super_admin" }, { width: 390, height: 844 });
  const appointmentDialogTrigger = page.getByRole("button", { name: /select patient|search patient/i }).first();
  if (await appointmentDialogTrigger.isVisible().catch(() => false)) {
    await appointmentDialogTrigger.click();
    const searchBox = page.getByRole("combobox", { name: "Search patients or registrations" });
    await expect(searchBox).toBeVisible();
    const searchBoxBounds = await searchBox.boundingBox();
    expect(searchBoxBounds).not.toBeNull();
    expect(searchBoxBounds!.x).toBeGreaterThanOrEqual(0);
    expect(searchBoxBounds!.y).toBeGreaterThanOrEqual(0);
    expect(searchBoxBounds!.x + searchBoxBounds!.width).toBeLessThanOrEqual(390);
    expect(searchBoxBounds!.y + searchBoxBounds!.height).toBeLessThanOrEqual(844);
    await page.screenshot({ path: artifactPath(390, "appointments-patient-dialog"), fullPage: true });
  }

  await preparePage(page, { slug: "reporting-worklist", path: "/reporting/worklist/e2e-mobile-reporting-token", role: "e2e_doctor" }, { width: 390, height: 844 });
  const caseButton = page.getByRole("button", { name: /Open case details for E2E Reporting Assigned/i }).first();
  if (await caseButton.isVisible().catch(() => false)) {
    await caseButton.click();
    await page.screenshot({ path: artifactPath(390, "reporting-case-details"), fullPage: true });
  }

  await testInfo.attach("representative-states.txt", {
    body: Buffer.from("Captured navigation-open, appointments-patient-dialog when available, and reporting-case-details when available."),
    contentType: "text/plain",
  });
});
