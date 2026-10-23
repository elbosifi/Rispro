import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DictationControlsPage } from "./dictation-controls-page";
import { formatShortcut, loadDictationPreferences } from "@/lib/dictation-preferences";

beforeEach(() => { localStorage.clear(); vi.spyOn(window, "scrollTo").mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
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
