import { beforeEach, expect, it } from "vitest";
import { DEFAULT_DICTATION_PREFERENCES, DICTATION_PREFERENCES_KEY, formatShortcut, hasConflictingDictationShortcuts, loadDictationPreferences, matchesShortcut, saveDictationPreferences, shortcutError, shortcutFromEvent, type DictationPreferences } from "./dictation-preferences";

beforeEach(() => localStorage.clear());
it("defaults to enabled physical Right Shift hold mode and persists independent controls", () => {
  expect(loadDictationPreferences()).toEqual(DEFAULT_DICTATION_PREFERENCES);
  const preferences = { ...loadDictationPreferences(), keyboardEnabled: false, keyboardMode: "toggle" as const, speechMikeEnabled: true, deviceId: "usb-mic" };
  saveDictationPreferences(preferences);
  expect(loadDictationPreferences()).toEqual(preferences);
});
it("uses physical codes and distinguishes Right Shift from Left Shift", () => {
  const right = new KeyboardEvent("keydown", { key: "Shift", code: "ShiftRight", shiftKey: true });
  expect(formatShortcut(shortcutFromEvent(right))).toBe("Right Shift");
  expect(matchesShortcut(right, DEFAULT_DICTATION_PREFERENCES.keyboardShortcut)).toBe(true);
  expect(matchesShortcut(new KeyboardEvent("keydown", { code: "ShiftLeft", shiftKey: true }), DEFAULT_DICTATION_PREFERENCES.keyboardShortcut)).toBe(false);
  expect(formatShortcut(shortcutFromEvent(new KeyboardEvent("keydown", { code: "F9", ctrlKey: true, shiftKey: true })))).toBe("Ctrl + Shift + F9");
});
it.each(["F1", "F3", "F4", "F5", "F6", "F7", "F10", "F11", "F12", "KeyA", "Space", "Enter", "Tab"])("rejects reserved or typing key %s", (code) => {
  expect(shortcutError(shortcutFromEvent(new KeyboardEvent("keydown", { code })))).toBeTruthy();
});
it("rejects system and existing save/navigation combinations", () => {
  for (const init of [{ code: "KeyS", ctrlKey: true }, { code: "Enter", ctrlKey: true }, { code: "ArrowRight", altKey: true }, { code: "F4", altKey: true }, { code: "F9", metaKey: true }]) {
    expect(shortcutError(shortcutFromEvent(new KeyboardEvent("keydown", init)))).toBeTruthy();
  }
});
it("recovers from corrupt storage and conflicting bindings", () => {
  localStorage.setItem(DICTATION_PREFERENCES_KEY, "broken"); expect(loadDictationPreferences()).toEqual(DEFAULT_DICTATION_PREFERENCES);
  localStorage.setItem(DICTATION_PREFERENCES_KEY, JSON.stringify({ ...DEFAULT_DICTATION_PREFERENCES, speechMikeStart: DEFAULT_DICTATION_PREFERENCES.keyboardShortcut }));
  expect(loadDictationPreferences()).toEqual(DEFAULT_DICTATION_PREFERENCES);
});
it.each([
  [{ code: "NumpadAdd", key: "+" }, "Numpad +"],
  [{ code: "NumpadSubtract", key: "-" }, "Numpad −"],
  [{ code: "Pause", key: "Pause" }, "Pause"],
  [{ code: "F15", key: "F15", altKey: true }, "Alt + F15"],
  [{ code: "F9", key: "F9", ctrlKey: true, shiftKey: true }, "Ctrl + Shift + F9"],
] as const)("captures the actual safe shortcut %j", (init, label) => {
  const shortcut = shortcutFromEvent(new KeyboardEvent("keydown", init));
  expect(shortcut.code).toBe(init.code); expect(shortcut.key).toBe(init.key);
  expect(shortcutError(shortcut)).toBeNull(); expect(formatShortcut(shortcut)).toBe(label);
});
it.each([{ code: "NumpadAdd", ctrlKey: true }, { code: "Tab", altKey: true }, { code: "KeyA" }, { code: "KeyS", ctrlKey: true, shiftKey: true }, { code: "F15", ctrlKey: true, altKey: true }])("preserves reserved shortcuts %j", (init) => {
  expect(shortcutError(shortcutFromEvent(new KeyboardEvent("keydown", init)))).toBeTruthy();
});
it("loads legacy preferences as separate Start/Stop without losing custom bindings", () => {
  const legacy: Partial<DictationPreferences> = { ...DEFAULT_DICTATION_PREFERENCES, speechMikeEnabled: true, speechMikeStart: { code: "F15", ctrl: true, shift: true, alt: false, meta: false }, deviceId: "usb-mic" };
  delete legacy.speechMikeMode; delete legacy.speechMikeShortcut;
  localStorage.setItem(DICTATION_PREFERENCES_KEY, JSON.stringify(legacy));
  expect(loadDictationPreferences()).toMatchObject({ ...legacy, speechMikeMode: "separate", speechMikeShortcut: { code: "NumpadAdd" } });
});
it("checks only the bindings used by the selected SpeechMike mode", () => {
  const preferences = { ...DEFAULT_DICTATION_PREFERENCES, speechMikeMode: "toggle" as const, speechMikeShortcut: DEFAULT_DICTATION_PREFERENCES.speechMikeStart };
  expect(hasConflictingDictationShortcuts(preferences)).toBe(false);
  saveDictationPreferences(preferences); expect(loadDictationPreferences()).toEqual(preferences);
  expect(hasConflictingDictationShortcuts({ ...preferences, speechMikeShortcut: preferences.keyboardShortcut })).toBe(true);
  expect(hasConflictingDictationShortcuts({ ...preferences, speechMikeMode: "separate", speechMikeStop: preferences.speechMikeStart })).toBe(true);
});
