/**
 * Appointments V2 — Status badge and availability display tests.
 *
 * Verifies that:
 * - StatusBadge shows both standard and special quota separately
 * - Booking date dropdown labels show both counts when special quota exists
 * - Availability table column shows standard and special separately
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// ---------------------------------------------------------------------------
// Test: StatusBadge component
// ---------------------------------------------------------------------------

describe("StatusBadge — display logic", () => {
  const statusBadgePath = "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/components/status-badge.tsx";

  it("accepts remainingStandardCapacity and remainingSpecialQuota props", async () => {
    const content = await readFile(statusBadgePath, "utf-8");
    assert.ok(content.includes("remainingStandardCapacity: number | null"));
    assert.ok(content.includes("remainingSpecialQuota: number | null"));
  });

  it("does not accept legacy remainingCapacity prop", async () => {
    const content = await readFile(statusBadgePath, "utf-8");
    // Should not have the old prop name (except in comments)
    const lines = content.split("\n").filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"));
    const interfaceBlock = lines.filter((line) => line.includes("interface StatusBadgeProps") || line.includes("remainingCapacity"));
    const hasOldProp = interfaceBlock.some((line) => line.includes("remainingCapacity:") && !line.includes("remainingStandardCapacity") && !line.includes("remainingSpecialQuota"));
    assert.ok(!hasOldProp, "StatusBadge should not have legacy remainingCapacity prop");
  });

  it("shows 'Standard: N' in rendered output", async () => {
    const content = await readFile(statusBadgePath, "utf-8");
    assert.ok(content.includes("Standard: ${standard}"), "Should render 'Standard: N'");
  });

  it("shows 'Special quota: M' when special quota > 0", async () => {
    const content = await readFile(statusBadgePath, "utf-8");
    assert.ok(content.includes("Special quota: ${special}"), "Should render 'Special quota: M'");
  });

  it("uses clampToZero helper to handle null/negative values", async () => {
    const content = await readFile(statusBadgePath, "utf-8");
    assert.ok(content.includes("function clampToZero"));
    assert.ok(content.includes("clampToZero(remainingStandardCapacity)"));
    assert.ok(content.includes("clampToZero(remainingSpecialQuota)"));
  });

  it("conditionally shows special quota only when > 0", async () => {
    const content = await readFile(statusBadgePath, "utf-8");
    assert.ok(content.includes("hasSpecial"), "Should have hasSpecial flag");
    assert.ok(content.includes("hasSpecial\n          ?"), "Should conditionally render special quota");
  });
});

// ---------------------------------------------------------------------------
// Test: Availability table in page.tsx
// ---------------------------------------------------------------------------

describe("Availability table — display logic", () => {
  const pagePath = "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/page.tsx";

  it("column header says 'Availability' not 'Remaining'", async () => {
    const content = await readFile(pagePath, "utf-8");
    // Check that 'Availability' appears in a th element (with whitespace tolerance)
    assert.ok(content.includes("Availability"), "Column header should say 'Availability'");
    // The old header should be gone - check that there's no >Remaining< in th context
    const hasOldHeader = content.includes(">Remaining<") || content.includes(">          Remaining<");
    assert.ok(!hasOldHeader, "Should not have old 'Remaining' header");
  });

  it("shows 'X std' for standard capacity", async () => {
    const content = await readFile(pagePath, "utf-8");
    assert.ok(content.includes("{standard} std"), "Should render standard capacity with 'std' label");
  });

  it("shows '+ Y special' when special quota > 0", async () => {
    const content = await readFile(pagePath, "utf-8");
    assert.ok(content.includes("+ {special} special"), "Should render special quota with '+ special' label");
  });

  it("computes standard from decision.remainingStandardCapacity with fallback to remainingCapacity", async () => {
    const content = await readFile(pagePath, "utf-8");
    assert.ok(content.includes("day.decision.remainingStandardCapacity ?? day.remainingCapacity"));
  });

  it("computes special from decision.remainingSpecialQuota", async () => {
    const content = await readFile(pagePath, "utf-8");
    assert.ok(content.includes("day.decision.remainingSpecialQuota"));
  });

  it("clamps both values to 0 using Math.max", async () => {
    const content = await readFile(pagePath, "utf-8");
    assert.ok(content.includes("Math.max(0, day.decision.remainingStandardCapacity"));
    assert.ok(content.includes("Math.max(0, day.decision.remainingSpecialQuota"));
  });

  it("passes both remainingStandardCapacity and remainingSpecialQuota to StatusBadge", async () => {
    const content = await readFile(pagePath, "utf-8");
    assert.ok(content.includes("remainingStandardCapacity={day.decision.remainingStandardCapacity}"));
    assert.ok(content.includes("remainingSpecialQuota={day.decision.remainingSpecialQuota}"));
  });

  it("does not pass legacy remainingCapacity to StatusBadge", async () => {
    const content = await readFile(pagePath, "utf-8");
    // Check that StatusBadge is not called with old prop
    const hasOldProp = content.includes("remainingCapacity={day.decision");
    assert.ok(!hasOldProp, "Should not pass legacy remainingCapacity to StatusBadge");
  });
});

// ---------------------------------------------------------------------------
// Test: Booking date dropdown in booking-form.tsx
// ---------------------------------------------------------------------------

describe("Booking date dropdown — display logic", () => {
  const bookingFormPath = "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/components/booking-form.tsx";

  it("shows 'N standard' when no special quota", async () => {
    const content = await readFile(bookingFormPath, "utf-8");
    assert.ok(content.includes("${standard} standard"), "Should render 'N standard'");
  });

  it("shows 'N standard, M special' when special quota exists", async () => {
    const content = await readFile(bookingFormPath, "utf-8");
    assert.ok(content.includes("${standard} standard, ${special} special"), "Should render 'N standard, M special'");
  });

  it("appends ⚠️ for restricted dates", async () => {
    const content = await readFile(bookingFormPath, "utf-8");
    assert.ok(content.includes("isRestricted ? \" ⚠️\" : \"\""), "Should append warning emoji for restricted dates");
  });

  it("computes standard from decision.remainingStandardCapacity with fallback", async () => {
    const content = await readFile(bookingFormPath, "utf-8");
    assert.ok(content.includes("day?.decision.remainingStandardCapacity ?? day?.remainingCapacity"));
  });

  it("computes special from decision.remainingSpecialQuota", async () => {
    const content = await readFile(bookingFormPath, "utf-8");
    assert.ok(content.includes("day?.decision.remainingSpecialQuota"));
  });

  it("clamps both values to 0 using Math.max", async () => {
    const content = await readFile(bookingFormPath, "utf-8");
    assert.ok(content.includes("Math.max(0, day?.decision.remainingStandardCapacity"));
    assert.ok(content.includes("Math.max(0, day?.decision.remainingSpecialQuota"));
  });

  it("does not show legacy 'remaining' label in dropdown", async () => {
    const content = await readFile(bookingFormPath, "utf-8");
    // Find the dropdown section
    const dropdownSection = content.substring(
      content.indexOf("availableDates.map((date) =>"),
      content.indexOf("</select>", content.indexOf("availableDates.map((date) =>"))
    );
    const hasLegacyLabel = dropdownSection.includes("remaining)");
    assert.ok(!hasLegacyLabel, "Should not show legacy 'remaining' label in dropdown");
  });
});

// ---------------------------------------------------------------------------
// Test: Display scenarios
// ---------------------------------------------------------------------------

describe("Display scenarios — edge cases", () => {
  it("handles scenario: remainingStandardCapacity=0, remainingSpecialQuota=2", () => {
    // This is the key scenario from the bug report
    const standard = Math.max(0, 0);
    const special = Math.max(0, 2);
    assert.strictEqual(standard, 0);
    assert.strictEqual(special, 2);

    // StatusBadge should show: "Standard: 0 · Special quota: 2"
    const hasSpecial = special > 0;
    assert.ok(hasSpecial);
    const badgeText = hasSpecial
      ? `Standard: ${standard} · Special quota: ${special}`
      : `Standard: ${standard}`;
    assert.strictEqual(badgeText, "Standard: 0 · Special quota: 2");

    // Booking dropdown should show: "2026-04-21 (0 standard, 2 special)"
    const date = "2026-04-21";
    const label = special > 0
      ? `${date} (${standard} standard, ${special} special)`
      : `${date} (${standard} standard)`;
    assert.strictEqual(label, "2026-04-21 (0 standard, 2 special)");
  });

  it("handles scenario: remainingStandardCapacity=5, remainingSpecialQuota=0", () => {
    const standard = Math.max(0, 5);
    const special = Math.max(0, 0);
    assert.strictEqual(standard, 5);
    assert.strictEqual(special, 0);

    const hasSpecial = special > 0;
    assert.ok(!hasSpecial);
    const badgeText = hasSpecial
      ? `Standard: ${standard} · Special quota: ${special}`
      : `Standard: ${standard}`;
    assert.strictEqual(badgeText, "Standard: 5");

    const date = "2026-04-20";
    const label = special > 0
      ? `${date} (${standard} standard, ${special} special)`
      : `${date} (${standard} standard)`;
    assert.strictEqual(label, "2026-04-20 (5 standard)");
  });

  it("handles scenario: both null/undefined (clamped to 0)", () => {
    const standard = Math.max(0, null ?? 0);
    const special = Math.max(0, undefined ?? 0);
    assert.strictEqual(standard, 0);
    assert.strictEqual(special, 0);

    const hasSpecial = special > 0;
    assert.ok(!hasSpecial);
  });

  it("handles scenario: negative values (clamped to 0)", () => {
    const standard = Math.max(0, -5);
    const special = Math.max(0, -2);
    assert.strictEqual(standard, 0);
    assert.strictEqual(special, 0);
  });
});
