import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { EnglishLanguageScope } from "@/providers/language-provider-component";
import * as api from "@/lib/medical-dictation-api";
import { useAudioRecorder } from "@/hooks/use-audio-recorder";
import { DictationTestPage } from "./dictation-test-page";
import { clearMedGemmaTestText, getMedGemmaTestText } from "@/lib/medgemma-test-transfer";

vi.mock("@/lib/medical-dictation-api"); vi.mock("@/hooks/use-audio-recorder");
beforeEach(() => {
  vi.resetAllMocks();
  clearMedGemmaTestText();
  vi.mocked(api.getDictationHealth).mockResolvedValue({ status: "connected", model: "google/medasr", credentialsValidated: false });
  vi.mocked(api.transcribeDictation).mockResolvedValue({ text: "Normal chest radiograph.", processing_seconds: 2.8 });
  vi.mocked(useAudioRecorder).mockReturnValue({ phase: "idle", recording: new Blob(["audio"]), duration: 3, error: null, start: vi.fn(), stop: vi.fn(), clear: vi.fn() });
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
});
function mount() { render(<MemoryRouter><EnglishLanguageScope><DictationTestPage /></EnglishLanguageScope></MemoryRouter>); }
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
it("transfers only successful transcription text to MedGemma using memory", async () => {
  mount(); await screen.findByText("Model: google/medasr");
  expect(screen.getByRole("button", { name: "Send to MedGemma" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "Transcribe" }));
  await waitFor(() => expect(screen.getByLabelText("Transcription")).toHaveProperty("value", "Normal chest radiograph."));
  fireEvent.change(screen.getByLabelText("Transcription"), { target: { value: "Edited recognized text" } });
  fireEvent.click(screen.getByRole("button", { name: "Send to MedGemma" }));
  expect(getMedGemmaTestText()).toBe("Edited recognized text");
});

it("previews, copies and transfers cleaned text while keeping the original editable", async () => {
  const original = "Um no right lesion period no left edema period";
  const cleaned = "No right lesion. No left edema.";
  mount(); await screen.findByText("Model: google/medasr");
  expect(screen.getByRole("button", { name: "Send Cleaned to MedGemma" })).toHaveProperty("disabled", true);
  fireEvent.change(screen.getByLabelText("Transcription"), { target: { value: original } });
  expect(screen.getByLabelText("Transcription")).toHaveProperty("value", original);
  expect(screen.getByLabelText("Transcription")).toHaveProperty("readOnly", false);
  expect(screen.getByLabelText("Basic Cleaned Text")).toHaveProperty("value", cleaned);
  expect(screen.getByLabelText("Basic Cleaned Text")).toHaveProperty("readOnly", true);
  fireEvent.click(screen.getByRole("button", { name: "Copy Cleaned Text" }));
  await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(cleaned));
  fireEvent.click(screen.getByRole("button", { name: "Send Cleaned to MedGemma" }));
  expect(getMedGemmaTestText()).toBe(cleaned);
  expect(api.transcribeDictation).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Transcription"), { target: { value: "No mass period" } });
  expect(screen.getByLabelText("Basic Cleaned Text")).toHaveProperty("value", "No mass.");
  fireEvent.click(screen.getByRole("button", { name: "Clear Text" }));
  expect(screen.getByLabelText("Basic Cleaned Text")).toHaveProperty("value", "");
  expect(screen.getByRole("button", { name: "Copy Cleaned Text" })).toHaveProperty("disabled", true);
});
