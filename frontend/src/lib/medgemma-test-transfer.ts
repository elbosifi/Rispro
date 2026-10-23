// One pending text transfer in memory only: no audio, URL, history or browser storage.
let pendingText: string | null = null;
export function setMedGemmaTestText(text: string) { pendingText = text; }
export function getMedGemmaTestText() { return pendingText; }
export function clearMedGemmaTestText() { pendingText = null; }
