import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComplementaryRecallRequestDialog } from "./complementary-recall-request-dialog";

afterEach(() => {
  document.body.removeAttribute("style");
  document.documentElement.removeAttribute("style");
  vi.restoreAllMocks();
});

describe("ComplementaryRecallRequestDialog", () => {
  const renderDialog = (node: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>);
  it("requires reason, QA classification, and technologist instruction, then emits the canonical payload", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderDialog(<ComplementaryRecallRequestDialog open onClose={vi.fn()} examLabel="CT Chest" submitting={false} onSubmit={onSubmit} />);

    const submit = screen.getByRole("button", { name: "Request additional imaging" });
    expect(submit.hasAttribute("disabled")).toBe(true);
    await user.selectOptions(screen.getByLabelText("Recall reason"), "missing_sequence_phase");
    expect(submit.hasAttribute("disabled")).toBe(true);
    await user.selectOptions(screen.getByLabelText("QA classification"), "acquisition_error");
    expect(submit.hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("Due date/time"), { target: { value: "2026-09-01T10:00" } });
    await user.type(screen.getByRole("textbox", { name: "What additional imaging is needed?" }), "Repeat the delayed phase");
    await user.click(screen.getByRole("button", { name: /^Add to this report/ }));
    expect(submit.hasAttribute("disabled")).toBe(false);

    await user.click(submit);

    expect(onSubmit).toHaveBeenCalledWith({
      reasonCode: "missing_sequence_phase",
      qaClassification: "acquisition_error",
      urgency: "routine",
      dueAt: "2026-09-01T08:00:00.000Z",
      reportingDisposition: "supplement_original_report",
      requestedModalityId: null,
      requestedExamTypeId: null,
      originalReportDependency: "imaging_completed",
      notifyOnArrival: false,
      notifyOnImagingCompleted: false,
      receptionInstruction: null,
      technologistInstruction: "Repeat the delayed phase",
    });
  });

  it("resets form values for a fresh request when the target appointment changes", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    function Harness() {
      const [examLabel, setExamLabel] = useState("Appointment A");
      return <>
        <button type="button" onClick={() => setExamLabel("Appointment B")}>Next appointment</button>
        <ComplementaryRecallRequestDialog open onClose={vi.fn()} examLabel={examLabel} submitting={false} onSubmit={onSubmit} />
      </>;
    }
    renderDialog(<Harness />);
    await user.selectOptions(screen.getByLabelText("Recall reason"), "other");
    await user.selectOptions(screen.getByLabelText("QA classification"), "other");
    await user.type(screen.getByRole("textbox", { name: "What additional imaging is needed?" }), "Appointment A instruction");
    await user.click(screen.getByRole("button", { name: "Next appointment" }));
    expect((screen.getByLabelText("Recall reason") as HTMLSelectElement).value).toBe("");
    expect((screen.getByRole("textbox", { name: "What additional imaging is needed?" }) as HTMLTextAreaElement).value).toBe("");
  });

  it("requires a new dependency choice when changing from supplement to separate report", async () => {
    const user = userEvent.setup();
    renderDialog(<ComplementaryRecallRequestDialog open onClose={vi.fn()} examLabel="CT Chest" submitting={false} onSubmit={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /^Add to this report/ }));
    await user.click(screen.getByRole("button", { name: /^Create a separate report/ }));
    expect(screen.getByText("Choose what should happen to the current report before requesting a separate report.")).toBeTruthy();
    expect((screen.getByLabelText("Requested modality") as HTMLSelectElement).value).toBe("");
    expect(screen.getByText("Wait for the additional images")).toBeTruthy();
  });
});
