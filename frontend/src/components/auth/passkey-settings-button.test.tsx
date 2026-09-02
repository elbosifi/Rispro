import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PasskeySettingsButton } from "./passkey-settings-button";

const testState = vi.hoisted(() => ({
  getOptions: vi.fn(),
  startRegistration: vi.fn(),
  verifyRegistration: vi.fn(),
}));

vi.mock("@/lib/api-hooks", () => ({
  getPasskeyRegistrationOptions: testState.getOptions,
  verifyPasskeyRegistration: testState.verifyRegistration,
}));

vi.mock("@simplewebauthn/browser", () => ({
  startRegistration: testState.startRegistration,
}));

function setSupport(supported: boolean) {
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  if (supported) Object.defineProperty(window, "PublicKeyCredential", { configurable: true, value: function PublicKeyCredential() {} });
  else Reflect.deleteProperty(window, "PublicKeyCredential");
}

describe("PasskeySettingsButton", () => {
  beforeEach(() => {
    testState.getOptions.mockResolvedValue({ challenge: "challenge" });
    testState.startRegistration.mockResolvedValue({ id: "credential" });
    testState.verifyRegistration.mockResolvedValue({ verified: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
    Reflect.deleteProperty(window, "PublicKeyCredential");
  });

  it("explains unsupported passkeys and does not call registration APIs", async () => {
    setSupport(false);
    render(<PasskeySettingsButton />);

    const button = screen.getByRole("button", { name: /add passkey to this device/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Passkeys are not supported on this device/browser.")).toBeTruthy();
    fireEvent.click(button);

    await waitFor(() => expect(testState.getOptions).not.toHaveBeenCalled());
    expect(testState.startRegistration).not.toHaveBeenCalled();
    expect(testState.verifyRegistration).not.toHaveBeenCalled();
  });

  it("keeps the supported registration path and shows success", async () => {
    setSupport(true);
    render(<PasskeySettingsButton />);

    fireEvent.click(screen.getByRole("button", { name: /add passkey to this device/i }));

    await waitFor(() => expect(testState.getOptions).toHaveBeenCalledOnce());
    expect(testState.startRegistration).toHaveBeenCalledOnce();
    expect(testState.verifyRegistration).toHaveBeenCalledWith({ id: "credential" });
    expect(await screen.findByText("Passkey added successfully.")).toBeTruthy();
  });
});
