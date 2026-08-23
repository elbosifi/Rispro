import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pushToast } from "@/lib/toast";
import { ToastViewport } from "./toast-viewport";

vi.mock("@/providers/language-provider", () => ({ useLanguage: () => ({ language: "en" }) }));

describe("ToastViewport", () => {
  afterEach(() => {
    act(() => vi.runAllTimers());
    vi.useRealTimers();
  });

  it("keeps ordinary toasts in the corner and renders explicit center toasts in the centered path", () => {
    vi.useFakeTimers();
    render(<ToastViewport />);

    act(() => {
      pushToast({ type: "info", title: "Corner toast" });
      pushToast({ type: "error", title: "Center toast", placement: "center" });
    });

    expect(screen.getByText("Corner toast").closest("[data-toast-placement]")?.getAttribute("data-toast-placement")).toBe("corner");
    expect(screen.getByText("Center toast").closest("[data-toast-placement]")?.getAttribute("data-toast-placement")).toBe("center");
    expect(screen.getByRole("alert").textContent).toContain("Center toast");
  });
});
