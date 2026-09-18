import assert from "node:assert/strict";
import test from "node:test";
import { SOP_SECTION_DEFINITIONS } from "./constants.js";
import { normalizeSopCode, validateSopDocument } from "./sop-validation.js";

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
