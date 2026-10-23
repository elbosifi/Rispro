import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { EnglishLanguageScope } from "@/providers/language-provider-component";
import * as api from "@/lib/medgemma-api";
import { MedGemmaTestPage } from "./medgemma-test-page";

vi.mock("@/lib/medgemma-api");
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.getMedGemmaHealth).mockResolvedValue({ status: "connected", model: "google/medgemma" });
  vi.mocked(api.cleanupMedGemmaDictation).mockResolvedValue({ text: "No left frontal lesion.", processing_seconds: 2.5 });
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
});
function mount() { render(<EnglishLanguageScope><MedGemmaTestPage /></EnglishLanguageScope>); }

it("keeps original input and submitted snapshot, allows explicit editing, copy and clear", async () => {
  mount(); await screen.findByText("Model: google/medgemma");
  const original = "No uh left frontal lesion period";
  fireEvent.change(screen.getByLabelText("Original Dictation"), { target: { value: original } });
  fireEvent.click(screen.getByRole("button", { name: "Clean Dictation with MedGemma" }));
  await waitFor(() => expect(screen.getByLabelText("MedGemma Cleaned Text")).toHaveProperty("value", "No left frontal lesion."));
  expect(api.cleanupMedGemmaDictation).toHaveBeenCalledWith(original);
  expect(screen.getByLabelText("Original Dictation")).toHaveProperty("value", original);
  expect(screen.getByLabelText("Original Text")).toHaveProperty("value", original);
  fireEvent.change(screen.getByLabelText("Original Dictation"), { target: { value: "Next input" } });
  expect(screen.getByLabelText("Original Text")).toHaveProperty("value", original);
  expect(screen.getByLabelText("MedGemma Cleaned Text")).toHaveProperty("readOnly", true);
  fireEvent.click(screen.getByRole("button", { name: "Edit Cleaned Text" }));
  expect(screen.getByLabelText("MedGemma Cleaned Text")).toHaveProperty("readOnly", false);
  fireEvent.change(screen.getByLabelText("MedGemma Cleaned Text"), { target: { value: "Reviewed output" } });
  fireEvent.click(screen.getByRole("button", { name: "Copy Cleaned Text" }));
  await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Reviewed output"));
  expect(screen.getByText("Processing time: 2.5 seconds")).toBeTruthy();
  expect(screen.getByText(/Generated output may contain clinical errors/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Clear" }));
  for (const label of ["Original Dictation", "Original Text", "MedGemma Cleaned Text"]) expect(screen.getByLabelText(label)).toHaveProperty("value", "");
});
it("preserves original text after failure and clears any old output before a new request", async () => {
  vi.mocked(api.cleanupMedGemmaDictation).mockRejectedValue(new Error("MedGemma request timed out."));
  mount(); await screen.findByText("Model: google/medgemma");
  fireEvent.change(screen.getByLabelText("Original Dictation"), { target: { value: "Keep original" } });
  fireEvent.click(screen.getByRole("button", { name: "Clean Dictation with MedGemma" }));
  expect(await screen.findByText("MedGemma request timed out.")).toBeTruthy();
  expect(screen.getByLabelText("Original Dictation")).toHaveProperty("value", "Keep original");
  expect(screen.getByLabelText("Original Text")).toHaveProperty("value", "Keep original");
  expect(screen.getByLabelText("MedGemma Cleaned Text")).toHaveProperty("value", "");
});
it("disables generation when MedGemma is disabled but still allows manual input", async () => {
  vi.mocked(api.getMedGemmaHealth).mockResolvedValue({ status: "disabled" });
  mount(); await screen.findByText("Connection Status: Disabled");
  fireEvent.change(screen.getByLabelText("Original Dictation"), { target: { value: "Manual text" } });
  expect(screen.getByLabelText("Original Dictation")).toHaveProperty("disabled", false);
  expect(screen.getByRole("button", { name: "Clean Dictation with MedGemma" })).toHaveProperty("disabled", true);
});
