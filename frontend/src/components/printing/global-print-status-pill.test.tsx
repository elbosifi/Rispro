import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GlobalPrintStatusPill } from "./global-print-status-pill";
import { PRINT_STATUS_SUCCESS_DISMISS_MS, resetGlobalPrintStatusForTests, setGlobalPrintStatus } from "@/services/printing/global-print-status";

describe("GlobalPrintStatusPill", () => {
  afterEach(() => { act(() => resetGlobalPrintStatusForTests()); vi.useRealTimers(); });

  it("is hidden while idle", () => {
    render(<GlobalPrintStatusPill />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it.each([
    ["preparing", "Preparing print…"],
    ["submitting", "Sending to printer…"],
    ["submitted", "Sent to printer"],
    ["failed", "Print failed"],
    ["status_unknown", "Print still processing — do not retry"],
  ] as const)("shows %s status", (state, text) => {
    render(<GlobalPrintStatusPill />);
    act(() => setGlobalPrintStatus({ state }));
    expect(screen.getByRole("status").textContent).toContain(text);
    if (state === "submitting") expect(screen.getByTestId("submitting-printer-icon")).toBeTruthy();
  });

  it("dismisses submitted status after the configured delay", () => {
    vi.useFakeTimers();
    render(<GlobalPrintStatusPill />);
    act(() => setGlobalPrintStatus({ state: "submitted" }));
    expect(screen.getByRole("status").textContent).toContain("Sent to printer");
    act(() => { vi.advanceTimersByTime(PRINT_STATUS_SUCCESS_DISMISS_MS); });
    expect(screen.queryByRole("status")).toBeNull();
  });
});
