import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrowserRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { ActionPinSettingsButton } from "@/components/auth/action-pin-settings-button";
import { createPatient, addWalkIn } from "@/lib/api-hooks";
import { api, setActionPinChallengeHandler } from "@/lib/api-client";
import { ActionPinIdleLock, ActionPinProvider } from "@/providers/action-pin-provider";
import { AuthProvider } from "@/providers/auth-provider-component";
import { LanguageProvider } from "@/providers/language-provider-component";
import { createV2Booking } from "@/v2/appointments/api";
import type { Patient } from "@/types/api";
import type { CreateBookingRequest } from "@/v2/appointments/types";

const ACTION_PIN_BOOKING_REQUEST: CreateBookingRequest = {
  patientId: 1,
  modalityId: 1,
  examTypeId: null,
  reportingPriorityId: null,
  bookingDate: "2026-07-14",
  bookingTime: null,
  caseCategory: "non_oncology",
  notes: null,
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function TestMutationButton() {
  const [result, setResult] = useState("");
  return (
    <>
      <button
        type="button"
        onClick={() => {
          void api<{ ok: true }>("/patients", {
            method: "POST",
            body: JSON.stringify({ name: "Ada" })
          })
            .then(() => setResult("ok"))
            .catch((error) => setResult(error instanceof Error ? error.message : "failed"));
        }}
      >
        Create patient
      </button>
      <div>{result}</div>
    </>
  );
}

function TestRealApiButton({
  label,
  run
}: {
  label: string;
  run: () => Promise<unknown>;
}) {
  const [result, setResult] = useState("");
  return (
    <>
      <button
        type="button"
        onClick={() => {
          void run()
            .then(() => setResult("ok"))
            .catch((error) => setResult(error instanceof Error ? error.message : "failed"));
        }}
      >
        {label}
      </button>
      <div>{result}</div>
    </>
  );
}

function renderWithActionPin(ui: React.ReactNode) {
  return render(
    <LanguageProvider>
      <ActionPinProvider>{ui}</ActionPinProvider>
    </LanguageProvider>
  );
}

function renderWithQuery(ui: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  return render(
    <LanguageProvider>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </LanguageProvider>
  );
}

function renderIdleLock() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  return render(
    <LanguageProvider>
      <BrowserRouter>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <ActionPinIdleLock>
              <div>Patient screen content</div>
            </ActionPinIdleLock>
          </AuthProvider>
        </QueryClientProvider>
      </BrowserRouter>
    </LanguageProvider>
  );
}

function mockIdleFetch({
  policyEnabled,
  idleLockEnabled,
  idleLockEligible = true,
  idleLockActive = false,
  hasPin = true,
  verifyOk = true,
}: {
  policyEnabled: boolean;
  idleLockEnabled: boolean;
  idleLockEligible?: boolean;
  idleLockActive?: boolean;
  hasPin?: boolean;
  verifyOk?: boolean;
}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === "/api/auth/me") {
      return jsonResponse(200, { user: { id: 7, username: "front", fullName: "Front Desk", role: "receptionist", isActive: true } });
    }
    if (url === "/api/action-pin/status") {
      return jsonResponse(200, {
        hasPin,
        lockedUntil: null,
        idleLockEligible,
        idleLockActive,
        idleLockedAt: idleLockActive ? "2026-06-30T10:00:00.000Z" : null,
        pinExpiresAt: null,
        isExpired: false,
        policy: {
          enabled: policyEnabled,
          pinLength: 4,
          idleLockEnabled,
          idleLockSeconds: 0.1,
          verificationTtlSeconds: 300,
          allowUserPinChange: true,
          requirePinToViewOwnPinSettings: false,
        },
      });
    }
    if (url === "/api/action-pin/idle-lock") {
      return idleLockEligible ? jsonResponse(200, { active: true, lockedAt: "2026-06-30T10:00:00.000Z" }) : jsonResponse(200, { active: false, lockedAt: null });
    }
    if (url === "/api/action-pin/verify") {
      return verifyOk ? jsonResponse(200, { ok: true }) : jsonResponse(403, { error: "invalid_action_pin" });
    }
    if (url === "/api/auth/logout") {
      return jsonResponse(200, { ok: true });
    }
    if (url === "/api/patients") {
      return jsonResponse(200, { ok: true });
    }
    return jsonResponse(404, { message: `Unexpected URL ${url}`, method: (init as RequestInit | undefined)?.method });
  });
}

async function flushIdleQueries() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("ActionPinProvider", () => {
  beforeEach(() => {
    localStorage.setItem("rispro-language", "en");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    setActionPinChallengeHandler(null);
    localStorage.clear();
  });

  it("opens the PIN dialog after action_pin_required", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse(403, { error: "action_pin_required", actionKey: "patient_create", requiresReason: false })
    );

    renderWithActionPin(<TestMutationButton />);
    await userEvent.click(screen.getByRole("button", { name: "Create patient" }));

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByLabelText("Security Action PIN")).toBeTruthy();
  });

  it("verifies the PIN then retries the original mutation without sending the raw PIN", async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(403, { error: "action_pin_required", actionKey: "patient_create", requiresReason: false }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    renderWithActionPin(<TestMutationButton />);
    await userEvent.click(screen.getByRole("button", { name: "Create patient" }));
    await userEvent.type(await screen.findByLabelText("Security Action PIN"), "1234");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));

    await screen.findByText("ok");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/action-pin/verify");
    expect(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body)).toContain("1234");

    const retriedMutation = fetchMock.mock.calls[2]?.[1] as RequestInit;
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/patients");
    expect(String(retriedMutation.body)).toBe(JSON.stringify({ name: "Ada" }));
    expect(String(retriedMutation.body)).not.toContain("1234");
    expect(JSON.stringify(retriedMutation.headers ?? {})).not.toContain("1234");
    expect(String(fetchMock.mock.calls[2]?.[0])).not.toContain("1234");
    expect(setItemSpy.mock.calls.every((call) => !JSON.stringify(call).includes("1234"))).toBe(true);
    expect(JSON.stringify(sessionStorage)).not.toContain("1234");
  });

  it("requires a reason when the challenge requires one", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(403, { error: "action_pin_required", actionKey: "patient_update", requiresReason: true }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    renderWithActionPin(<TestMutationButton />);
    await userEvent.click(screen.getByRole("button", { name: "Create patient" }));
    await userEvent.type(await screen.findByLabelText("Security Action PIN"), "1234");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));

    expect(await screen.findByText("Reason is required.")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await userEvent.type(screen.getByLabelText("Action reason"), "Confirming demographics change");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));

    await screen.findByText("ok");
    expect(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body)).toContain("Confirming demographics change");
  });

  it("does not retry the mutation when PIN verification fails", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(403, { error: "action_pin_required", actionKey: "patient_create", requiresReason: false }))
      .mockResolvedValueOnce(jsonResponse(403, { error: "invalid_action_pin" }));

    renderWithActionPin(<TestMutationButton />);
    await userEvent.click(screen.getByRole("button", { name: "Create patient" }));
    await userEvent.type(await screen.findByLabelText("Security Action PIN"), "9999");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));

    expect(await screen.findByText("invalid_action_pin")).toBeTruthy();
    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([url]) => url === "/api/patients")).toHaveLength(1);
    });
  });

  it("does not loop if the retried mutation still returns action_pin_required", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(403, { error: "action_pin_required", actionKey: "patient_create", requiresReason: false }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
      .mockResolvedValueOnce(jsonResponse(403, { error: "action_pin_required", actionKey: "patient_create", requiresReason: false }));

    renderWithActionPin(<TestMutationButton />);
    await userEvent.click(screen.getByRole("button", { name: "Create patient" }));
    await userEvent.type(await screen.findByLabelText("Security Action PIN"), "1234");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));

    expect(await screen.findByText("action_pin_required")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the retried mutation business error after successful PIN verification", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(403, { error: "action_pin_required", actionKey: "patient_create", requiresReason: false }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
      .mockResolvedValueOnce(jsonResponse(400, { message: "Patient name is required" }));

    renderWithActionPin(<TestMutationButton />);
    await userEvent.click(screen.getByRole("button", { name: "Create patient" }));
    await userEvent.type(await screen.findByLabelText("Security Action PIN"), "1234");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));

    expect(await screen.findByText("Patient name is required")).toBeTruthy();
  });

  it("leaves non-PIN 403 errors on the existing path", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(403, { message: "Forbidden" }));

    renderWithActionPin(<TestMutationButton />);
    await userEvent.click(screen.getByRole("button", { name: "Create patient" }));

    expect(await screen.findByText("Forbidden")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens from the real patient create API helper", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(403, { error: "action_pin_required", actionKey: "patient_create", requiresReason: false }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
      .mockResolvedValueOnce(jsonResponse(200, { patient: { id: 10, arabicFullName: "Ada" } }));

    renderWithActionPin(
      <TestRealApiButton label="Real patient create" run={() => createPatient({ arabicFullName: "Ada" } satisfies Partial<Patient>)} />
    );
    await userEvent.click(screen.getByRole("button", { name: "Real patient create" }));
    await userEvent.type(await screen.findByLabelText("Security Action PIN"), "1234");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));

    await screen.findByText("ok");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/patients");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/patients");
  });

  it("opens from the real appointment create API helper", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(403, { error: "action_pin_required", actionKey: "appointment_create", requiresReason: false }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
      .mockResolvedValueOnce(jsonResponse(200, { booking: { id: 20 } }));

    renderWithActionPin(
      <TestRealApiButton label="Real appointment create" run={() => createV2Booking(ACTION_PIN_BOOKING_REQUEST)} />
    );
    await userEvent.click(screen.getByRole("button", { name: "Real appointment create" }));
    await userEvent.type(await screen.findByLabelText("Security Action PIN"), "1234");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));

    await screen.findByText("ok");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v2/appointments");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/v2/appointments");
  });

  it("opens from the real queue walk-in API helper when the route requires PIN", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(403, { error: "action_pin_required", actionKey: "queue_walk_in", requiresReason: false }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
      .mockResolvedValueOnce(jsonResponse(201, { booking: { id: 30 } }));

    renderWithActionPin(
      <TestRealApiButton label="Real queue walk-in" run={() => addWalkIn({ patientId: 1, modalityId: 2, appointmentDate: "2026-05-29" })} />
    );
    await userEvent.click(screen.getByRole("button", { name: "Real queue walk-in" }));
    await userEvent.type(await screen.findByLabelText("Security Action PIN"), "1234");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));

    await screen.findByText("ok");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v2/read/queue/walk-in");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/v2/read/queue/walk-in");
  });
});

describe("ActionPinSettingsButton", () => {
  beforeEach(() => {
    localStorage.setItem("rispro-language", "en");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("lets the current user set a Security Action PIN with account password confirmation", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(200, {
        hasPin: false,
        lockedUntil: null,
        pinExpiresAt: null,
        isExpired: false,
        policy: {
          enabled: true,
          pinLength: 4,
          allowUserPinChange: true,
          requirePinToViewOwnPinSettings: false
        }
      }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
      .mockResolvedValueOnce(jsonResponse(200, {
        hasPin: true,
        lockedUntil: null,
        pinExpiresAt: null,
        isExpired: false,
        policy: {
          enabled: true,
          pinLength: 4,
          allowUserPinChange: true,
          requirePinToViewOwnPinSettings: false
        }
      }));

    renderWithQuery(<ActionPinSettingsButton />);
    await userEvent.click(screen.getByRole("button", { name: "Manage Security PIN" }));
    expect(await screen.findByText("Set Security Action PIN")).toBeTruthy();

    await userEvent.type(screen.getByLabelText("Account password"), "account-password");
    await userEvent.type(screen.getByLabelText("New PIN"), "2468");
    await userEvent.type(screen.getByLabelText("Confirm PIN"), "2468");
    await userEvent.click(screen.getByRole("button", { name: "Save PIN" }));

    await screen.findByText("Security Action PIN saved.");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/action-pin/set");
    expect(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body)).toBe(JSON.stringify({ pin: "2468", confirmPin: "2468", currentPassword: "account-password" }));
  });

  it("shows existing-PIN management actions without exposing plaintext PIN", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(200, {
        hasPin: true,
        lockedUntil: null,
        pinExpiresAt: null,
        isExpired: false,
        policy: {
          enabled: true,
          pinLength: 4,
          allowUserPinChange: true,
          requirePinToViewOwnPinSettings: false
        }
      }));

    renderWithQuery(<ActionPinSettingsButton />);
    await userEvent.click(screen.getByRole("button", { name: "Manage Security PIN" }));
    await screen.findByText("Manage Security Action PIN");

    expect(screen.getByText("PIN is set")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset PIN" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Disable PIN" })).toBeTruthy();
    expect(screen.queryByText("1357")).toBeNull();
  });

  it("requires password and matching PINs before resetting an existing Security Action PIN", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(200, {
        hasPin: true,
        lockedUntil: null,
        pinExpiresAt: null,
        isExpired: false,
        policy: {
          enabled: true,
          pinLength: 4,
          allowUserPinChange: true,
          requirePinToViewOwnPinSettings: true
        }
      }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    renderWithQuery(<ActionPinSettingsButton />);
    await userEvent.click(screen.getByRole("button", { name: "Manage Security PIN" }));
    await screen.findByText("Manage Security Action PIN");
    await userEvent.click(screen.getByRole("button", { name: "Reset PIN" }));

    await userEvent.click(screen.getByRole("button", { name: "Reset PIN" }));
    expect(await screen.findByText("Account password is required.")).toBeTruthy();

    await userEvent.type(screen.getByLabelText("Account password"), "account-password");
    await userEvent.type(screen.getByLabelText("New PIN"), "2468");
    await userEvent.type(screen.getByLabelText("Confirm PIN"), "1357");
    await userEvent.click(screen.getByRole("button", { name: "Reset PIN" }));
    expect(await screen.findByText("PINs do not match.")).toBeTruthy();

    await userEvent.clear(screen.getByLabelText("Confirm PIN"));
    await userEvent.type(screen.getByLabelText("Confirm PIN"), "2468");
    await userEvent.click(screen.getByRole("button", { name: "Reset PIN" }));

    await waitFor(() => expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/action-pin/set"));
    expect(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body)).toBe(JSON.stringify({ pin: "2468", confirmPin: "2468", currentPassword: "account-password" }));
  });

  it("requires account password before disabling Security Action PIN", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(200, {
        hasPin: true,
        lockedUntil: null,
        pinExpiresAt: null,
        isExpired: false,
        policy: {
          enabled: true,
          pinLength: 4,
          allowUserPinChange: true,
          requirePinToViewOwnPinSettings: false
        }
      }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    renderWithQuery(<ActionPinSettingsButton />);
    await userEvent.click(screen.getByRole("button", { name: "Manage Security PIN" }));
    await screen.findByText("Manage Security Action PIN");
    await userEvent.click(screen.getByRole("button", { name: "Disable PIN" }));

    expect(screen.getByText("Disabling your Security Action PIN may prevent you from confirming restricted actions until a new PIN is set.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Disable PIN" }));
    expect(await screen.findByText("Account password is required.")).toBeTruthy();

    await userEvent.type(screen.getByLabelText("Account password"), "account-password");
    await userEvent.click(screen.getByRole("button", { name: "Disable PIN" }));

    await waitFor(() => expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/action-pin/disable"));
    expect(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body)).toBe(JSON.stringify({ currentPassword: "account-password" }));
  });
});

describe("ActionPinIdleLock", () => {
  beforeEach(() => {
    localStorage.setItem("rispro-language", "en");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("does not activate when policy is disabled", async () => {
    mockIdleFetch({ policyEnabled: false, idleLockEnabled: true });
    renderIdleLock();
    await flushIdleQueries();
    expect(screen.getByText("Patient screen content")).toBeTruthy();

    await delay(150);

    expect(screen.queryByText("Session locked")).toBeNull();
  });

  it("does not activate when idle lock is disabled", async () => {
    mockIdleFetch({ policyEnabled: true, idleLockEnabled: false });
    renderIdleLock();
    await flushIdleQueries();
    expect(screen.getByText("Patient screen content")).toBeTruthy();

    await delay(150);

    expect(screen.queryByText("Session locked")).toBeNull();
  });

  it("does not activate when the current user is not eligible for idle lock", async () => {
    mockIdleFetch({ policyEnabled: true, idleLockEnabled: true, idleLockEligible: false });
    renderIdleLock();
    await flushIdleQueries();
    expect(screen.getByText("Patient screen content")).toBeTruthy();

    await delay(150);

    expect(screen.queryByText("Session locked")).toBeNull();
  });

  it("shows persisted lock state after remount", async () => {
    mockIdleFetch({ policyEnabled: true, idleLockEnabled: true, idleLockActive: true });
    const rendered = renderIdleLock();
    await flushIdleQueries();
    expect(await screen.findByText("Session locked")).toBeTruthy();

    rendered.unmount();
    renderIdleLock();
    await flushIdleQueries();

    expect(await screen.findByText("Session locked")).toBeTruthy();
  });

  it("appears after idleLockSeconds when enabled and activity resets the timer", async () => {
    const fetchMock = mockIdleFetch({ policyEnabled: true, idleLockEnabled: true });
    renderIdleLock();
    await flushIdleQueries();
    expect(screen.getByText("Patient screen content")).toBeTruthy();

    await delay(50);
    fireEvent.mouseMove(window);
    await delay(70);
    expect(screen.queryByText("Session locked")).toBeNull();

    await delay(60);
    expect(screen.getByText("Session locked")).toBeTruthy();
    expect(fetchMock.mock.calls.some((call) => call[0] === "/api/action-pin/idle-lock")).toBe(true);
  });

  it("does not treat background API activity as idle timer activity", async () => {
    mockIdleFetch({ policyEnabled: true, idleLockEnabled: true });
    renderIdleLock();
    await flushIdleQueries();

    await delay(40);
    window.dispatchEvent(new Event("rispro-api-activity"));
    await delay(40);
    window.dispatchEvent(new Event("rispro-api-activity"));

    expect(await screen.findByText("Session locked", {}, { timeout: 1_000 })).toBeTruthy();
  });

  it("submits unlock PIN only to verify and hides overlay on success", async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const fetchMock = mockIdleFetch({ policyEnabled: true, idleLockEnabled: true });
    renderIdleLock();
    await flushIdleQueries();
    expect(screen.getByText("Patient screen content")).toBeTruthy();

    expect(await screen.findByText("Session locked", {}, { timeout: 1_000 })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Unlock Action PIN"), { target: { value: "1234" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByText("Session locked")).toBeNull();
    const verifyCall = fetchMock.mock.calls.find((call) => call[0] === "/api/action-pin/verify");
    expect(String((verifyCall?.[1] as RequestInit).body)).toContain("1234");
    expect(String((verifyCall?.[1] as RequestInit).body)).toContain("session_unlock");
    expect(fetchMock.mock.calls.some((call) => call[0] === "/api/patients" && String((call[1] as RequestInit | undefined)?.body).includes("1234"))).toBe(false);
    expect(setItemSpy.mock.calls.every((call) => !JSON.stringify(call).includes("1234"))).toBe(true);
    expect(JSON.stringify(sessionStorage)).not.toContain("1234");
  });

  it("keeps overlay visible after failed unlock", async () => {
    mockIdleFetch({ policyEnabled: true, idleLockEnabled: true, verifyOk: false });
    renderIdleLock();
    await flushIdleQueries();
    expect(screen.getByText("Patient screen content")).toBeTruthy();

    expect(await screen.findByText("Session locked", {}, { timeout: 1_000 })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Unlock Action PIN"), { target: { value: "9999" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("invalid_action_pin")).toBeTruthy();
    expect(screen.getByText("Session locked")).toBeTruthy();
  });

  it("shows missing PIN message without bypassing lock", async () => {
    mockIdleFetch({ policyEnabled: true, idleLockEnabled: true, hasPin: false });
    renderIdleLock();
    await flushIdleQueries();
    expect(screen.getByText("Patient screen content")).toBeTruthy();

    expect(await screen.findByText("Action PIN is required to unlock. Switch user or contact super admin.", {}, { timeout: 1_000 })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Unlock" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("switch user logs out and redirects to login without preserving entered PIN", async () => {
    const fetchMock = mockIdleFetch({ policyEnabled: true, idleLockEnabled: true });
    const originalLocation = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...originalLocation, href: "" } });
    renderIdleLock();
    await flushIdleQueries();
    expect(screen.getByText("Patient screen content")).toBeTruthy();

    expect(await screen.findByText("Session locked", {}, { timeout: 1_000 })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Unlock Action PIN"), { target: { value: "1234" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Switch user" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock.mock.calls.some((call) => call[0] === "/api/auth/logout")).toBe(true);
    expect(window.location.href).toBe("/login");
    expect(JSON.stringify(localStorage)).not.toContain("1234");
    expect(JSON.stringify(sessionStorage)).not.toContain("1234");
    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
  });
});
