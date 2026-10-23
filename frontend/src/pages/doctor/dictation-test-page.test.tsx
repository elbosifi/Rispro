import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { EnglishLanguageScope } from "@/providers/language-provider-component";
import * as api from "@/lib/medical-dictation-api";
import { useAudioRecorder } from "@/hooks/use-audio-recorder";
import { DictationTestPage } from "./dictation-test-page";

vi.mock("@/lib/medical-dictation-api"); vi.mock("@/hooks/use-audio-recorder");
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.getDictationHealth).mockResolvedValue({ status: "connected", model: "google/medasr", credentialsValidated: false });
  vi.mocked(api.transcribeDictation).mockResolvedValue({ text: "Normal chest radiograph.", processing_seconds: 2.8 });
  vi.mocked(useAudioRecorder).mockReturnValue({ phase: "idle", recording: new Blob(["audio"]), duration: 3, error: null, start: vi.fn(), stop: vi.fn(), clear: vi.fn() });
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
});
function mount() { render(<EnglishLanguageScope><DictationTestPage /></EnglishLanguageScope>); }
it("transcribes, displays processing time and permits editing, copying and clearing text", async () => {
  mount(); await screen.findByText("Model: google/medasr");
  fireEvent.click(screen.getByRole("button", { name: "Transcribe" }));
  await waitFor(() => expect(screen.getByLabelText("Transcription")).toHaveProperty("value", "Normal chest radiograph."));
  expect(screen.getByText("Processing time: 2.8 seconds")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Transcription"), { target: { value: "Edited text" } });
  fireEvent.click(screen.getByRole("button", { name: "Copy Text" })); await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Edited text"));
  fireEvent.click(screen.getByRole("button", { name: "Clear Text" })); expect(screen.getByLabelText("Transcription")).toHaveProperty("value", "");
});
it("shows disabled status and prevents recording/transcription", async () => {
  vi.mocked(api.getDictationHealth).mockResolvedValue({ status: "disabled", credentialsValidated: false });
  mount(); await screen.findByText(/Connection Status: Disabled/);
  expect(screen.getByRole("button", { name: "Start Recording" })).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", { name: "Transcribe" })).toHaveProperty("disabled", true);
});
it("shows request failures and preserves editable text", async () => {
  vi.mocked(api.transcribeDictation).mockRejectedValue(new Error("MedASR request timed out."));
  mount(); await screen.findByText("Model: google/medasr"); fireEvent.change(screen.getByLabelText("Transcription"), { target: { value: "Keep this text" } });
  fireEvent.click(screen.getByRole("button", { name: "Transcribe" })); expect(await screen.findByText("MedASR request timed out.")).toBeTruthy();
  expect(screen.getByLabelText("Transcription")).toHaveProperty("value", "Keep this text");
});
