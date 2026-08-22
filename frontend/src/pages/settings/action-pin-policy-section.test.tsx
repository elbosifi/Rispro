import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ActionPinPolicySection from "./action-pin-policy-section";
import { LanguageProvider } from "@/providers/language-provider-component";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function basePolicy() {
  return {
    enabled: false,
    pinLength: 4,
    rotationMode: "manual",
    rotationIntervalDays: 0,
    expirePinAfterRotation: false,
    verificationTtlSeconds: 300,
    idleLockEnabled: false,
    idleLockSeconds: 180,
    maxFailedAttempts: 5,
    lockoutMinutes: 15,
    allowUserPinChange: true,
    allowUserPinRegenerate: false,
    requirePinToViewOwnPinSettings: false,
    notifyUserOnPinChange: false,
    actionModes: {
      patient_create: { receptionist: "required_every_time", super_admin: "not_required" },
      patient_update: { receptionist: "required_every_time", super_admin: "not_required" },
      queue_confirm_no_show: { receptionist: "required_every_time", super_admin: "not_required" },
    },
    reasonRequiredModes: {},
    disabledForRoleModes: {},
    futureBackendField: { keep: true },
  };
}

function adminUsers() {
  return [
    {
      userId: 1,
      username: "front",
      fullName: "Front Desk",
      role: "receptionist",
      isActive: true,
      hasActionPin: false,
      pinRotatedAt: null,
      pinExpiresAt: null,
      isExpired: false,
      failedAttempts: 0,
      lockedUntil: null,
      isLocked: false,
      updatedAt: null,
      updatedByUserId: null,
    },
    {
      userId: 2,
      username: "locked",
      fullName: "Locked User",
      role: "supervisor",
      isActive: true,
      hasActionPin: true,
      pinRotatedAt: "2026-01-01T00:00:00.000Z",
      pinExpiresAt: "2020-01-01T00:00:00.000Z",
      isExpired: true,
      failedAttempts: 5,
      lockedUntil: "2027-01-01T00:00:00.000Z",
      isLocked: true,
      updatedAt: "2026-01-01T00:00:00.000Z",
      updatedByUserId: 9,
      updatedByUsername: "admin",
      updatedByFullName: "Admin User",
    },
  ];
}

function renderSection(onReAuthRequired = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  return render(
    <LanguageProvider>
      <QueryClientProvider client={queryClient}>
        <ActionPinPolicySection onReAuthRequired={onReAuthRequired} />
      </QueryClientProvider>
    </LanguageProvider>
  );
}

function mockPolicyFetch(policy: unknown, saveResponse: { status: number; body: unknown } = { status: 200, body: { policy } }) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === "/api/action-pin/status") {
      return jsonResponse(200, {
        hasPin: true,
        lockedUntil: null,
        pinExpiresAt: null,
        isExpired: false,
        policy: {
          enabled: false,
          pinLength: 4,
          allowUserPinChange: true,
          requirePinToViewOwnPinSettings: false,
        },
      });
    }
    if (url === "/api/action-pin/admin/users" && !init?.method) {
      return jsonResponse(200, { users: adminUsers() });
    }
    if (url.startsWith("/api/action-pin/admin/users/") && (init as RequestInit | undefined)?.method === "POST") {
      return jsonResponse(200, { ok: true, hadPin: true, pinExpiresAt: "2026-05-29T00:00:00.000Z" });
    }
    if (url === "/api/settings/users-and-roles/action-pin-policy" && (init as RequestInit | undefined)?.method === "PUT") {
      return jsonResponse(saveResponse.status, saveResponse.body);
    }
    if (url === "/api/settings/users-and-roles/action-pin-policy") {
      return jsonResponse(200, { policy });
    }
    return jsonResponse(404, { message: `Unexpected URL ${url}` });
  });
}

async function savedPolicy(fetchMock: ReturnType<typeof vi.spyOn>) {
  await waitFor(() => expect(fetchMock.mock.calls.some((call: unknown[]) => call[0] === "/api/settings/users-and-roles/action-pin-policy" && (call[1] as RequestInit | undefined)?.method === "PUT")).toBe(true));
  const putCall = fetchMock.mock.calls.find((call: unknown[]) => call[0] === "/api/settings/users-and-roles/action-pin-policy" && (call[1] as RequestInit | undefined)?.method === "PUT");
  return JSON.parse(String((putCall?.[1] as RequestInit).body)).policy;
}

describe("ActionPinPolicySection", () => {
  beforeEach(() => {
    localStorage.setItem("rispro-language", "en");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("loads Action PIN policy and saves the enabled toggle with warning visible", async () => {
    const fetchMock = mockPolicyFetch(basePolicy(), { status: 200, body: { policy: { ...basePolicy(), enabled: true } } });

    renderSection();
    expect(await screen.findByText("Action PIN Policy")).toBeTruthy();

    await userEvent.click(screen.getByLabelText("Enable Action PIN"));
    expect(screen.getByText("Users without an Action PIN may be blocked from protected actions.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Save Action PIN Policy" }));

    expect((await savedPolicy(fetchMock)).enabled).toBe(true);
  });

  it("saves numeric controls with expected values", async () => {
    const fetchMock = mockPolicyFetch(basePolicy());

    renderSection();
    await screen.findByText("Action PIN Policy");

    await userEvent.clear(screen.getByLabelText("Verification TTL seconds"));
    await userEvent.type(screen.getByLabelText("Verification TTL seconds"), "600");
    await userEvent.clear(screen.getByLabelText("Max failed attempts"));
    await userEvent.type(screen.getByLabelText("Max failed attempts"), "7");
    await userEvent.clear(screen.getByLabelText("Lockout minutes"));
    await userEvent.type(screen.getByLabelText("Lockout minutes"), "20");
    await userEvent.click(screen.getByRole("button", { name: "Save Action PIN Policy" }));

    const policy = await savedPolicy(fetchMock);
    expect(policy.verificationTtlSeconds).toBe(600);
    expect(policy.maxFailedAttempts).toBe(7);
    expect(policy.lockoutMinutes).toBe(20);
  });

  it("renders existing idle-lock user exceptions as selected users", async () => {
    const fetchMock = mockPolicyFetch({
      ...basePolicy(),
      idleLockEnabled: true,
      idleLockRoleMode: "include",
      idleLockRoles: ["receptionist"],
      idleLockUserIds: [1],
      idleLockExcludedUserIds: [2],
    });

    renderSection();
    await screen.findByText("Action PIN Policy");

    expect((screen.getByLabelText("Always include specific users Front Desk") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Exclude specific users Locked User") as HTMLInputElement).checked).toBe(true);

    await userEvent.selectOptions(screen.getByLabelText("Idle lock role eligibility"), "exclude");
    await userEvent.click(screen.getByLabelText("Idle lock role Doctor"));
    await userEvent.click(screen.getByRole("button", { name: "Save Action PIN Policy" }));

    const policy = await savedPolicy(fetchMock);
    expect(policy.idleLockRoleMode).toBe("exclude");
    expect(policy.idleLockRoles).toContain("doctor");
    expect(policy.idleLockUserIds).toEqual([1]);
    expect(policy.idleLockExcludedUserIds).toEqual([2]);
  });

  it("updates numeric idle-lock user exception arrays and prevents conflicting selections", async () => {
    const fetchMock = mockPolicyFetch({
      ...basePolicy(),
      idleLockEnabled: true,
      idleLockUserIds: [1],
      idleLockExcludedUserIds: [],
    });

    renderSection();
    await screen.findByText("Action PIN Policy");

    await userEvent.click(screen.getByLabelText("Always include specific users Locked User"));
    await userEvent.click(screen.getByLabelText("Exclude specific users Front Desk"));
    expect((screen.getByLabelText("Always include specific users Front Desk") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText("Exclude specific users Front Desk") as HTMLInputElement).checked).toBe(true);
    await userEvent.click(screen.getByLabelText("Always include specific users Front Desk"));
    expect((screen.getByLabelText("Exclude specific users Front Desk") as HTMLInputElement).checked).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Save Action PIN Policy" }));

    const policy = await savedPolicy(fetchMock);
    expect(policy.idleLockUserIds).toEqual([2, 1]);
    expect(policy.idleLockExcludedUserIds).toEqual([]);
    expect(policy.idleLockUserIds.every((id: unknown) => typeof id === "number")).toBe(true);
  });

  it("saves role/action matrix changes and reason-required mode", async () => {
    const fetchMock = mockPolicyFetch(basePolicy());

    renderSection();
    const row = await screen.findByTestId("action-pin-row-patient_create");
    await userEvent.selectOptions(within(row).getByLabelText("Create patient receptionist mode"), "required_after_inactivity");

    const noShowRow = screen.getByTestId("action-pin-row-queue_confirm_no_show");
    await userEvent.selectOptions(within(noShowRow).getByLabelText("Confirm / mark no-show supervisor mode"), "required_every_time_with_reason");
    await userEvent.click(screen.getByRole("button", { name: "Save Action PIN Policy" }));

    const policy = await savedPolicy(fetchMock);
    expect(policy.actionModes.patient_create.receptionist).toBe("required_after_inactivity");
    expect(policy.actionModes.queue_confirm_no_show.supervisor).toBe("required_every_time_with_reason");
  });

  it("normalizes missing fields and preserves unknown loaded fields", async () => {
    const partialPolicy = {
      enabled: false,
      actionModes: {
        patient_create: { receptionist: "required_every_time" },
      },
      futureBackendField: "preserve-me",
    };
    const fetchMock = mockPolicyFetch(partialPolicy);

    renderSection();
    await screen.findByText("Action PIN Policy");
    expect((screen.getByLabelText("PIN length") as HTMLInputElement).value).toBe("4");
    await userEvent.click(screen.getByRole("button", { name: "Save Action PIN Policy" }));

    const policy = await savedPolicy(fetchMock);
    expect(policy.futureBackendField).toBe("preserve-me");
    expect(policy.pinLength).toBe(4);
    expect(policy.actionModes.patient_create.receptionist).toBe("required_every_time");
  });

  it("shows unauthorized save failure", async () => {
    mockPolicyFetch(basePolicy(), { status: 403, body: { message: "Only super_admin can update Action PIN policy." } });

    renderSection();
    await screen.findByText("Action PIN Policy");
    await userEvent.click(screen.getByRole("button", { name: "Save Action PIN Policy" }));

    expect(await screen.findByText("Only super_admin can update Action PIN policy.")).toBeTruthy();
  });

  it("requests supervisor re-auth when policy load is blocked", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/action-pin/status") return jsonResponse(200, { hasPin: true, policy: { enabled: false, pinLength: 4, allowUserPinChange: true, requirePinToViewOwnPinSettings: false } });
      if (url === "/api/settings/users-and-roles/action-pin-policy") return jsonResponse(403, { message: "Recent supervisor re-authentication is required." });
      return jsonResponse(200, { users: adminUsers() });
    });
    const onReAuthRequired = vi.fn();

    renderSection(onReAuthRequired);

    await waitFor(() => {
      expect(onReAuthRequired).toHaveBeenCalledWith(["settings", "users_and_roles", "action_pin_policy"]);
    });
  });

  it("loads readiness table and shows missing PIN summary when policy is enabled", async () => {
    mockPolicyFetch({ ...basePolicy(), enabled: true });

    renderSection();

    expect(await screen.findByText("User PIN Readiness / User PIN Management")).toBeTruthy();
    expect(screen.getByText("Admins cannot view user PINs.")).toBeTruthy();
    expect(screen.getByText("Active without PIN")).toBeTruthy();
    expect(screen.getAllByText("Front Desk").length).toBeGreaterThan(0);
    expect(screen.getByText("Not set")).toBeTruthy();
    expect(JSON.stringify(document.body.textContent)).not.toContain("1234");
  });

  it("reset action calls the expected endpoint and refreshes the table", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = mockPolicyFetch(basePolicy());

    renderSection();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Reset PIN" }).length).toBe(2));
    await userEvent.click(screen.getAllByRole("button", { name: "Reset PIN" })[0]!);

    await waitFor(() => expect(fetchMock.mock.calls.some((call) => call[0] === "/api/action-pin/admin/users/1/reset")).toBe(true));
    expect(confirmSpy).toHaveBeenCalled();
  });

  it("unlock action is disabled unless the user is locked", async () => {
    mockPolicyFetch(basePolicy());

    renderSection();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Unlock PIN" }).length).toBe(2));
    const unlockButtons = screen.getAllByRole("button", { name: "Unlock PIN" });

    expect((unlockButtons[0] as HTMLButtonElement).disabled).toBe(true);
    expect((unlockButtons[1] as HTMLButtonElement).disabled).toBe(false);
  });

  it("force expire action calls the expected endpoint", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = mockPolicyFetch(basePolicy());

    renderSection();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Force expire PIN" }).length).toBe(2));
    await userEvent.click(screen.getAllByRole("button", { name: "Force expire PIN" })[1]!);

    await waitFor(() => expect(fetchMock.mock.calls.some((call) => call[0] === "/api/action-pin/admin/users/2/expire")).toBe(true));
  });

  it("shows user readiness load errors clearly", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/action-pin/status") return jsonResponse(200, { hasPin: true, policy: { enabled: false, pinLength: 4, allowUserPinChange: true, requirePinToViewOwnPinSettings: false } });
      if (url === "/api/action-pin/admin/users") return jsonResponse(403, { message: "Only super_admin can manage Action PIN administration." });
      if (url === "/api/settings/users-and-roles/action-pin-policy" && (init as RequestInit | undefined)?.method !== "PUT") return jsonResponse(200, { policy: basePolicy() });
      return jsonResponse(200, { policy: basePolicy() });
    });

    renderSection();

    expect(await screen.findByText("Only super_admin can manage Action PIN administration.")).toBeTruthy();
  });

  it("requests supervisor re-auth when user readiness load is blocked", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/action-pin/status") return jsonResponse(200, { hasPin: true, policy: { enabled: false, pinLength: 4, allowUserPinChange: true, requirePinToViewOwnPinSettings: false } });
      if (url === "/api/action-pin/admin/users") return jsonResponse(403, { message: "Recent supervisor re-authentication is required." });
      if (url === "/api/settings/users-and-roles/action-pin-policy" && (init as RequestInit | undefined)?.method !== "PUT") return jsonResponse(200, { policy: basePolicy() });
      return jsonResponse(200, { policy: basePolicy() });
    });
    const onReAuthRequired = vi.fn();

    renderSection(onReAuthRequired);

    await waitFor(() => {
      expect(onReAuthRequired).toHaveBeenCalledWith(["action-pin", "admin", "users"]);
    });
  });
});
