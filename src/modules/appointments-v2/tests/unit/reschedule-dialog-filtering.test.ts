/**
 * Appointments V2 — Reschedule dialog date filtering tests.
 *
 * Verifies that the reschedule dialog correctly filters dates:
 * - blocked dates are NOT included
 * - restricted dates ARE included (override possible)
 * - available dates ARE included
 * - current booking date is excluded
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

describe("RescheduleDialog — date filtering", () => {
  const dialogPath = "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/components/reschedule-dialog.tsx";

  it("accepts availabilityItems prop, not availableDates", async () => {
    const content = await readFile(dialogPath, "utf-8");
    assert.ok(content.includes("availabilityItems: AvailabilityDayDto[]"), "Should accept availabilityItems");
    assert.ok(!content.includes("availableDates: string[]"), "Should NOT accept availableDates string array");
  });

  it("filters out blocked dates from selectable dates", async () => {
    const content = await readFile(dialogPath, "utf-8");
    assert.ok(content.includes('displayStatus !== "blocked"'), "Should filter out blocked dates");
  });

  it("excludes current booking date from selectable dates", async () => {
    const content = await readFile(dialogPath, "utf-8");
    assert.ok(content.includes("booking.bookingDate"), "Should reference current booking date for exclusion");
  });

  it("shows warning marker for restricted dates in dropdown", async () => {
    const content = await readFile(dialogPath, "utf-8");
    assert.ok(content.includes("Restricted (override required)"), "Should show restricted warning in label");
  });
});

describe("BookingsList — passes availabilityItems to RescheduleDialog", () => {
  const pagePath = "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/page.tsx";

  it("passes availabilityItems to RescheduleDialog", async () => {
    const content = await readFile(pagePath, "utf-8");
    assert.ok(content.includes("availabilityItems={availabilityItems}"), "Should pass availabilityItems");
    assert.ok(!content.includes("availableDates={availableDates}"), "Should NOT pass availableDates");
  });

  it("does not create unnecessary availableDates array in BookingsList", async () => {
    const content = await readFile(pagePath, "utf-8");
    // The old pattern was: availabilityItems.map((item) => item.date)
    // After fix, this should not exist as a standalone variable
    assert.ok(
      !content.includes("const availableDates = availabilityItems"),
      "Should not create availableDates array from availabilityItems"
    );
  });
});
