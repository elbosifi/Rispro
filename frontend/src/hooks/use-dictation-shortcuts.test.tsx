import { act, cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_DICTATION_PREFERENCES } from "@/lib/dictation-preferences";
import { useDictationShortcuts } from "./use-dictation-shortcuts";

beforeEach(() => { vi.useFakeTimers(); vi.spyOn(document, "hasFocus").mockReturnValue(true); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
function mount(overrides: Partial<typeof DEFAULT_DICTATION_PREFERENCES> = {}) {
  const options = { enabled: true, preferences: { ...DEFAULT_DICTATION_PREFERENCES, ...overrides }, isActive: vi.fn(() => true), start: vi.fn(), stop: vi.fn(), toggle: vi.fn() };
  const view = renderHook(() => useDictationShortcuts(options));
  return { ...view, ...options };
}
it("starts Right Shift after 200ms, stops on release, and ignores Left Shift and repeat", () => {
  const hook = mount();
  fireEvent.keyDown(window, { code: "ShiftLeft", shiftKey: true }); act(() => vi.advanceTimersByTime(300)); expect(hook.start).not.toHaveBeenCalled();
  fireEvent.keyUp(window, { code: "ShiftLeft" });
  fireEvent.keyDown(window, { code: "ShiftRight", shiftKey: true }); act(() => vi.advanceTimersByTime(199)); expect(hook.start).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1)); expect(hook.start).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(window, { code: "ShiftRight", shiftKey: true, repeat: true }); act(() => vi.advanceTimersByTime(300)); expect(hook.start).toHaveBeenCalledTimes(1);
  fireEvent.keyUp(window, { code: "ShiftRight" }); expect(hook.stop).toHaveBeenCalledTimes(1);
});
it("cancels pending Shift activation on normal typing, another held key, or early release", () => {
  const hook = mount();
  fireEvent.keyDown(window, { code: "ShiftRight", shiftKey: true }); fireEvent.keyDown(window, { code: "KeyA", shiftKey: true }); act(() => vi.advanceTimersByTime(300));
  fireEvent.keyUp(window, { code: "ShiftRight" }); fireEvent.keyUp(window, { code: "KeyA" });
  fireEvent.keyDown(window, { code: "KeyB" }); fireEvent.keyDown(window, { code: "ShiftRight", shiftKey: true }); act(() => vi.advanceTimersByTime(300));
  fireEvent.keyUp(window, { code: "KeyB" }); fireEvent.keyUp(window, { code: "ShiftRight" });
  fireEvent.keyDown(window, { code: "ShiftRight", shiftKey: true }); fireEvent.keyUp(window, { code: "ShiftRight" }); act(() => vi.advanceTimersByTime(300));
  expect(hook.start).not.toHaveBeenCalled();
});
it("toggles once per press and supports independent SpeechMike Start and Stop", () => {
  const hook = mount({ keyboardMode: "toggle", keyboardShortcut: { code: "F9", ctrl: false, alt: false, shift: false, meta: false }, speechMikeEnabled: true });
  fireEvent.keyDown(window, { code: "F9" }); fireEvent.keyDown(window, { code: "F9", repeat: true }); fireEvent.keyUp(window, { code: "F9" }); fireEvent.keyDown(window, { code: "F9" });
  expect(hook.toggle).toHaveBeenCalledTimes(2);
  fireEvent.keyDown(window, { code: "F13" }); fireEvent.keyUp(window, { code: "F13" }); expect(hook.stop).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { code: "F14" }); expect(hook.start).toHaveBeenCalledTimes(1); expect(hook.stop).toHaveBeenCalledTimes(1);
});
it("keeps SpeechMike working with keyboard disabled and stops on blur", () => {
  const hook = mount({ keyboardEnabled: false, speechMikeEnabled: true });
  fireEvent.keyDown(window, { code: "ShiftRight", shiftKey: true }); act(() => vi.advanceTimersByTime(300)); expect(hook.start).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { code: "F13" }); expect(hook.start).toHaveBeenCalledTimes(1);
  fireEvent.blur(window); expect(hook.stop).toHaveBeenCalledTimes(1);
});
it("accepts separate SpeechMike command events without requiring a held Start key", () => {
  const hook = mount({ speechMikeEnabled: true });
  fireEvent.keyDown(window, { code: "F13" }); fireEvent.keyDown(window, { code: "F13", repeat: true }); fireEvent.keyDown(window, { code: "F14" });
  fireEvent.keyDown(window, { code: "F13" }); fireEvent.keyDown(window, { code: "F14" });
  expect(hook.start).toHaveBeenCalledTimes(2); expect(hook.stop).toHaveBeenCalledTimes(2);
});
it("ignores events outside a focused dictation target and leaves save shortcuts functional", () => {
  const hook = mount({ keyboardShortcut: { code: "F9", ctrl: false, alt: false, shift: false, meta: false } });
  hook.isActive.mockReturnValue(false); fireEvent.keyDown(window, { code: "F9" }); expect(hook.start).not.toHaveBeenCalled();
  hook.isActive.mockReturnValue(true); vi.mocked(document.hasFocus).mockReturnValue(false); fireEvent.keyDown(window, { code: "F9" }); expect(hook.start).not.toHaveBeenCalled();
  vi.mocked(document.hasFocus).mockReturnValue(true);
  const save = new KeyboardEvent("keydown", { code: "KeyS", key: "s", ctrlKey: true, cancelable: true }); window.dispatchEvent(save); expect(save.defaultPrevented).toBe(false);
});
it.each(["hold", "toggle"] as const)("supports SpeechMike Numpad + in %s mode, consuming repeats and ignoring unrelated releases", (mode) => {
  const hook = mount({ speechMikeEnabled: true, speechMikeMode: mode });
  fireEvent.keyDown(window, { code: "NumpadAdd", key: "+" });
  const repeat = new KeyboardEvent("keydown", { code: "NumpadAdd", key: "+", repeat: true, cancelable: true });
  window.dispatchEvent(repeat);
  // A duplicate down without repeat must also wait for release before toggling again.
  fireEvent.keyDown(window, { code: "NumpadAdd", key: "+" });
  expect(repeat.defaultPrevented).toBe(true);
  expect(mode === "hold" ? hook.start : hook.toggle).toHaveBeenCalledTimes(1);
  fireEvent.keyUp(window, { code: "KeyA" }); expect(hook.stop).not.toHaveBeenCalled();
  fireEvent.keyUp(window, { code: "NumpadAdd", key: "+" });
  expect(hook.stop).toHaveBeenCalledTimes(mode === "hold" ? 1 : 0);
  fireEvent.keyDown(window, { code: "NumpadAdd", key: "+" });
  expect(mode === "hold" ? hook.start : hook.toggle).toHaveBeenCalledTimes(2);
});
it("keeps keyboard Right Shift hold independent from SpeechMike toggle", () => {
  const hook = mount({ speechMikeEnabled: true, speechMikeMode: "toggle" });
  fireEvent.keyDown(window, { code: "NumpadAdd" }); fireEvent.keyUp(window, { code: "NumpadAdd" });
  fireEvent.keyDown(window, { code: "NumpadAdd" }); fireEvent.keyUp(window, { code: "NumpadAdd" });
  expect(hook.toggle).toHaveBeenCalledTimes(2); expect(hook.stop).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { code: "ShiftRight", shiftKey: true }); act(() => vi.advanceTimersByTime(200));
  expect(hook.start).toHaveBeenCalledTimes(1);
  fireEvent.keyUp(window, { code: "ShiftRight" }); expect(hook.stop).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(window, { code: "F13" }); fireEvent.keyDown(window, { code: "F14" });
  expect(hook.start).toHaveBeenCalledTimes(1); expect(hook.stop).toHaveBeenCalledTimes(1);
});
it.each(["hold", "toggle"] as const)("stops SpeechMike %s on focus loss and hidden visibility", (mode) => {
  const hook = mount({ keyboardEnabled: false, speechMikeEnabled: true, speechMikeMode: mode });
  fireEvent.keyDown(window, { code: "NumpadAdd" }); fireEvent.blur(window);
  expect(hook.stop).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(window, { code: "NumpadAdd" });
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  fireEvent(document, new Event("visibilitychange")); expect(hook.stop).toHaveBeenCalledTimes(2);
  fireEvent.keyDown(window, { code: "NumpadAdd" });
  expect(mode === "hold" ? hook.start : hook.toggle).toHaveBeenCalledTimes(2);
});
it("ignores permission-prompt blur while requesting but still stops Hold-to-Talk on release", () => {
  const options = { enabled: true, preferences: DEFAULT_DICTATION_PREFERENCES, isActive: () => true,
    start: vi.fn(), stop: vi.fn(), toggle: vi.fn(), isRequesting: () => true };
  renderHook(() => useDictationShortcuts(options));
  fireEvent.keyDown(window, { code: "ShiftRight", shiftKey: true }); act(() => vi.advanceTimersByTime(200));
  fireEvent.blur(window); expect(options.stop).not.toHaveBeenCalled();
  fireEvent.keyUp(window, { code: "ShiftRight" }); expect(options.stop).toHaveBeenCalledTimes(1);
});
