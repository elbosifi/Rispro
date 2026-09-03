import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComplementaryRecallRequestDialog } from "./complementary-recall-request-dialog";

afterEach(() => {
  document.body.removeAttribute("style");
  document.documentElement.removeAttribute("style");
  vi.restoreAllMocks();
});

describe("ComplementaryRecallRequestDialog", () => {
  it("requires reason, QA classification, and technologist instruction, then emits the canonical payload", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<ComplementaryRecallRequestDialog open onClose={vi.fn()} examLabel="CT Chest" submitting={false} onSubmit={onSubmit} />);

    const submit = screen.getByRole("button", { name: "Request additional imaging" });
    expect(submit.hasAttribute("disabled")).toBe(true);
    await user.selectOptions(screen.getByLabelText("Recall reason"), "missing_sequence_phase");
    expect(submit.hasAttribute("disabled")).toBe(true);
    await user.selectOptions(screen.getByLabelText("QA classification"), "acquisition_error");
    expect(submit.hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("Due date/time"), { target: { value: "2026-09-01T10:00" } });
    await user.type(screen.getByRole("textbox", { name: "Technologist instruction" }), "Repeat the delayed phase");
    expect(submit.hasAttribute("disabled")).toBe(false);

    await user.click(submit);

    expect(onSubmit).toHaveBeenCalledWith({
      reasonCode: "missing_sequence_phase",
      qaClassification: "acquisition_error",
      urgency: "routine",
      dueAt: "2026-09-01T08:00:00.000Z",
      reportingDisposition: "supplement_original_report",
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
    render(<Harness />);
    await user.selectOptions(screen.getByLabelText("Recall reason"), "other");
    await user.selectOptions(screen.getByLabelText("QA classification"), "other");
    await user.type(screen.getByRole("textbox", { name: "Technologist instruction" }), "Appointment A instruction");
    await user.click(screen.getByRole("button", { name: "Next appointment" }));
    expect((screen.getByLabelText("Recall reason") as HTMLSelectElement).value).toBe("");
    expect((screen.getByRole("textbox", { name: "Technologist instruction" }) as HTMLTextAreaElement).value).toBe("");
  });
});
