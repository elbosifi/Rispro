import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActionPinSettingsButton } from "./action-pin-settings-button";

vi.mock("@/providers/language-provider", () => ({
  useLanguage: () => ({ language: "en", isArabic: false }),
}));
vi.mock("@/lib/api-hooks", () => ({
  fetchActionPinStatus: vi.fn(() => new Promise(() => {})),
  setOwnActionPin: vi.fn(),
  disableOwnActionPin: vi.fn(),
}));

describe("ActionPinSettingsButton variants", () => {
  it("renders a labeled drawer action and opens the existing modal", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><ActionPinSettingsButton variant="drawer" /></QueryClientProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Manage Security PIN" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Set Security Action PIN")).toBeTruthy();
  });
});
