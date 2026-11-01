import { expect, test } from "@playwright/test";
import pg from "pg";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { assertSafeE2eEnvironment } from "../../scripts/e2e-db-safety.mjs";
import { signInWithSession } from "../helpers/auth";
import { e2eTodayInTripoli } from "../helpers/fixtures";

process.loadEnvFile("e2e/.env");
const target = assertSafeE2eEnvironment();
const baseline = process.env.MODALITY_LAYOUT_BASELINE === "1";
const artifactRoot = resolve(process.env.RISPRO_MODALITY_REVIEW_DIR || "artifacts/modality-phase1");
const output = resolve(artifactRoot, baseline ? "before" : "after");

test("synthetic CT identity and workspace remain visible at workstation and mobile sizes", async ({ page }) => {
  test.setTimeout(90000);
  const db = new pg.Pool({ connectionString: target.url });
  let ctId: number;
  try {
    ctId = Number((await db.query("select id from modalities where code='CT'")).rows[0].id);
    await db.query("update appointments_v2.bookings set modality_id=$1 where patient_id=(select id from patients where english_full_name='E2E Acquisition Patient')", [ctId]);
    await db.query("delete from documents where v2_booking_id=(select b.id from appointments_v2.bookings b join patients p on p.id=b.patient_id where p.english_full_name='E2E Acquisition Patient') and original_filename like 'synthetic-%'");
  } finally { await db.end(); }
  mkdirSync(output, { recursive: true });
  await signInWithSession(page, "e2e_supervisor");
  const measurements: Array<Record<string, unknown>> = [];
  for (const [width, height] of [[1440, 900], [1366, 768], [768, 1024], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.goto(`/modality?modalityId=${ctId}&date=${e2eTodayInTripoli()}&view=completed`);
    const row = page.getByTestId(width < 1024 ? /modality-mobile-card-/ : /modality-board-row-/).filter({ hasText: "E2E Acquisition Patient" }).first();
    await expect(row).toBeVisible();
    await row.click();
    const drawer = page.getByTestId("selected-appointment-drawer");
    await expect(drawer.getByTestId("clinical-protocol-content")).toBeVisible();
    if (width >= 1024) await expect(drawer.getByTestId("clinical-request-documents").locator("canvas").first()).toBeVisible();
    await page.screenshot({ path: resolve(output, `ct-completed-${width}x${height}.png`) });
    if (!baseline) {
      const name = drawer.getByRole("heading", { name: "E2E Acquisition Patient" });
      const header = drawer.getByTestId("clinical-patient-banner");
      const footer = drawer.getByTestId("clinical-operational-footer");
      const metrics = await name.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const x = Math.max(0, Math.min(innerWidth - 1, box.left + box.width / 2));
        const y = Math.max(0, Math.min(innerHeight - 1, box.top + box.height / 2));
        const hit = document.elementFromPoint(x, y);
        return { top: box.top, bottom: box.bottom, hit: Boolean(hit && (element.contains(hit) || hit.contains(element))) };
      });
      const topbar = await page.locator("header").first().boundingBox();
      const banner = await header.boundingBox();
      const footerBox = await footer.boundingBox();
      measurements.push({ width, height, banner: await header.boundingBox(), footer: footerBox, workspace: await drawer.getByTestId("clinical-workspace").boundingBox(), protocol: await drawer.getByTestId("clinical-protocol").boundingBox(), documents: await drawer.getByTestId("clinical-request-documents").boundingBox() });
      expect(metrics.hit).toBe(true);
      expect(metrics.top).toBeGreaterThanOrEqual(topbar!.y + topbar!.height - 1);
      expect(banner!.y + banner!.height).toBeLessThanOrEqual(footerBox!.y);
      expect(footerBox!.y + footerBox!.height).toBeLessThanOrEqual(height + 1);
      const footerButtons = await footer.locator("button:visible").evaluateAll(buttons => buttons.map(button => {
        const box = button.getBoundingClientRect();
        return { left: box.left, right: box.right };
      }));
      for (const box of footerButtons) {
        expect(box.left).toBeGreaterThanOrEqual(footerBox!.x - 1);
        expect(box.right).toBeLessThanOrEqual(footerBox!.x + footerBox!.width + 1);
      }
      if (width < 1024) {
        const moreIcon = await footer.getByRole("button", { name: "Appointment actions" }).locator("svg").boundingBox();
        expect(moreIcon!.width).toBeGreaterThanOrEqual(16);
        const switcher = drawer.getByRole("group", { name: "Clinical workspace" });
        await switcher.getByRole("button", { name: "Documents" }).click();
        await expect(drawer.getByTestId("clinical-request-documents")).toBeVisible();
        await expect(drawer.getByTestId("clinical-request-documents").locator("canvas").first()).toBeVisible();
        await switcher.getByRole("button", { name: "Protocol" }).click();
        await expect(drawer.getByTestId("clinical-protocol-content")).toBeVisible();
      } else {
        const details = drawer.getByRole("button", { name: "Patient and acquisition details" });
        await details.click();
        const openWorkspace = await drawer.getByTestId("clinical-workspace").boundingBox();
        expect(openWorkspace!.height).toBeGreaterThan(100);
        await details.click();
        await drawer.getByRole("button", { name: "Expand protocol" }).click();
        await expect(drawer.getByTestId("clinical-request-documents")).toBeHidden();
        await drawer.getByRole("button", { name: "Restore split view" }).click();
        await drawer.getByRole("button", { name: "Expand review" }).click();
        await expect(drawer.getByTestId("clinical-protocol")).toBeHidden();
        await drawer.getByRole("button", { name: "Exit expanded review" }).click();
        await expect(drawer.getByTestId("clinical-protocol-content")).toBeVisible();
      }
    }
  }
  if (!baseline) writeFileSync(resolve(output, "ct-completed-geometry.json"), JSON.stringify(measurements, null, 2));
});

test("synthetic multi-page documents retain selection across panel changes", async ({ page, browser }) => {
  test.setTimeout(90000);
  const fixtureDirectory = resolve(artifactRoot, "fixtures");
  mkdirSync(fixtureDirectory, { recursive: true });
  const pdfPage = await browser.newPage();
  for (const [name, count] of [["synthetic-imaging-request.pdf", 10], ["synthetic-second-ten-page.pdf", 10], ["synthetic-clinical-history-with-a-deliberately-long-filename-to-assess-identification.pdf", 4]] as const) {
    await pdfPage.setContent(`<style>body{font:14px Arial;color:#172339}article{height:940px;page-break-after:always}h1{font-size:23px}</style>${Array.from({ length: count }, (_, index) => `<article><h1>SYNTHETIC RADIOLOGY REFERRAL</h1><p>Patient: E2E Acquisition Patient · Page ${index + 1} of ${count}</p><hr><h2>Clinical history and examination request</h2><p>Synthetic history: assess the abdomen and liver. Confirm preparation and contrast eligibility with the treating team.</p><p>This document contains no real patient information.</p></article>`).join("")}`);
    await pdfPage.pdf({ path: resolve(fixtureDirectory, name), format: "A4" });
  }
  await pdfPage.close();
  const db = new pg.Pool({ connectionString: target.url });
  let ctId: number;
  try {
    ctId = Number((await db.query("select id from modalities where code='CT'")).rows[0].id);
    const booking = (await db.query("select b.id,b.patient_id from appointments_v2.bookings b join patients p on p.id=b.patient_id where p.english_full_name='E2E Acquisition Patient'")).rows[0];
    await db.query("update appointments_v2.bookings set modality_id=$1 where id=$2", [ctId, booking.id]);
    const names = ["synthetic-imaging-request.pdf", "synthetic-second-ten-page.pdf", "synthetic-clinical-history-with-a-deliberately-long-filename-to-assess-identification.pdf"];
    await db.query("delete from documents where v2_booking_id=$1 and original_filename=any($2::text[])", [booking.id, names]);
    for (const name of names) await db.query("insert into documents(patient_id,v2_booking_id,document_type,original_filename,stored_path,mime_type,file_size,source) values($1,$2,'appointment_request',$3,$4,'application/pdf',$5,'manual_upload')", [booking.patient_id, booking.id, name, relative(process.cwd(), resolve(fixtureDirectory, name)).replaceAll("\\", "/"), statSync(resolve(fixtureDirectory, name)).size]);
  } finally { await db.end(); }
  mkdirSync(output, { recursive: true });
  await signInWithSession(page, "e2e_supervisor");
  for (const [width, height] of [[1440, 900], [1366, 768], [768, 1024], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.goto(`/modality?modalityId=${ctId}&date=${e2eTodayInTripoli()}&view=completed`);
    await page.getByTestId(width < 1024 ? /modality-mobile-card-/ : /modality-board-row-/).filter({ hasText: "E2E Acquisition Patient" }).first().click();
    const drawer = page.getByTestId("selected-appointment-drawer");
    if (width < 1024) await drawer.getByRole("group", { name: "Clinical workspace" }).getByRole("button", { name: "Documents" }).click();
    const documents = drawer.getByTestId("clinical-request-documents");
    const selected = documents.getByRole("button", { name: /^synthetic-imaging-request\.pdf$/ });
    await selected.click();
    await expect(selected).toHaveAttribute("aria-pressed", "true");
    const documentRow = selected.locator("xpath=../..");
    expect((await documentRow.boundingBox())!.height).toBeLessThan(110);
    const actions = documents.getByRole("button", { name: "More actions: synthetic-imaging-request.pdf" });
    await actions.click();
    await expect(documentRow.getByRole("button", { name: "Print A4" })).toBeVisible();
    await expect(documentRow.getByRole("link", { name: "Open in new tab" })).toBeVisible();
    await actions.click();
    await expect(documents.locator("canvas").first()).toBeVisible();
    await expect(documents.locator(".react-pdf__Page")).toHaveCount(10);
    await expect(documents.locator("canvas").first()).toBeVisible();
    const toolbar = documents.getByRole("toolbar", { name: "Document utilities" });
    const fitPageBox = await toolbar.getByRole("button", { name: "Fit page" }).boundingBox();
    const toolbarBox = await toolbar.boundingBox();
    expect(fitPageBox!.x).toBeGreaterThanOrEqual(toolbarBox!.x - 1);
    const openTabBox = await toolbar.getByRole("link", { name: "Open in new tab" }).boundingBox();
    expect(openTabBox!.x + openTabBox!.width).toBeLessThanOrEqual(toolbarBox!.x + toolbarBox!.width + 1);
    await expect.poll(() => documents.locator(".react-pdf__Page").first().evaluate(element => {
      const scroller = element.parentElement?.parentElement?.parentElement;
      return element.getBoundingClientRect().width - (scroller?.clientWidth ?? 0);
    })).toBeLessThanOrEqual(2);
    await documents.getByRole("button", { name: /^synthetic-second-ten-page\.pdf$/ }).click();
    await expect(documents.locator(".react-pdf__Page")).toHaveCount(10);
    await expect.poll(() => documents.locator(".react-pdf__Page").first().evaluate(element => {
      const scroller = element.parentElement?.parentElement?.parentElement;
      return element.getBoundingClientRect().width - (scroller?.clientWidth ?? 0);
    })).toBeLessThanOrEqual(2);
    await selected.click();
    await expect(selected).toHaveAttribute("aria-pressed", "true");
    if (width >= 1024) {
      const scroller = documents.locator(".react-pdf__Page").first().locator("xpath=../../..");
      await scroller.evaluate(element => { element.scrollTop = 1100; });
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      await drawer.getByRole("button", { name: "Expand review" }).click();
      await drawer.getByRole("button", { name: "Exit expanded review" }).click();
    } else {
      const switcher = drawer.getByRole("group", { name: "Clinical workspace" });
      await switcher.getByRole("button", { name: "Protocol" }).click();
      await switcher.getByRole("button", { name: "Documents" }).click();
    }
    await expect(selected).toHaveAttribute("aria-pressed", "true");
    await page.screenshot({ path: resolve(output, `ct-multiple-pdfs-${width}x${height}.png`) });
  }
});

test("empty appointment and Arabic identity remain accessible", async ({ page }) => {
  test.setTimeout(90000);
  const db = new pg.Pool({ connectionString: target.url });
  let ctId: number;
  try {
    ctId = Number((await db.query("select id from modalities where code='CT'")).rows[0].id);
    await db.query("update patients set english_full_name='E2E Queue Patient', arabic_full_name='اختبار قائمة الانتظار' where english_full_name='Synthetic patient with a very long bilingual name for safety review'");
    await db.query("update appointments_v2.bookings set modality_id=$1,exam_type_id=(select id from exam_types where code='ct_brain') where patient_id=(select id from patients where english_full_name='E2E Queue Patient')", [ctId]);
  } finally { await db.end(); }
  mkdirSync(output, { recursive: true });
  await signInWithSession(page, "e2e_supervisor");
  for (const [width, height] of [[1440, 900], [1366, 768], [768, 1024], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.goto(`/modality?modalityId=${ctId}&date=${e2eTodayInTripoli()}&view=all`);
    await page.getByTestId(width < 1024 ? /modality-mobile-card-/ : /modality-board-row-/).filter({ hasText: "E2E Queue Patient" }).first().click();
    const drawer = page.getByTestId("selected-appointment-drawer");
    await expect(drawer.getByTestId("modality-protocol-section")).toContainText("No protocol assigned");
    await expect(drawer.getByRole("button", { name: "Expand protocol" })).toHaveCount(0);
    if (width >= 1024) {
      const documentsBox = await drawer.getByTestId("clinical-request-documents").boundingBox();
      const protocolBox = await drawer.getByTestId("clinical-protocol").boundingBox();
      expect(documentsBox!.width / (documentsBox!.width + protocolBox!.width)).toBeGreaterThan(0.74);
    }
    if (width < 1024) await drawer.getByRole("group", { name: "Clinical workspace" }).getByRole("button", { name: "Documents" }).click();
    await expect(drawer.getByTestId("clinical-request-documents")).toContainText("No request documents yet");
    await page.screenshot({ path: resolve(output, `ct-empty-${width}x${height}.png`) });
  }
  await page.addInitScript(() => localStorage.setItem("rispro-language", "ar"));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/modality?modalityId=${ctId}&date=${e2eTodayInTripoli()}&view=all`);
  await page.getByTestId(/modality-mobile-card-/).filter({ hasText: "E2E Queue Patient" }).first().click();
  const banner = page.getByTestId("clinical-patient-banner");
  const title = banner.getByRole("heading");
  const visibility = await title.evaluate(element => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return { top: box.top, hit: Boolean(hit && (element.contains(hit) || hit.contains(element))) };
  });
  expect(visibility.top).toBeGreaterThanOrEqual(56);
  expect(visibility.hit).toBe(true);
  const footer = page.getByTestId("clinical-operational-footer");
  const footerBox = await footer.boundingBox();
  for (const box of await footer.locator("button:visible").evaluateAll(buttons => buttons.map(button => {
    const rect = button.getBoundingClientRect(); return { left: rect.left, right: rect.right };
  }))) {
    expect(box.left).toBeGreaterThanOrEqual(footerBox!.x - 1);
    expect(box.right).toBeLessThanOrEqual(footerBox!.x + footerBox!.width + 1);
  }
  await page.screenshot({ path: resolve(output, "ct-empty-ar-390x844.png") });
});

test("synthetic structured, free-text and customized prescriptions remain readable", async ({ page }) => {
  test.setTimeout(180000);
  const db = new pg.Pool({ connectionString: target.url });
  let ctId: number;
  try { ctId = Number((await db.query("select id from modalities where code='CT'")).rows[0].id); } finally { await db.end(); }
  mkdirSync(output, { recursive: true });
  let mode: "structured" | "free-text" | "customized" = "structured";
  await page.route("**/api/v2/read/modality/appointments/*/protocol-assignment", async route => {
    const response = await route.fetch();
    const body = await response.json();
    if (body.assignment) {
      Object.assign(body.assignment, {
        protocol_id: mode === "free-text" ? null : body.assignment.protocol_id,
        protocol_version_id: mode === "free-text" ? null : body.assignment.protocol_version_id,
        protocol_name: mode === "free-text" ? null : "Synthetic CT liver", version_number: mode === "free-text" ? null : "1.0", modality: "CT",
        free_text_protocol: mode !== "structured" ? Array.from({ length: 22 }, (_, i) => `Instruction ${i + 1}: synthetic preparation and acquisition detail`).join("\n") : null,
        protocol_notes: "Synthetic patient-specific preparation", contrast_notes: "Synthetic contrast instructions",
        ct_phases: ["Arterial", "Portal venous", "Delayed"].map((name, i) => ({ order_index: i + 1, phase_preset_name: name, timing_type: "FIXED_DELAY_INJECTION_START", delay_seconds: [35, 70, 180][i], coverage: "Liver and abdomen", reconstruction_notes: "Soft tissue", instructions: "Breath hold", is_required: true })),
      });
    }
    await route.fulfill({ response, json: body });
  });
  await signInWithSession(page, "e2e_supervisor");
  for (mode of ["structured", "free-text", "customized"] as const) {
    for (const [width, height] of [[1440, 900], [1366, 768], [768, 1024], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.goto(`/modality?modalityId=${ctId}&date=${e2eTodayInTripoli()}&view=completed`);
      await page.getByTestId(width < 1024 ? /modality-mobile-card-/ : /modality-board-row-/).filter({ hasText: "E2E Acquisition Patient" }).first().click();
      const drawer = page.getByTestId("selected-appointment-drawer");
      if (width < 1024) await drawer.getByRole("group", { name: "Clinical workspace" }).getByRole("button", { name: "Documents" }).click();
      const documents = drawer.getByTestId("clinical-request-documents");
      await documents.getByRole("button", { name: /^synthetic-imaging-request\.pdf$/ }).click();
      await expect(documents.locator(".react-pdf__Page")).toHaveCount(10);
      if (width < 1024) await drawer.getByRole("group", { name: "Clinical workspace" }).getByRole("button", { name: "Protocol" }).click();
      const protocol = page.getByTestId("modality-protocol-section");
      await expect(protocol).toContainText("Synthetic patient-specific preparation");
      await expect(protocol).toContainText("Synthetic contrast instructions");
      if (width >= 1024) await expect(page.getByTestId("clinical-request-documents").locator("canvas").first()).toBeVisible();
      if (mode === "structured") {
        const table = protocol.getByTestId("clinical-acquisition-table");
        await expect(table).toContainText("Portal venous");
        await expect(table).toContainText("70 sec after start of IV contrast");
        expect(await table.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
        await table.scrollIntoViewIfNeeded();
      } else {
        if (mode === "customized") await expect(protocol).toContainText("Customized protocol — active instructions");
        else await expect(protocol).toContainText("Free-text protocol");
        await expect(protocol).toContainText("Instruction 22");
        await expect(protocol.getByTestId("clinical-acquisition-table")).toHaveCount(0);
        const scrollRegion = width >= 1024 ? drawer.getByTestId("clinical-protocol") : drawer.getByTestId("clinical-dialog-scroll-region");
        const line = protocol.getByTestId("clinical-protocol-content").locator("p.whitespace-pre-wrap");
        await line.evaluate((element, desktop) => {
          const node = element.firstChild!;
          const text = node.textContent ?? "";
          const range = document.createRange();
          range.setStart(node, text.indexOf("Instruction 22"));
          range.setEnd(node, text.length);
          const region = element.closest(desktop ? '[data-testid="clinical-protocol"]' : '[data-testid="clinical-dialog-scroll-region"]')!;
          region.scrollTop += range.getBoundingClientRect().bottom - region.getBoundingClientRect().bottom + 16;
        }, width >= 1024);
        const visible = await line.evaluate((element, desktop) => {
          const node = element.firstChild!;
          const text = node.textContent ?? "";
          const range = document.createRange();
          range.setStart(node, text.indexOf("Instruction 22"));
          range.setEnd(node, text.length);
          const box = range.getBoundingClientRect();
          const region = element.closest(desktop ? '[data-testid="clinical-protocol"]' : '[data-testid="clinical-dialog-scroll-region"]')!.getBoundingClientRect();
          return box.top >= region.top && box.bottom <= region.bottom;
        }, width >= 1024);
        expect(await scrollRegion.isVisible()).toBe(true);
        expect(visible).toBe(true);
      }
      await page.screenshot({ path: resolve(output, `mock-${mode}-${width}x${height}.png`) });
    }
  }
});

test("synthetic MRI screening warning and sequence stay visible", async ({ page }) => {
  test.setTimeout(90000);
  const db = new pg.Pool({ connectionString: target.url });
  let mriId: number;
  try {
    mriId = Number((await db.query("select id from modalities where code='MRI'")).rows[0].id);
    const exam = (await db.query("select id from exam_types where code='mri_brain'")).rows[0];
    const booking = (await db.query("select b.id from appointments_v2.bookings b join patients p on p.id=b.patient_id where p.english_full_name = any($1::text[])", [["E2E Queue Patient", "Synthetic patient with a very long bilingual name for safety review"]])).rows[0];
    await db.query("update patients set english_full_name=$1, arabic_full_name=$2 where id=(select patient_id from appointments_v2.bookings where id=$3)", ["Synthetic patient with a very long bilingual name for safety review", "مريض تجريبي باسم عربي طويل للتحقق من سلامة عرض هوية المريض", booking.id]);
    await db.query("update modalities set safety_workflow_type='mri_primary_implant_screening' where id=$1", [mriId]);
    await db.query("update appointments_v2.bookings set modality_id=$1,exam_type_id=$2 where id=$3", [mriId, exam.id, booking.id]);
    await db.query("insert into appointments_v2.mri_primary_screenings(booking_id,result,implant_site,screened_by_user_id) select $1,'implant_reported_review_required','Synthetic implant',id from users where username='e2e_supervisor' on conflict(booking_id) do update set result=excluded.result,implant_site=excluded.implant_site", [booking.id]);
  } finally { await db.end(); }
  await page.route("**/api/v2/read/modality/appointments/*/protocol-assignment", route => route.fulfill({ json: { assignment: {
    assignment_id: 1, appointment_id: 1, protocol_id: 1, protocol_version_id: 1, protocol_name: "Synthetic MRI brain", version_number: "1.0", modality: "MRI", status: "ASSIGNED", ct_phases: [], mri_sequences: [
      { order_index: 1, sequence_preset_name: "T2 FLAIR", default_plane: "axial", default_coverage: "Brain", is_required: true },
      { order_index: 2, sequence_preset_name: "DWI", default_plane: "axial", default_coverage: "Brain", default_b_values: "0, 1000", is_required: true },
    ],
  } } }));
  mkdirSync(output, { recursive: true });
  await signInWithSession(page, "e2e_supervisor");
  for (const [width, height] of [[1440, 900], [1366, 768], [768, 1024], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.goto(`/modality?modalityId=${mriId}&date=${e2eTodayInTripoli()}&view=all`);
    await page.getByTestId(width < 1024 ? /modality-mobile-card-/ : /modality-board-row-/).filter({ hasText: "Synthetic patient with a very long" }).first().click();
    const drawer = page.getByTestId("selected-appointment-drawer");
    const warning = drawer.getByLabel(/MR safety review required/);
    await expect(warning).toBeVisible();
    for (const element of [drawer.getByTestId("clinical-patient-banner").getByRole("heading"), warning]) {
      const visible = await element.evaluate(node => {
        const rect = node.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return { top: rect.top, bottom: rect.bottom, hit: Boolean(hit && (node.contains(hit) || hit.contains(node))) };
      });
      expect(visible.top).toBeGreaterThanOrEqual(56);
      expect(visible.bottom).toBeLessThan(height);
      expect(visible.hit).toBe(true);
    }
    const table = drawer.getByTestId("clinical-acquisition-table");
    await expect(table).toContainText("T2 FLAIR");
    expect(await table.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await table.scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(output, `mock-mri-safety-${width}x${height}.png`) });
  }
});
