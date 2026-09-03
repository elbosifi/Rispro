import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SupervisorReAuthModal } from "./supervisor-reauth-modal";

const authState = vi.hoisted(() => ({
  reAuth: vi.fn(),
  reAuthWithPasskey: vi.fn(),
}));

vi.mock("@/providers/auth-provider", () => ({
  useAuth: () => authState,
}));

vi.mock("@/providers/language-provider", () => ({
  useLanguage: () => ({ language: "en" }),
}));

describe("SupervisorReAuthModal", () => {
  beforeEach(() => {
    authState.reAuth.mockReset();
    authState.reAuthWithPasskey.mockReset();
    authState.reAuth.mockResolvedValue(undefined);
    authState.reAuthWithPasskey.mockResolvedValue(undefined);
  });

  it("offers passkey re-authentication by default", async () => {
    const onSuccess = vi.fn();
    render(<SupervisorReAuthModal onClose={vi.fn()} onSuccess={onSuccess} />);

    expect(screen.getByRole("button", { name: "Use Passkey" })).toBeTruthy();
  });

  it("supports passkey re-authentication without changing the normal password fallback", async () => {
    const onSuccess = vi.fn();
    render(<SupervisorReAuthModal onClose={vi.fn()} onSuccess={onSuccess} />);

    await userEvent.click(screen.getByRole("button", { name: "Use Passkey" }));

    await waitFor(() => expect(authState.reAuthWithPasskey).toHaveBeenCalledOnce());
    expect(authState.reAuth).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it("allows callers to opt out of passkey re-authentication", () => {
    render(<SupervisorReAuthModal allowPasskey={false} onClose={vi.fn()} onSuccess={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Use Passkey" })).toBeNull();
  });

  it("shows a failed passkey re-authentication in the existing error area and does not resume approval", async () => {
    const onSuccess = vi.fn();
    authState.reAuthWithPasskey.mockRejectedValue(new Error("Passkey verification failed."));
    render(<SupervisorReAuthModal onClose={vi.fn()} onSuccess={onSuccess} />);

    await userEvent.click(screen.getByRole("button", { name: "Use Passkey" }));

    expect(await screen.findByText("Passkey verification failed.")).toBeTruthy();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("keeps password re-authentication available as the fallback", async () => {
    const onSuccess = vi.fn();
    render(<SupervisorReAuthModal onClose={vi.fn()} onSuccess={onSuccess} />);

    expect(screen.getByRole("button", { name: "Use Passkey" })).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Supervisor password…"), { target: { value: "secret" } });
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));

    await waitFor(() => expect(authState.reAuth).toHaveBeenCalledWith("secret"));
    expect(onSuccess).toHaveBeenCalledOnce();
  });
});
