import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { ActionPinSettingsButton } from "@/components/auth/action-pin-settings-button";
import { createPatient, addWalkIn } from "@/lib/api-hooks";
import { api, setActionPinChallengeHandler } from "@/lib/api-client";
import { ActionPinProvider } from "@/providers/action-pin-provider";
import { LanguageProvider } from "@/providers/language-provider";
import { createV2Booking } from "@/v2/appointments/api";

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
    expect(screen.getByLabelText("Action PIN")).toBeTruthy();
  });

  it("verifies the PIN then retries the original mutation without sending the raw PIN", async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(403, { error: "action_pin_required", actionKey: "patient_create", requiresReason: false }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    renderWithActionPin(<TestMutationButton />);
    await userEvent.click(screen.getByRole("button", { name: "Create patient" }));
    await userEvent.type(await screen.findByLabelText("Action PIN"), "1234");
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
    await userEvent.type(await screen.findByLabelText("Action PIN"), "1234");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));

    expect(await screen.findByText("Reason is required.")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await userEvent.type(screen.getByLabelText("Action PIN reason"), "Confirming demographics change");
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
    await userEvent.type(await screen.findByLabelText("Action PIN"), "9999");
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
    await userEvent.type(await screen.findByLabelText("Action PIN"), "1234");
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
    await userEvent.type(await screen.findByLabelText("Action PIN"), "1234");
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
      <TestRealApiButton label="Real patient create" run={() => createPatient({ arabicFullName: "Ada" } as any)} />
    );
    await userEvent.click(screen.getByRole("button", { name: "Real patient create" }));
    await userEvent.type(await screen.findByLabelText("Action PIN"), "1234");
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
      <TestRealApiButton label="Real appointment create" run={() => createV2Booking({ patientId: 1 } as any)} />
    );
    await userEvent.click(screen.getByRole("button", { name: "Real appointment create" }));
    await userEvent.type(await screen.findByLabelText("Action PIN"), "1234");
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
    await userEvent.type(await screen.findByLabelText("Action PIN"), "1234");
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

  it("lets the current user set or change a 4-digit Action PIN", async () => {
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
    await userEvent.click(screen.getByRole("button", { name: "Action PIN settings" }));
    expect(await screen.findByText("No Action PIN is set.")).toBeTruthy();

    await userEvent.type(screen.getByLabelText("New Action PIN"), "2468");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("Action PIN saved.");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/action-pin/set");
    expect(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body)).toBe(JSON.stringify({ pin: "2468" }));
  });

  it("shows a clear set/change failure without exposing plaintext PIN", async () => {
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
      }))
      .mockResolvedValueOnce(jsonResponse(403, { message: "Action PIN changes are disabled by policy." }));

    renderWithQuery(<ActionPinSettingsButton />);
    await userEvent.click(screen.getByRole("button", { name: "Action PIN settings" }));
    await screen.findByText("You have an Action PIN set.");

    await userEvent.type(screen.getByLabelText("New Action PIN"), "1357");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Action PIN changes are disabled by policy.")).toBeTruthy();
    expect(screen.queryByText("1357")).toBeNull();
  });
});
