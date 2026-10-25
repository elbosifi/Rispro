import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DictationControlsPage } from "./dictation-controls-page";
import { formatShortcut, loadDictationPreferences } from "@/lib/dictation-preferences";

beforeEach(() => { localStorage.clear(); vi.spyOn(window, "scrollTo").mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
it("offers the static Windows microphone setup download and a selectable installation command", () => {
  render(<DictationControlsPage />);
  const download = screen.getByRole("link", { name: "Download Windows Setup Script" });
  expect(download.getAttribute("href")).toBe("/downloads/Repair-RISpro-Microphone-Windows.ps1");
  expect(download.getAttribute("download")).toBe("Repair-RISpro-Microphone-Windows.ps1");
  const command = screen.getByRole("textbox", { name: "PowerShell command (select to copy)" }) as HTMLInputElement;
  expect(command.readOnly).toBe(true);
  expect(command.value).toBe('powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\\Repair-RISpro-Microphone-Windows.ps1"');
  fireEvent.focus(command);
  expect(command.selectionEnd! - command.selectionStart!).toBe(command.value.length);
});
it("captures physical Right Shift, a modified function key, and persists mode and enabled settings", () => {
  const view = render(<DictationControlsPage />);
  fireEvent.click(screen.getByRole("button", { name: "Capture Shortcut" }));
  expect(screen.getByRole("status").textContent).toContain("Press the key or key combination you want to use.");
  fireEvent.keyDown(document, { code: "ShiftRight", key: "Shift", shiftKey: true });
  fireEvent.keyUp(document, { code: "ShiftRight", key: "Shift" });
  expect(formatShortcut(loadDictationPreferences().keyboardShortcut)).toBe("Right Shift");
  fireEvent.click(screen.getByRole("button", { name: "Capture Shortcut" }));
  fireEvent.keyDown(document, { code: "ControlLeft", ctrlKey: true });
  fireEvent.keyDown(document, { code: "ShiftLeft", ctrlKey: true, shiftKey: true });
  fireEvent.keyDown(document, { code: "F9", ctrlKey: true, shiftKey: true });
  expect(formatShortcut(loadDictationPreferences().keyboardShortcut)).toBe("Ctrl + Shift + F9");
  fireEvent.change(screen.getByLabelText("Recording mode"), { target: { value: "toggle" } });
  fireEvent.click(screen.getByLabelText("Enable keyboard dictation"));
  view.unmount(); render(<DictationControlsPage />);
  expect(screen.getByLabelText("Enable keyboard dictation")).toHaveProperty("checked", false);
  expect(screen.getByLabelText("Recording mode")).toHaveProperty("value", "toggle");
  fireEvent.click(screen.getByRole("button", { name: "Reset keyboard to default" }));
  expect(loadDictationPreferences().keyboardMode).toBe("hold");
});
it("captures SpeechMike generated Start/Stop events independently of keyboard enablement", () => {
  render(<DictationControlsPage />);
  fireEvent.click(screen.getByLabelText("Enable keyboard dictation"));
  fireEvent.click(screen.getByLabelText("Enable SpeechMike shortcuts"));
  for (const [label, code] of [["Capture Start Shortcut", "F15"], ["Capture Stop Shortcut", "F16"]]) {
    fireEvent.click(screen.getByRole("button", { name: label })); fireEvent.keyDown(document, { code, key: code });
  }
  expect(loadDictationPreferences()).toMatchObject({ keyboardEnabled: false, speechMikeEnabled: true, speechMikeStart: { code: "F15" }, speechMikeStop: { code: "F16" } });
  expect(screen.getByText(/If nothing is captured/).textContent).toContain("SpeechControl");
});
it("rejects reserved and duplicate shortcuts, suppresses capture events, and cancels on Escape", () => {
  const activated = vi.fn(); window.addEventListener("keydown", activated);
  render(<DictationControlsPage />);
  fireEvent.click(screen.getByRole("button", { name: "Capture Shortcut" }));
  fireEvent.keyDown(document, { code: "KeyS", key: "s", ctrlKey: true });
  expect(screen.getByRole("alert").textContent).toContain("reserved");
  expect(activated).not.toHaveBeenCalled();
  fireEvent.keyDown(document, { code: "F13", key: "F13" });
  expect(screen.getByRole("alert").textContent).toContain("already used");
  fireEvent.keyDown(document, { code: "Escape", key: "Escape" });
  expect(screen.queryByText("Press the key or key combination you want to use.")).toBeNull();
  expect(loadDictationPreferences().keyboardShortcut.code).toBe("ShiftRight");
  window.removeEventListener("keydown", activated);
});
it("captures NumpadAdd for SpeechMike Toggle and persists an independent keyboard mode", () => {
  const view = render(<DictationControlsPage />);
  expect(screen.getByLabelText("SpeechMike recording mode")).toHaveProperty("value", "separate");
  fireEvent.change(screen.getByLabelText("SpeechMike recording mode"), { target: { value: "toggle" } });
  expect(screen.queryByRole("button", { name: "Capture Start Shortcut" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Capture SpeechMike Shortcut" }));
  fireEvent.keyDown(document, { code: "NumpadAdd", key: "+" });
  expect(screen.getByText("Numpad +")).toBeTruthy();
  expect(loadDictationPreferences()).toMatchObject({ speechMikeMode: "toggle", speechMikeShortcut: { code: "NumpadAdd", key: "+" }, keyboardMode: "hold", keyboardShortcut: { code: "ShiftRight" } });
  view.unmount(); render(<DictationControlsPage />);
  expect(screen.getByLabelText("SpeechMike recording mode")).toHaveProperty("value", "toggle");
  fireEvent.change(screen.getByLabelText("SpeechMike recording mode"), { target: { value: "hold" } });
  expect(screen.getByText(/immediate Keydown\/Keyup pair/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Capture SpeechMike Shortcut" }));
  fireEvent.keyDown(document, { code: "ShiftRight", key: "Shift", shiftKey: true });
  fireEvent.keyUp(document, { code: "ShiftRight", key: "Shift" });
  expect(screen.getByRole("alert").textContent).toContain("already used");
});
it("detects keyboard event metadata without recording, storing typed text, or changing bindings", () => {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
  const getUserMedia = vi.fn();
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  try {
    render(<DictationControlsPage />);
    const preferences = loadDictationPreferences();
    fireEvent.click(screen.getByRole("button", { name: "Detect SpeechMike Button" }));
    fireEvent.keyDown(document, { code: "NumpadAdd", key: "+" });
    fireEvent.keyUp(document, { code: "NumpadAdd", key: "+" });
    const events = screen.getByRole("list", { name: "Detected keyboard events" });
    expect(events.textContent).toContain("Keydown · code: NumpadAdd · key: + · modifiers: none");
    expect(events.textContent).toContain("Keyup · code: NumpadAdd");
    expect(screen.getByText("Detected: Numpad +. This shortcut can be used for dictation.")).toBeTruthy();
    fireEvent.keyDown(document, { code: "F9", key: "F9", ctrlKey: true, shiftKey: true });
    expect(events.textContent).toContain("modifiers: Ctrl + Shift");
    fireEvent.keyDown(document, { code: "KeyA", key: "typed-text-must-not-be-retained" });
    expect(events.textContent).not.toContain("KeyA");
    expect(screen.queryByText(/typed-text-must-not-be-retained/)).toBeNull();
    expect(getUserMedia).not.toHaveBeenCalled(); expect(loadDictationPreferences()).toEqual(preferences);
    fireEvent.keyDown(document, { code: "Escape", key: "Escape" });
    expect(screen.queryByRole("button", { name: "Stop detection" })).toBeNull();
  } finally {
    if (descriptor) Object.defineProperty(navigator, "mediaDevices", descriptor);
    else Reflect.deleteProperty(navigator, "mediaDevices");
  }
});
it("explains missing keyboard mapping after detection times out", () => {
  vi.useFakeTimers(); render(<DictationControlsPage />);
  fireEvent.click(screen.getByRole("button", { name: "Detect SpeechMike Button" }));
  act(() => vi.advanceTimersByTime(10_000));
  expect(screen.getByText("No keyboard event detected. Configure the SpeechMike button as a keyboard shortcut in Philips SpeechControl.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Detect SpeechMike Button" })).toBeTruthy();
});
