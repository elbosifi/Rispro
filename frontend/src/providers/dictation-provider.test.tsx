import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LanguageProvider } from "@/providers/language-provider-component";
import { DictationProvider } from "./dictation-provider";
import { DictationControl } from "@/components/layout/dictation-control";
import { DEFAULT_DICTATION_PREFERENCES, saveDictationPreferences } from "@/lib/dictation-preferences";
import { transcribeDictation } from "@/lib/medical-dictation-api";

vi.mock("@/lib/medical-dictation-api", () => ({ transcribeDictation: vi.fn() }));
const stopTrack = vi.fn();
let mediaDevices: PropertyDescriptor | undefined;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("rispro-language", "en");
  saveDictationPreferences({ ...DEFAULT_DICTATION_PREFERENCES, keyboardShortcut: { code: "F9", ctrl: false, shift: false, alt: false, meta: false } });
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  mediaDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
  class Recorder {
    static isTypeSupported() { return true; }
    state = "inactive"; mimeType = "audio/webm";
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["audio"]) }); this.onstop?.(); }
  }
  vi.stubGlobal("MediaRecorder", Recorder);
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] })), enumerateDevices: vi.fn(async () => []) } });
  Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn((_command, _ui, text: string) => {
    const field = document.activeElement as HTMLInputElement | HTMLTextAreaElement;
    const value = field.value.slice(0, field.selectionStart!) + text + field.value.slice(field.selectionEnd!);
    const prototype = field instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" })); return true;
  }) });
  vi.mocked(transcribeDictation).mockResolvedValue({ text: "no contrast period", processing_seconds: 1 });
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks();
  Reflect.deleteProperty(document, "execCommand");
  if (mediaDevices) Object.defineProperty(navigator, "mediaDevices", mediaDevices); else Reflect.deleteProperty(navigator, "mediaDevices");
});
function Form() {
  const [value, setValue] = useState("Before selected after");
  const navigate = useNavigate();
  return <form onSubmit={(event) => { event.preventDefault(); throw new Error("Dictation must never submit"); }}>
    <textarea aria-label="Clinical notes" value={value} onChange={(event) => setValue(event.target.value)} />
    <input aria-label="Indication" defaultValue="" />
    <output>{value}</output><button type="button" onClick={() => navigate("/other-patient")}>Navigate</button>
  </form>;
}
function mount(enabled = true, sessionId = 1, context = "patient:1") {
  const ui = (active: boolean, session: number, scope: string) => <LanguageProvider><MemoryRouter><DictationProvider enabled={active} sessionId={session}><DictationControl /><div data-dictation-context={scope}><Form /></div></DictationProvider></MemoryRouter></LanguageProvider>;
  const view = render(ui(enabled, sessionId, context));
  return { ...view, update: (active = enabled, session = sessionId, scope = context) => view.rerender(ui(active, session, scope)) };
}
async function start() {
  act(() => screen.getByRole("textbox", { name: "Clinical notes" }).focus());
  fireEvent.keyDown(window, { code: "F9" });
  await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1));
  await screen.findByRole("button", { name: "Stop dictation" });
}
it("holds, stops on keyup, cleans text at the original selection, and updates React form state", async () => {
  mount(); const field = screen.getByRole("textbox", { name: "Clinical notes" }) as HTMLTextAreaElement;
  act(() => { field.focus(); field.setSelectionRange(7, 15); });
  await start(); fireEvent.keyDown(window, { code: "F9", repeat: true });
  fireEvent.keyUp(window, { code: "KeyA" }); expect(transcribeDictation).not.toHaveBeenCalled();
  fireEvent.keyUp(window, { code: "F9" });
  await waitFor(() => expect(field.value).toBe("Before No contrast. after"));
  expect(screen.getByRole("button", { name: "Start dictation" })).toBeTruthy();
  expect(screen.getByText("Before No contrast. after", { selector: "output" })).toBeTruthy();
  expect(transcribeDictation).toHaveBeenCalledTimes(1);
});
it("keeps one listener across rerenders, uses live saved Toggle and SpeechMike settings, and inserts into inputs", async () => {
  const listen = vi.spyOn(window, "addEventListener");
  const view = mount(); view.update(); view.update();
  expect(listen.mock.calls.filter(([event]) => event === "keydown")).toHaveLength(1);
  expect(listen.mock.calls.filter(([event]) => event === "keyup")).toHaveLength(1);
  act(() => saveDictationPreferences({ ...DEFAULT_DICTATION_PREFERENCES, keyboardEnabled: false, speechMikeEnabled: true, speechMikeMode: "toggle" }));
  const field = screen.getByRole("textbox", { name: "Indication" }); act(() => field.focus());
  fireEvent.keyDown(window, { code: "NumpadAdd" });
  fireEvent.keyDown(window, { code: "NumpadAdd", repeat: true }); fireEvent.keyUp(window, { code: "NumpadAdd" });
  await screen.findByRole("button", { name: "Stop dictation" });
  expect(transcribeDictation).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { code: "NumpadAdd" }); fireEvent.keyUp(window, { code: "NumpadAdd" });
  await waitFor(() => expect(field).toHaveProperty("value", "No contrast."));
  expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
});
it("uses the neutral/red/processing top-bar states and opens the existing workstation controls", async () => {
  let resolve!: (result: { text: string; processing_seconds: number }) => void;
  vi.mocked(transcribeDictation).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  mount(); const field = screen.getByRole("textbox", { name: "Indication" }); act(() => field.focus());
  const button = screen.getByRole("button", { name: "Start dictation" }); expect(button.style.color).toBe("");
  fireEvent.click(button); await screen.findByRole("button", { name: "Stop dictation" });
  expect(button.style.color).toBe("var(--state-error-text)");
  fireEvent.click(button); await screen.findByRole("button", { name: "Transcribing dictation" }); expect(button).toHaveProperty("disabled", true);
  await act(async () => resolve({ text: "normal period", processing_seconds: 1 }));
  expect(field).toHaveProperty("value", "Normal.");
  fireEvent.click(screen.getByRole("button", { name: "Dictation Controls" }));
  expect(screen.getByLabelText("Recording input")).toBeTruthy();
  expect(screen.getByLabelText("SpeechMike recording mode")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Capture Shortcut" }));
  fireEvent.keyDown(document, { code: "F8", key: "F8" });
  expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
});
it.each(["lock", "account", "route", "record", "edit", "remove", "readonly"])("discards delayed transcription after %s changes", async (change) => {
  let resolve!: (result: { text: string; processing_seconds: number }) => void;
  vi.mocked(transcribeDictation).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  const view = mount(); await start(); fireEvent.keyUp(window, { code: "F9" });
  await waitFor(() => expect(transcribeDictation).toHaveBeenCalledTimes(1));
  const field = screen.getByRole("textbox", { name: "Clinical notes" }) as HTMLTextAreaElement;
  const signal = vi.mocked(transcribeDictation).mock.calls[0][1]!;
  if (change === "lock") view.update(false);
  if (change === "account") view.update(true, 2);
  if (change === "record") view.update(true, 1, "patient:2");
  if (change === "route") fireEvent.click(screen.getByRole("button", { name: "Navigate" }));
  if (change === "edit") { fireEvent.input(field, { target: { value: "Changed" } }); fireEvent.input(field, { target: { value: "Before selected after" } }); }
  if (change === "remove") view.unmount();
  if (change === "readonly") { field.readOnly = true; await act(async () => {}); }
  await act(async () => resolve({ text: "Wrong record text", processing_seconds: 1 }));
  expect(field.value).toBe("Before selected after"); expect(signal.aborted).toBe(true);
});
it("releases pending microphone access when locked and ignores its late permission grant", async () => {
  let grant!: (media: MediaStream) => void;
  vi.mocked(navigator.mediaDevices.getUserMedia).mockReturnValueOnce(new Promise((done) => { grant = done; }));
  const view = mount(); await start(); view.update(false);
  await act(async () => grant({ getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream));
  expect(stopTrack).toHaveBeenCalled(); expect(transcribeDictation).not.toHaveBeenCalled();
});
