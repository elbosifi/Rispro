import { describe, expect, it } from "vitest";
import { anatomySelectionReducer, initialAnatomySelectionState } from "./anatomy-selection";

describe("Teaching anatomy selection and overlay state", () => {
  it("selects any manifest structure and preserves that selection when overlay mode changes", () => {
    const selected = anatomySelectionReducer(initialAnatomySelectionState, { type: "select-structure", structureId: "segment-viii" });
    expect(selected.selectedStructureId).toBe("segment-viii");
    const overlay = anatomySelectionReducer(selected, { type: "set-overlay-mode", overlayMode: "selected" });
    expect(overlay).toEqual({ selectedStructureId: "segment-viii", overlayMode: "selected" });
    expect(anatomySelectionReducer(overlay, { type: "set-overlay-mode", overlayMode: "off" })).toEqual({ selectedStructureId: "segment-viii", overlayMode: "off" });
  });
});
