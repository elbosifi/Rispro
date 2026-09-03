import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SupervisorOverrideModal } from "./SupervisorOverrideModal";

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

describe("SupervisorOverrideModal", () => {
  beforeEach(() => {
    authState.reAuth.mockReset();
    authState.reAuthWithPasskey.mockReset();
    authState.reAuth.mockResolvedValue(undefined);
    authState.reAuthWithPasskey.mockResolvedValue(undefined);
  });

  it("uses same-user passkey re-authentication for current-user overrides without credential fields", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <SupervisorOverrideModal
        open
        mode="current_user"
        onClose={vi.fn()}
        onConfirm={onConfirm}
        loading={false}
        overrideTypes={["category_override"]}
      />
    );

    expect(screen.getByText("Category capacity override")).toBeTruthy();
    expect(screen.queryByPlaceholderText("Supervisor Username")).toBeNull();
    expect(screen.queryByPlaceholderText("Password")).toBeNull();
    fireEvent.change(screen.getByPlaceholderText("Override Reason"), { target: { value: "Urgent clinical need" } });
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await userEvent.click(screen.getByRole("button", { name: "Use Passkey" }));

    await waitFor(() => expect(authState.reAuthWithPasskey).toHaveBeenCalledOnce());
    expect(authState.reAuth).not.toHaveBeenCalled();
    expect(onConfirm).toHaveBeenCalledWith({
      authorizationMode: "current_user_reauth",
      overrideReason: "Urgent clinical need",
    });
  });

  it("keeps password re-authentication available for current-user overrides", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<SupervisorOverrideModal open mode="current_user" onClose={vi.fn()} onConfirm={onConfirm} loading={false} />);

    fireEvent.change(screen.getByPlaceholderText("Override Reason"), { target: { value: "Password fallback" } });
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(screen.getByPlaceholderText("Supervisor password…"), { target: { value: "secret" } });
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));

    await waitFor(() => expect(authState.reAuth).toHaveBeenCalledWith("secret"));
    expect(authState.reAuthWithPasskey).not.toHaveBeenCalled();
    expect(onConfirm).toHaveBeenCalledWith({
      authorizationMode: "current_user_reauth",
      overrideReason: "Password fallback",
    });
  });

  it("does not resume the override when re-authentication fails", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    authState.reAuthWithPasskey.mockRejectedValue(new Error("Passkey failed"));
    render(<SupervisorOverrideModal open mode="current_user" onClose={vi.fn()} onConfirm={onConfirm} loading={false} />);

    fireEvent.change(screen.getByPlaceholderText("Override Reason"), { target: { value: "Should not book" } });
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await userEvent.click(screen.getByRole("button", { name: "Use Passkey" }));

    expect(await screen.findByText("Passkey failed")).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("preserves the delegated supervisor credential payload", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<SupervisorOverrideModal open onClose={vi.fn()} onConfirm={onConfirm} loading={false} />);

    fireEvent.change(screen.getByPlaceholderText("Supervisor Username"), { target: { value: "supervisor" } });
    fireEvent.change(screen.getByPlaceholderText("Password"), { target: { value: "secret" } });
    fireEvent.change(screen.getByPlaceholderText("Override Reason"), { target: { value: "Delegated approval" } });
    await userEvent.click(screen.getByRole("button", { name: "Approve & Book" }));

    expect(onConfirm).toHaveBeenCalledWith({
      authorizationMode: "supervisor_credentials",
      supervisorUsername: "supervisor",
      supervisorPassword: "secret",
      overrideReason: "Delegated approval",
    });
  });
});
