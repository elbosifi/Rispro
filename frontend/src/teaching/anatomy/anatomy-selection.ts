export type AnatomyOverlayMode = "off" | "selected";

export interface AnatomySelectionState {
  selectedStructureId: string | null;
  overlayMode: AnatomyOverlayMode;
}

export type AnatomySelectionAction =
  | { type: "select-structure"; structureId: string }
  | { type: "clear-selection" }
  | { type: "set-overlay-mode"; overlayMode: AnatomyOverlayMode };

export const initialAnatomySelectionState: AnatomySelectionState = {
  selectedStructureId: null,
  overlayMode: "off",
};

export function anatomySelectionReducer(state: AnatomySelectionState, action: AnatomySelectionAction): AnatomySelectionState {
  switch (action.type) {
    case "select-structure": return { ...state, selectedStructureId: action.structureId };
    case "clear-selection": return { ...state, selectedStructureId: null };
    case "set-overlay-mode": return { ...state, overlayMode: action.overlayMode };
  }
}
