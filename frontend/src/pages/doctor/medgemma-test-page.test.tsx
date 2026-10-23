import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { EnglishLanguageScope } from "@/providers/language-provider-component";
import * as api from "@/lib/medgemma-api";
import { useAuth } from "@/providers/auth-provider";
import { clearMedGemmaTestText, setMedGemmaTestText, getMedGemmaTestText } from "@/lib/medgemma-test-transfer";
import { MedGemmaTestPage } from "./medgemma-test-page";

vi.mock("@/lib/medgemma-api", async (importOriginal) => ({
  ...await importOriginal<typeof api>(),
  getMedGemmaSettings: vi.fn(), saveMedGemmaSettings: vi.fn(), testMedGemmaConnection: vi.fn(), getMedGemmaHealth: vi.fn(), generateMedGemmaText: vi.fn(),
}));
vi.mock("@/providers/auth-provider");
beforeEach(() => {
  vi.resetAllMocks();
  clearMedGemmaTestText();
  vi.mocked(useAuth).mockReturnValue({ user: { role: "doctor" } } as ReturnType<typeof useAuth>);
  vi.mocked(api.getMedGemmaHealth).mockResolvedValue({ status: "connected", model: "google/medgemma" });
  vi.mocked(api.generateMedGemmaText).mockResolvedValue({ text: "No left frontal lesion.", processing_seconds: 2.5 });
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
});
function mount() { render(<EnglishLanguageScope><MedGemmaTestPage /></EnglishLanguageScope>); }

it("keeps original input and submitted snapshot, allows explicit editing, copy and clear", async () => {
  mount(); await screen.findByText("Model: google/medgemma");
  const original = "No uh left frontal lesion period";
  fireEvent.change(screen.getByLabelText("Original Text Input"), { target: { value: original } });
  fireEvent.click(screen.getByRole("button", { name: "Process Text" }));
  await waitFor(() => expect(screen.getByLabelText("MedGemma Result")).toHaveProperty("value", "No left frontal lesion."));
  expect(api.generateMedGemmaText).toHaveBeenCalledWith("cleanup_dictation", original, undefined);
  expect(screen.getByLabelText("Original Text Input")).toHaveProperty("value", original);
  expect(screen.getByLabelText("Original Text")).toHaveProperty("value", original);
  fireEvent.change(screen.getByLabelText("Original Text Input"), { target: { value: "Next input" } });
  expect(screen.getByLabelText("Original Text")).toHaveProperty("value", original);
  expect(screen.getByLabelText("MedGemma Result")).toHaveProperty("readOnly", true);
  fireEvent.click(screen.getByRole("button", { name: "Edit Result" }));
  expect(screen.getByLabelText("MedGemma Result")).toHaveProperty("readOnly", false);
  fireEvent.change(screen.getByLabelText("MedGemma Result"), { target: { value: "Reviewed output" } });
  fireEvent.click(screen.getByRole("button", { name: "Copy Result" }));
  await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Reviewed output"));
  expect(screen.getByText("Processing time: 2.5 seconds")).toBeTruthy();
  expect(screen.getByText(/Generated output may contain clinical errors/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Reset" }));
  for (const label of ["Original Text Input", "Original Text", "MedGemma Result"]) expect(screen.getByLabelText(label)).toHaveProperty("value", "");
});
it.each([
  ["cleanup_dictation", "MedGemma request timed out or was cancelled."],
  ["correct_terminology", "MedGemma returned an unsuccessful response."],
  ["format_radiology_report", "MedGemma server is unreachable."],
  ["review_radiology_report", "MedGemma returned an invalid generation response."],
] as const)("displays %s failures, clears stale output and preserves the exact submitted text", async (task, message) => {
  mount(); await screen.findByText("Model: google/medgemma");
  fireEvent.change(screen.getByLabelText("Original Text Input"), { target: { value: "Previous input" } });
  fireEvent.click(screen.getByRole("button", { name: "Process Text" }));
  await waitFor(() => expect(screen.getByLabelText("MedGemma Result")).toHaveProperty("value", "No left frontal lesion."));
  vi.mocked(api.generateMedGemmaText).mockRejectedValueOnce(new Error(message));
  const original = "  No left-sided lesion.\nMeasurement: 1.2 cm; possible artifact.  ";
  fireEvent.change(screen.getByLabelText("Processing Task"), { target: { value: task } });
  fireEvent.change(screen.getByLabelText("Original Text Input"), { target: { value: original } });
  fireEvent.click(screen.getByRole("button", { name: "Process Text" }));
  expect(await screen.findByText(message)).toBeTruthy();
  expect(screen.getByLabelText("Original Text Input")).toHaveProperty("value", original);
  expect(screen.getByLabelText("Original Text")).toHaveProperty("value", original);
  expect(screen.getByLabelText(task === "review_radiology_report" ? "Potential Issues" : "MedGemma Result")).toHaveProperty("value", "");
  expect(screen.getByRole("button", { name: "Copy Result" })).toHaveProperty("disabled", true);
  fireEvent.change(screen.getByLabelText("Original Text Input"), { target: { value: "Next input" } });
  expect(screen.getByLabelText("Original Text")).toHaveProperty("value", original);
});
it("disables generation when MedGemma is disabled but still allows manual input", async () => {
  vi.mocked(api.getMedGemmaHealth).mockResolvedValue({ status: "disabled" });
  mount(); await screen.findByText("Connection Status: Disabled");
  fireEvent.change(screen.getByLabelText("Original Text Input"), { target: { value: "Manual text" } });
  expect(screen.getByLabelText("Original Text Input")).toHaveProperty("disabled", false);
  expect(screen.getByRole("button", { name: "Process Text" })).toHaveProperty("disabled", true);
});
it("selects each task and separates QA issues from the preserved original report", async () => {
  mount(); await screen.findByText("Model: google/medgemma");
  expect(screen.queryByLabelText(/Per-test Instructions/)).toBeNull();
  fireEvent.change(screen.getByLabelText("Original Text Input"), { target: { value: "Left lesion. Right lesion absent." } });
  for (const task of api.MEDGEMMA_TASKS) {
    fireEvent.change(screen.getByLabelText("Processing Task"), { target: { value: task } });
    fireEvent.click(screen.getByRole("button", { name: "Process Text" }));
    await waitFor(() => expect(api.generateMedGemmaText).toHaveBeenLastCalledWith(task, "Left lesion. Right lesion absent.", undefined));
    await waitFor(() => expect(screen.getByRole("button", { name: "Process Text" })).toHaveProperty("disabled", false));
    expect(screen.getByLabelText("Original Text")).toHaveProperty("value", "Left lesion. Right lesion absent.");
  }
  expect(screen.getByLabelText("Potential Issues")).toHaveProperty("value", "No left frontal lesion.");
  expect(screen.getByText(/not automatic clinical validation/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Reset" }));
  expect(screen.getByLabelText("Processing Task")).toHaveProperty("value", "cleanup_dictation");
  expect(screen.queryByLabelText("Potential Issues")).toBeNull();
});
it("uses an optional administrator override for this test without saving settings", async () => {
  vi.mocked(useAuth).mockReturnValue({ user: { role: "super_admin" } } as ReturnType<typeof useAuth>);
  mount(); await screen.findByText("Model: google/medgemma");
  fireEvent.change(screen.getByLabelText("Original Text Input"), { target: { value: "Original" } });
  fireEvent.change(screen.getByLabelText(/Per-test Instructions/), { target: { value: "Test instructions" } });
  fireEvent.click(screen.getByRole("button", { name: "Process Text" }));
  await waitFor(() => expect(api.generateMedGemmaText).toHaveBeenCalledWith("cleanup_dictation", "Original", "Test instructions"));
  expect(api.saveMedGemmaSettings).not.toHaveBeenCalled();
});
it("consumes transferred text in memory, selects Cleanup and waits for a Process click even if unavailable", async () => {
  setMedGemmaTestText("Transferred MedASR text");
  vi.mocked(api.getMedGemmaHealth).mockResolvedValue({ status: "disabled" });
  mount(); await screen.findByText("Connection Status: Disabled");
  expect(screen.getByLabelText("Original Text Input")).toHaveProperty("value", "Transferred MedASR text");
  expect(screen.getByLabelText("Processing Task")).toHaveProperty("value", "cleanup_dictation");
  expect(api.generateMedGemmaText).not.toHaveBeenCalled(); expect(getMedGemmaTestText()).toBeNull();
});

it.each(["disabled", "unavailable", "not_configured"] as const)("performs basic cleanup with MedGemma %s, without generation or input changes", async (status) => {
  vi.mocked(api.getMedGemmaHealth).mockResolvedValue({ status });
  const original = "Um no right lesion period no left edema period";
  setMedGemmaTestText(original);
  mount();
  await waitFor(() => expect(api.getMedGemmaHealth).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: "Basic Cleanup (Instant)" }));
  expect(screen.getByLabelText("Basic Cleaned Text")).toHaveProperty("value", "No right lesion. No left edema.");
  expect(screen.queryByLabelText("MedGemma Result")).toBeNull();
  expect(screen.getByLabelText("Original Text Input")).toHaveProperty("value", original);
  expect(screen.getByLabelText("Original Text")).toHaveProperty("value", original);
  expect(api.generateMedGemmaText).not.toHaveBeenCalled();
  expect(getMedGemmaTestText()).toBeNull();
  expect(screen.queryByText(/Processing time:/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Copy Result" }));
  await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("No right lesion. No left edema."));
  fireEvent.change(screen.getByLabelText("Original Text Input"), { target: { value: "Next input" } });
  expect(screen.getByLabelText("Original Text")).toHaveProperty("value", original);
  fireEvent.click(screen.getByRole("button", { name: "Edit Result" }));
  expect(screen.getByLabelText("Basic Cleaned Text")).toHaveProperty("readOnly", false);
  fireEvent.click(screen.getByRole("button", { name: "Reset" }));
  expect(screen.queryByLabelText("Basic Cleaned Text")).toBeNull();
  expect(screen.getByLabelText("MedGemma Result")).toHaveProperty("value", "");
  expect(screen.getByRole("button", { name: "Basic Cleanup (Instant)" })).toHaveProperty("disabled", true);
});

it("keeps optional AI processing available and labels results by their actual source", async () => {
  mount(); await screen.findByText("Model: google/medgemma");
  const original = "Um no right lesion period";
  fireEvent.change(screen.getByLabelText("Original Text Input"), { target: { value: original } });
  fireEvent.click(screen.getByRole("button", { name: "Basic Cleanup (Instant)" }));
  fireEvent.change(screen.getByLabelText("Processing Task"), { target: { value: "review_radiology_report" } });
  expect(screen.queryByRole("button", { name: "Basic Cleanup (Instant)" })).toBeNull();
  expect(screen.getByLabelText("Basic Cleaned Text")).toHaveProperty("value", "No right lesion.");
  fireEvent.click(screen.getByRole("button", { name: "Process Text" }));
  await waitFor(() => expect(screen.getByLabelText("Potential Issues")).toHaveProperty("value", "No left frontal lesion."));
  expect(api.generateMedGemmaText).toHaveBeenCalledWith("review_radiology_report", original, undefined);
  expect(screen.queryByLabelText("Basic Cleaned Text")).toBeNull();
  fireEvent.change(screen.getByLabelText("Processing Task"), { target: { value: "cleanup_dictation" } });
  fireEvent.click(screen.getByRole("button", { name: "Basic Cleanup (Instant)" }));
  expect(screen.getByLabelText("Basic Cleaned Text")).toHaveProperty("value", "No right lesion.");
  expect(screen.queryByLabelText("Potential Issues")).toBeNull();
  expect(screen.queryByText(/Processing time:/)).toBeNull();
});
