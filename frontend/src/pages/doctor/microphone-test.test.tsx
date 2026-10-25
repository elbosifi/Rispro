import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EnglishLanguageScope } from "@/providers/language-provider-component";
import { loadDictationPreferences } from "@/lib/dictation-preferences";
import { DictationControlsPage } from "./dictation-controls-page";

const stopTrack = vi.fn();
const play = vi.fn(async () => {});
const createURL = vi.fn<(blob: Blob) => string>(() => "blob:local-microphone-test");
const revokeURL = vi.fn();
const getUserMedia = vi.fn();
let mediaDescriptor: PropertyDescriptor | undefined;
let permissionDescriptor: PropertyDescriptor | undefined;
beforeEach(() => {
  localStorage.clear();
  mediaDescriptor = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
  permissionDescriptor = Object.getOwnPropertyDescriptor(navigator, "permissions");
  vi.stubGlobal("fetch", vi.fn());
  vi.stubGlobal("MediaRecorder", class {
    static isTypeSupported(type: string) { return type === "audio/mp4"; }
    mimeType = "audio/mp4"; state = "inactive";
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["recorded audio"]) }); this.onstop?.(); }
  });
  getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] });
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
    getUserMedia,
    enumerateDevices: vi.fn(async () => [{ kind: "audioinput", deviceId: "usb", label: "SpeechMike USB" }]),
  } });
  Object.defineProperty(navigator, "permissions", { configurable: true, value: { query: vi.fn(async () => ({ state: "prompt", onchange: null })) } });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.stubGlobal("URL", class extends URL { static createObjectURL = createURL; static revokeObjectURL = revokeURL; });
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks();
  if (mediaDescriptor) Object.defineProperty(navigator, "mediaDevices", mediaDescriptor); else Reflect.deleteProperty(navigator, "mediaDevices");
  if (permissionDescriptor) Object.defineProperty(navigator, "permissions", permissionDescriptor); else Reflect.deleteProperty(navigator, "permissions");
});
function mount() { return render(<EnglishLanguageScope><DictationControlsPage /></EnglishLanguageScope>); }
it("selects a microphone, records and plays exactly the local blob, never uploads, and revokes the URL", async () => {
  const view = mount();
  await screen.findByRole("option", { name: "SpeechMike USB" });
  fireEvent.change(screen.getByLabelText("Recording input"), { target: { value: "usb" } });
  expect(loadDictationPreferences().deviceId).toBe("usb");
  fireEvent.click(screen.getByRole("button", { name: "Record Test" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Stop Test" })).toHaveProperty("disabled", false));
  expect(getUserMedia).toHaveBeenCalledWith({ audio: { deviceId: { exact: "usb" } } });
  expect(await screen.findByText("Microphone permission: Allowed")).toBeTruthy();
  expect(screen.getByRole("meter", { name: "Live audio level" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Stop Test" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Play Recording" })).toHaveProperty("disabled", false));
  const blob = createURL.mock.calls[0][0] as Blob;
  expect(blob.type).toBe("audio/mp4"); expect(blob.size).toBe(new Blob(["recorded audio"]).size);
  fireEvent.click(screen.getByRole("button", { name: "Play Recording" }));
  expect(play).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText("Microphone test recording").getAttribute("src")).toBe("blob:local-microphone-test");
  expect(fetch).not.toHaveBeenCalled();
  view.unmount(); expect(revokeURL).toHaveBeenCalledWith("blob:local-microphone-test"); expect(stopTrack).toHaveBeenCalled();
});
it("shows fallback and browser-permission guidance", async () => {
  mount(); await screen.findByRole("option", { name: "SpeechMike USB" });
  fireEvent.change(screen.getByLabelText("Recording input"), { target: { value: "usb" } });
  getUserMedia.mockRejectedValueOnce(new DOMException("Gone", "NotFoundError"));
  fireEvent.click(screen.getByRole("button", { name: "Record Test" }));
  await screen.findByText("Selected microphone is unavailable. Using the workstation default microphone.");
  fireEvent.click(screen.getByRole("button", { name: "Stop Test" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Record Test" })).toHaveProperty("disabled", false));
  getUserMedia.mockRejectedValueOnce(new DOMException("Denied", "NotAllowedError"));
  fireEvent.click(screen.getByRole("button", { name: "Record Test" }));
  expect(await screen.findByText("Microphone permission: Blocked")).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toContain("permissions");
  expect(fetch).not.toHaveBeenCalled();
});
it("reports playback failure and releases an active test on closing the dropdown", async () => {
  const view = mount();
  fireEvent.click(screen.getByRole("button", { name: "Record Test" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Stop Test" })).toHaveProperty("disabled", false));
  fireEvent.click(screen.getByRole("button", { name: "Stop Test" }));
  play.mockRejectedValueOnce(new Error("unsupported codec"));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Play Recording" })));
  expect(screen.getByRole("alert").textContent).toContain("Could not play");
  fireEvent.click(screen.getByRole("button", { name: "Record Test" }));
  await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
  stopTrack.mockClear(); view.unmount(); expect(stopTrack).toHaveBeenCalledTimes(1);
});
