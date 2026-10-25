export type DictationShortcut = { code: string; key?: string; ctrl: boolean; alt: boolean; shift: boolean; meta: boolean };
export type SpeechMikeMode = "hold" | "toggle" | "separate";
export type DictationPreferences = {
  keyboardEnabled: boolean;
  keyboardShortcut: DictationShortcut;
  keyboardMode: "hold" | "toggle";
  speechMikeEnabled: boolean;
  speechMikeMode: SpeechMikeMode;
  speechMikeShortcut: DictationShortcut;
  speechMikeStart: DictationShortcut;
  speechMikeStop: DictationShortcut;
  deviceId: string;
};
export const DICTATION_PREFERENCES_KEY = "rispro.workstation.dictation.v1";
const key = (code: string): DictationShortcut => ({ code, ctrl: false, alt: false, shift: false, meta: false });
export const DEFAULT_DICTATION_PREFERENCES: DictationPreferences = {
  keyboardEnabled: true, keyboardShortcut: key("ShiftRight"), keyboardMode: "hold",
  speechMikeEnabled: false, speechMikeMode: "separate", speechMikeShortcut: key("NumpadAdd"), speechMikeStart: key("F13"), speechMikeStop: key("F14"), deviceId: "",
};
export type DictationBinding = "keyboardShortcut" | "speechMikeShortcut" | "speechMikeStart" | "speechMikeStop";
export function dictationBindings(preferences: DictationPreferences): DictationBinding[] {
  return preferences.speechMikeMode === "separate" ? ["keyboardShortcut", "speechMikeStart", "speechMikeStop"] : ["keyboardShortcut", "speechMikeShortcut"];
}
export function hasConflictingDictationShortcuts(preferences: DictationPreferences): boolean {
  const shortcuts = dictationBindings(preferences).map((binding) => preferences[binding]);
  return shortcuts.some((a, i) => shortcuts.slice(i + 1).some((b) => sameShortcut(a, b)));
}
export const isStandaloneModifier = (shortcut: DictationShortcut) => /^Shift(Left|Right)$/.test(shortcut.code);

export function shortcutFromEvent(event: KeyboardEvent): DictationShortcut {
  return { code: event.code, key: event.key, ctrl: event.ctrlKey, alt: event.altKey,
    shift: /^Shift/.test(event.code) ? false : event.shiftKey, meta: event.metaKey };
}
export function sameShortcut(a: DictationShortcut, b: DictationShortcut): boolean {
  return a.code === b.code && a.ctrl === b.ctrl && a.alt === b.alt && a.shift === b.shift && a.meta === b.meta;
}
export function matchesShortcut(event: KeyboardEvent, shortcut: DictationShortcut): boolean {
  return !event.isComposing && !event.getModifierState?.("AltGraph") && sameShortcut(shortcutFromEvent(event), shortcut);
}
/** Keep typing, browser/system commands and existing Protocoling commands available. */
export function shortcutError(shortcut: DictationShortcut): string | null {
  if (shortcut.meta || (shortcut.ctrl && shortcut.alt)) return "System shortcuts and Ctrl + Alt (AltGr) cannot be used.";
  if (isStandaloneModifier(shortcut) && !shortcut.ctrl && !shortcut.alt && !shortcut.shift) return null;
  const functionKey = /^F([1-9]|1\d|2[0-4])$/.exec(shortcut.code);
  if (functionKey && ![1, 3, 4, 5, 6, 7, 10, 11, 12].includes(Number(functionKey[1]))) return null;
  if (["NumpadAdd", "NumpadSubtract", "NumpadMultiply", "NumpadDivide", "Pause"].includes(shortcut.code) && !shortcut.ctrl && !shortcut.alt) return null;
  return "Choose a numpad operator such as Numpad +, a function key such as F9 or Ctrl + Shift + F9, Pause, or Shift alone. Text-entry, browser, system, and editing shortcuts are reserved.";
}
export function formatShortcut(shortcut: DictationShortcut): string {
  const labels: Record<string, string> = { ShiftRight: "Right Shift", ShiftLeft: "Left Shift", NumpadAdd: "Numpad +", NumpadSubtract: "Numpad −", NumpadMultiply: "Numpad *", NumpadDivide: "Numpad /" };
  const label = labels[shortcut.code] ?? shortcut.code;
  return [shortcut.ctrl && "Ctrl", shortcut.alt && "Alt", shortcut.shift && "Shift", label].filter(Boolean).join(" + ");
}
function validShortcut(value: unknown): value is DictationShortcut {
  if (!value || typeof value !== "object") return false;
  const raw = value as DictationShortcut;
  return typeof raw.code === "string" && (raw.key === undefined || typeof raw.key === "string") && [raw.ctrl, raw.alt, raw.shift, raw.meta].every((v) => typeof v === "boolean") && !shortcutError(raw);
}
export function loadDictationPreferences(): DictationPreferences {
  const defaults = structuredClone(DEFAULT_DICTATION_PREFERENCES);
  try {
    const raw = JSON.parse(localStorage.getItem(DICTATION_PREFERENCES_KEY) ?? "null") as Partial<DictationPreferences> | null;
    if (!raw) return defaults;
    const preferences: DictationPreferences = {
      keyboardEnabled: typeof raw.keyboardEnabled === "boolean" ? raw.keyboardEnabled : defaults.keyboardEnabled,
      keyboardShortcut: validShortcut(raw.keyboardShortcut) ? raw.keyboardShortcut : defaults.keyboardShortcut,
      keyboardMode: raw.keyboardMode === "toggle" ? "toggle" : "hold",
      speechMikeEnabled: typeof raw.speechMikeEnabled === "boolean" ? raw.speechMikeEnabled : defaults.speechMikeEnabled,
      speechMikeMode: raw.speechMikeMode === "hold" || raw.speechMikeMode === "toggle" ? raw.speechMikeMode : "separate",
      speechMikeShortcut: validShortcut(raw.speechMikeShortcut) ? raw.speechMikeShortcut : defaults.speechMikeShortcut,
      speechMikeStart: validShortcut(raw.speechMikeStart) && !isStandaloneModifier(raw.speechMikeStart) ? raw.speechMikeStart : defaults.speechMikeStart,
      speechMikeStop: validShortcut(raw.speechMikeStop) && !isStandaloneModifier(raw.speechMikeStop) ? raw.speechMikeStop : defaults.speechMikeStop,
      deviceId: typeof raw.deviceId === "string" ? raw.deviceId : "",
    };
    if (hasConflictingDictationShortcuts(preferences)) return defaults;
    return preferences;
  } catch { return defaults; }
}
export const DICTATION_PREFERENCES_CHANGED = "rispro:dictation-preferences-changed";
export function saveDictationPreferences(preferences: DictationPreferences): void {
  localStorage.setItem(DICTATION_PREFERENCES_KEY, JSON.stringify(preferences));
  window.dispatchEvent(new Event(DICTATION_PREFERENCES_CHANGED));
}
