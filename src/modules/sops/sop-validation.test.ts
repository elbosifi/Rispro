import assert from "node:assert/strict";
import test from "node:test";
import { SOP_SECTION_DEFINITIONS } from "./constants.js";
import { addCalendarYears, normalizeSopCode, normalizeSopDate, validateSopReviewDate, validateSopDocument } from "./sop-validation.js";

function documentWith(requiredText = "MRI safety"): any {
  return {
    type: "sop",
    version: 1,
    sections: SOP_SECTION_DEFINITIONS.map((section) => ({
      ...section,
      content: section.required
        ? { type: "doc", content: [{ type: "paragraph", attrs: { dir: section.key === "purpose" ? "rtl" : "ltr" }, content: [{ type: "text", text: section.key === "purpose" ? `إجراء ${requiredText}` : requiredText }] }] }
        : { type: "doc", content: [{ type: "paragraph", attrs: { dir: "auto" } }] },
    })),
  };
}

test("SOP validation canonicalizes codes and preserves Unicode direction/content", () => {
  assert.equal(normalizeSopCode(" rad-mri-001 "), "RAD-MRI-001");
  const document = validateSopDocument(documentWith(), true);
  assert.equal(document.sections.length, 8);
  assert.match(JSON.stringify(document), /إجراء MRI safety/);
});

test("SOP validation rejects missing, reordered, and empty required sections", () => {
  assert.throws(() => validateSopDocument({ type: "sop", version: 1, sections: [] }));
  const reordered = documentWith();
  [reordered.sections[0], reordered.sections[1]] = [reordered.sections[1], reordered.sections[0]];
  assert.throws(() => validateSopDocument(reordered));
  const empty: any = documentWith();
  empty.sections[5]!.content = { type: "doc", content: [{ type: "paragraph" }] };
  assert.throws(() => validateSopDocument(empty, true), /Procedure/);
});

test("addCalendarYears calculates dates deterministically including leap years", () => {
  // Normal date
  assert.equal(addCalendarYears("2026-10-01", 2), "2028-10-01");
  assert.equal(addCalendarYears("2028-09-15", 2), "2030-09-15");
  // Leap-year boundary: Feb 29 + 2 years in non-leap year clamps to Feb 28
  assert.equal(addCalendarYears("2024-02-29", 2), "2026-02-28");
  assert.equal(addCalendarYears("2024-02-29", 4), "2028-02-29");
  assert.equal(addCalendarYears("2024-02-28", 2), "2026-02-28");
});

test("normalizeSopDate validates date format and rejects invalid dates", () => {
  assert.equal(normalizeSopDate("2026-10-01"), "2026-10-01");
  assert.equal(normalizeSopDate(""), null);
  assert.equal(normalizeSopDate(null), null);
  assert.equal(normalizeSopDate(undefined), null);
  assert.throws(() => normalizeSopDate("2026/10/01"));
  assert.throws(() => normalizeSopDate("invalid-date"));
});

test("SOP next review date cannot precede the effective date", () => {
  assert.doesNotThrow(() => validateSopReviewDate("2026-10-01", "2026-10-02"));
  assert.doesNotThrow(() => validateSopReviewDate("2026-10-01", "2026-10-01"));
  assert.throws(
    () => validateSopReviewDate("2026-10-01", "2026-09-30"),
    (error: unknown) => (error as { statusCode?: number; message?: string }).statusCode === 400
      && (error as { message?: string }).message === "Next review date cannot be before the effective date.",
  );
});

