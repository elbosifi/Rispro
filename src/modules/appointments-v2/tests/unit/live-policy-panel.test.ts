/**
 * Appointments V2 — Live Policy Panel unit tests.
 *
 * Verifies:
 * - LivePolicyPanel component structure and read-only rendering
 * - All 5 snapshot sections are rendered
 * - "No live policy" fallback is shown when snapshot is missing
 * - Copy JSON button is present
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// ---------------------------------------------------------------------------
// Test: LivePolicyPanel component
// ---------------------------------------------------------------------------

describe("LivePolicyPanel — component structure", () => {
  const panelPath = "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/components/live-policy-panel.tsx";

  it("renders 'Live Policy' heading", async () => {
    const content = await readFile(panelPath, "utf-8");
    assert.ok(content.includes("Live Policy"), "Should display 'Live Policy' heading");
  });

  it("includes all 5 accordion sections", async () => {
    const content = await readFile(panelPath, "utf-8");
    const sections = [
      "Daily category limits",
      "Blocked dates",
      "Exam date rules",
      "Special quotas",
      "Special reason codes",
    ];
    for (const section of sections) {
      assert.ok(content.includes(`title="${section}"`) || content.includes(`>${section}<`), `Should have section: ${section}`);
    }
  });

  it("includes Copy JSON button", async () => {
    const content = await readFile(panelPath, "utf-8");
    assert.ok(content.includes("Copy JSON"), "Should have Copy JSON button");
  });

  it("uses navigator.clipboard with fallback", async () => {
    const content = await readFile(panelPath, "utf-8");
    assert.ok(content.includes("navigator.clipboard"), "Should use clipboard API");
    assert.ok(content.includes("execCommand"), "Should have fallback for older browsers");
  });

  it("shows empty messages for sections with no data", async () => {
    const content = await readFile(panelPath, "utf-8");
    const emptyMessages = [
      "No daily category limits configured",
      "No blocked dates configured",
      "No exam date rules configured",
      "No special quotas configured",
      "No special reason codes configured",
    ];
    for (const msg of emptyMessages) {
      assert.ok(content.includes(msg), `Should show: ${msg}`);
    }
  });

  it("renders special reason codes with code, labels, and status", async () => {
    const content = await readFile(panelPath, "utf-8");
    assert.ok(content.includes("row.code"), "Should display reason code");
    assert.ok(content.includes("row.labelEn"), "Should display English label");
    assert.ok(content.includes("row.labelAr"), "Should display Arabic label");
    assert.ok(content.includes("row.isActive"), "Should display active status");
  });

  it("formats dates using formatDate helper", async () => {
    const content = await readFile(panelPath, "utf-8");
    assert.ok(content.includes("function formatDate"), "Should have formatDate helper");
    assert.ok(content.includes("formatDate(row.specificDate)"), "Should format specific dates");
  });
});

// ---------------------------------------------------------------------------
// Test: SchedulingAdminV2Page integration
// ---------------------------------------------------------------------------

describe("SchedulingAdminV2Page — live policy integration", () => {
  const pagePath = "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/scheduling-admin-page.tsx";

  it("imports LivePolicyPanel", async () => {
    const content = await readFile(pagePath, "utf-8");
    assert.ok(content.includes('import { LivePolicyPanel }'), "Should import LivePolicyPanel");
  });

  it("renders LivePolicyPanel when publishedSnapshot exists", async () => {
    const content = await readFile(pagePath, "utf-8");
    assert.ok(content.includes("LivePolicyPanel snapshot={status.data.publishedSnapshot}"), "Should render panel with published snapshot");
  });

  it("shows 'No live policy published yet' when no published snapshot", async () => {
    const content = await readFile(pagePath, "utf-8");
    assert.ok(content.includes("No live policy published yet"), "Should show fallback message");
  });

  it("checks for status.data?.publishedSnapshot before rendering", async () => {
    const content = await readFile(pagePath, "utf-8");
    assert.ok(content.includes("status.data?.publishedSnapshot"), "Should conditionally render based on published snapshot");
  });
});
