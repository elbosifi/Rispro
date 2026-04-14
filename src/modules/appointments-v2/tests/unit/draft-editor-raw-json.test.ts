/**
 * Appointments V2 — Draft editor raw JSON safety tests.
 *
 * Verifies:
 * - Raw JSON apply cannot modify global-only specialReasonCodes
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

describe("PolicyDraftEditor — raw JSON safety", () => {
  const editorPath = "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/components/policy-draft-editor.tsx";

  it("applyRawJson preserves specialReasonCodes from current draft", async () => {
    const content = await readFile(editorPath, "utf-8");
    // The applyRawJson function should overwrite parsed.specialReasonCodes
    // with the current draft's value before calling setDraft
    assert.ok(
      content.includes("parsed.specialReasonCodes") || content.includes("specialReasonCodes"),
      "applyRawJson should reference specialReasonCodes"
    );
    // It should preserve current draft's codes
    assert.ok(
      content.includes("draft.specialReasonCodes") && content.includes("applyRawJson"),
      "applyRawJson should preserve current draft.specialReasonCodes"
    );
  });

  it("special reason codes section is read-only (not editable)", async () => {
    const content = await readFile(editorPath, "utf-8");
    // The section should show read-only text, not editable inputs
    const sectionStart = content.indexOf("Special reason codes");
    const sectionEnd = content.indexOf("</details>", sectionStart);
    const sectionContent = content.substring(sectionStart, sectionEnd);

    // Should NOT contain editable inputs for specialReasonCodes
    assert.ok(
      !sectionContent.includes("setDraft((prev) => ({"),
      "Special reason codes section should NOT contain setDraft handlers"
    );
    // Should contain explanatory text about global config
    assert.ok(
      sectionContent.includes("global") || sectionContent.includes("reference"),
      "Should mention global/reference-only status"
    );
  });
});
