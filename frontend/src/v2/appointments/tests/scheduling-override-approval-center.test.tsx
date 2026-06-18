import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SchedulingOverrideApprovalCenter, SchedulingOverrideRequestsWorkspace } from "../components/SchedulingOverrideApprovalCenter";
import { LanguageProvider } from "@/providers/language-provider";
import type { SchedulingOverrideRequestDto } from "../types";
import type { User } from "@/types/api";

const mockApprove = vi.fn();
const mockReject = vi.fn();
const mockCancel = vi.fn();
const mockSubscribePush = vi.fn();
const mockUnsubscribePush = vi.fn();
const mockTestPush = vi.fn();
let mockRequests: SchedulingOverrideRequestDto[] = [];
let mockPushConfig = { enabled: true, publicKey: "test-public-key", subscribed: false };

vi.mock("@/lib/toast", () => ({
  pushToast: vi.fn(),
}));

vi.mock("@/components/auth/supervisor-reauth-modal", () => ({
  SupervisorReAuthModal: ({ onSuccess }: { onSuccess: () => void }) => (
    <button type="button" onClick={onSuccess}>Mock re-auth</button>
  ),
}));

vi.mock("../api", () => ({
  useSchedulingOverrideRequests: () => ({
    data: { requests: mockRequests },
    isLoading: false,
    isError: false,
  }),
  useApproveSchedulingOverrideRequest: () => ({
    mutateAsync: mockApprove,
    isPending: false,
  }),
  useRejectSchedulingOverrideRequest: () => ({
    mutateAsync: mockReject,
    isPending: false,
  }),
  useCancelSchedulingOverrideRequest: () => ({
    mutateAsync: mockCancel,
    isPending: false,
  }),
  useUserPushConfig: () => ({
    data: mockPushConfig,
    isLoading: false,
    isError: false,
  }),
  useSubscribeUserPush: () => ({
    mutateAsync: mockSubscribePush,
    isPending: false,
  }),
  useUnsubscribeUserPush: () => ({
    mutateAsync: mockUnsubscribePush,
    isPending: false,
  }),
  useSendUserTestPush: () => ({
    mutateAsync: mockTestPush,
    isPending: false,
  }),
}));

function request(overrides: Partial<SchedulingOverrideRequestDto> = {}): SchedulingOverrideRequestDto {
  return {
    id: 11,
    requestType: "create_booking",
    overrideType: "category_override",
    status: "pending",
    requesterUserId: 5,
    approverUserId: null,
    patientId: 20,
    modalityId: 2,
    examTypeId: 8,
    requestedBookingDate: "2042-02-01",
    requestedBookingTime: null,
    bookingId: null,
    requestedPolicyVersionId: 1,
    approvedPolicyVersionId: null,
    requestPayloadJson: { version: 1, requestType: "create_booking" },
    originalDecisionSnapshotJson: {},
    approvalDecisionSnapshotJson: null,
    requesterReason: "Need approval",
    approverReason: null,
    failureCode: null,
    failureMessage: null,
    expiresAt: "2042-02-02T00:00:00Z",
    createdFromContext: null,
    approvedAt: null,
    rejectedAt: null,
    cancelledAt: null,
    failedAt: null,
    expiredAt: null,
    createdAt: "2042-02-01T08:00:00Z",
    updatedAt: "2042-02-01T08:00:00Z",
    patientDisplayName: "Nadia Test",
    patientIdentifier: "P-20",
    modalityName: "MRI",
    modalityCode: "MR",
    examTypeName: "MRI Brain",
    requesterDisplayName: "Reception User",
    requesterUsername: "reception",
    approverDisplayName: null,
    approverUsername: null,
    decisionContext: null,
    ...overrides,
  };
}

function user(role: User["role"], id = 1): User {
  return {
    id,
    username: `${role}-user`,
    fullName: `${role} User`,
    role,
    isActive: true,
  } as User;
}

function renderWithLanguage(ui: ReactElement) {
  return render(<LanguageProvider>{ui}</LanguageProvider>);
}

describe("SchedulingOverrideApprovalCenter", () => {
  beforeEach(() => {
    localStorage.setItem("rispro-language", "en");
    mockApprove.mockReset();
    mockReject.mockReset();
    mockCancel.mockReset();
    mockSubscribePush.mockReset();
    mockUnsubscribePush.mockReset();
    mockTestPush.mockReset();
    mockApprove.mockResolvedValue({ request: request({ status: "approved" }) });
    mockReject.mockResolvedValue({ request: request({ status: "rejected" }) });
    mockCancel.mockResolvedValue({ request: request({ status: "cancelled" }) });
    mockSubscribePush.mockResolvedValue({ subscriptionId: 1 });
    mockUnsubscribePush.mockResolvedValue({ ok: true, disabled: true });
    mockTestPush.mockResolvedValue({ attempted: 1, sent: 1, failed: 0 });
    mockPushConfig = { enabled: true, publicKey: "test-public-key", subscribed: false };
    mockRequests = [request()];
  });

  it("shows pending requests and calls approve/reject for supervisor", async () => {
    renderWithLanguage(<SchedulingOverrideApprovalCenter user={user("supervisor")} />);

    await userEvent.click(screen.getByRole("button", { name: "Override requests" }));
    expect(screen.getByText("Nadia Test")).toBeTruthy();
    expect(screen.getByText("P-20 · ID 20")).toBeTruthy();
    expect(screen.getByText("MRI Brain")).toBeTruthy();
    expect(screen.getByText("Reception User")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Approval note for request 11"), { target: { value: "Approved note" } });
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(mockApprove).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Mock re-auth" }));
    expect(mockApprove).toHaveBeenCalledWith({ id: 11, approverReason: "Approved note" });

    await userEvent.click(screen.getByRole("button", { name: "Reject" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm rejection" }));
    expect(screen.getByText("Rejection reason is required.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Rejection reason for request 11"), { target: { value: "Not justified" } });
    await userEvent.click(screen.getByRole("button", { name: "Confirm rejection" }));
    expect(mockReject).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Mock re-auth" }));
    expect(mockReject).toHaveBeenCalledWith({ id: 11, approverReason: "Not justified" });
  });

  it("renders the full page workspace with the same approval actions", async () => {
    renderWithLanguage(<SchedulingOverrideRequestsWorkspace user={user("supervisor")} variant="page" />);

    expect(screen.getByText("Nadia Test")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Approval note for request 11"), { target: { value: "Page approval" } });
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    await userEvent.click(screen.getByRole("button", { name: "Mock re-auth" }));

    expect(mockApprove).toHaveBeenCalledWith({ id: 11, approverReason: "Page approval" });
  });

  it("does not allow supervisor to approve total capacity but superadmin can", async () => {
    mockRequests = [request({
      id: 12,
      overrideType: "total_capacity_override",
      decisionContext: {
        violatedRuleLabel: "Total MRI capacity exceeded",
        violatedRuleType: "total_capacity_override",
        currentCapacity: 10,
        totalCapacity: 10,
        remainingCapacity: 0,
        afterApprovalCapacity: 11,
        overbookAmount: 1,
        modalityCapacityBreakdown: { modalityId: 2, modalityName: "MRI", modalityCode: "MR", bookedTotal: 10, totalCapacity: 10 },
        categoryBreakdown: null,
        specialQuotaBreakdown: null,
        sameDayAppointmentCount: 10,
        sameDayAppointmentSummary: [],
        patientPreviousNoShowCount: 0,
        patientPreviousCancelledCount: 0,
        patientFutureAppointmentCount: 0,
        duplicateFutureAppointmentWarning: null,
        requester: { userId: 5, name: "Reception User", username: "reception", role: "receptionist" },
        submittedAt: "2042-02-01T08:00:00Z",
        requestAgeMinutes: 4,
        approvalNoteRequired: true,
        approvalConsequenceText: "Approving this request will create this appointment even though MRI daily capacity is already full. This will overbook MRI by 1 case.",
      },
    })];

    const { rerender } = renderWithLanguage(<SchedulingOverrideApprovalCenter user={user("supervisor")} />);
    await userEvent.click(screen.getByRole("button", { name: "Override requests" }));
    expect(screen.getByText("Total MRI capacity exceeded")).toBeTruthy();
    expect(screen.getByText("10 / 10")).toBeTruthy();
    expect(screen.getByText("11 / 10")).toBeTruthy();
    expect(screen.getByText("+1 case")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.getByText("Supervisor cannot approve total capacity overrides. Superadmin approval is required.")).toBeTruthy();

    rerender(<LanguageProvider><SchedulingOverrideApprovalCenter user={user("super_admin")} /></LanguageProvider>);
    expect((screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Approval note for request 12"), { target: { value: "Total capacity approved" } });
    expect((screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("renders patient history fallback safely", async () => {
    mockRequests = [request({
      id: 15,
      decisionContext: {
        violatedRuleLabel: "Category capacity exceeded",
        violatedRuleType: "category_override",
        currentCapacity: null,
        totalCapacity: null,
        remainingCapacity: null,
        afterApprovalCapacity: null,
        overbookAmount: null,
        modalityCapacityBreakdown: null,
        categoryBreakdown: null,
        specialQuotaBreakdown: null,
        sameDayAppointmentCount: null,
        sameDayAppointmentSummary: null,
        patientPreviousNoShowCount: null,
        patientPreviousCancelledCount: null,
        patientFutureAppointmentCount: null,
        duplicateFutureAppointmentWarning: null,
        requester: { userId: 5, name: "Reception User", username: "reception", role: "receptionist" },
        submittedAt: "2042-02-01T08:00:00Z",
        requestAgeMinutes: null,
        approvalNoteRequired: false,
        approvalConsequenceText: null,
      },
    })];
    renderWithLanguage(<SchedulingOverrideApprovalCenter user={user("supervisor")} />);

    await userEvent.click(screen.getByRole("button", { name: "Override requests" }));

    expect(screen.getAllByText("Not available").length).toBeGreaterThan(0);
  });

  it("lets receptionist cancel own pending request and shows failed-state message", async () => {
    mockRequests = [
      request({ id: 13, requesterUserId: 7 }),
      request({
        id: 14,
        status: "failed",
        requesterUserId: 7,
        failureMessage: "The current scheduling state has changed. A different or stronger override is now required.",
      }),
    ];
    renderWithLanguage(<SchedulingOverrideApprovalCenter user={user("receptionist", 7)} />);

    await userEvent.click(screen.getByRole("button", { name: "Override requests" }));
    expect(screen.getByText("The scheduling state has changed. This request can no longer be approved with the original override type.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Cancel request" }));

    await waitFor(() => {
      expect(mockCancel).toHaveBeenCalledWith(13);
    });
  });

  it("shows browser notification controls inside the override drawer", async () => {
    mockPushConfig = { enabled: true, publicKey: "test-public-key", subscribed: true };
    renderWithLanguage(<SchedulingOverrideApprovalCenter user={user("supervisor")} />);

    await userEvent.click(screen.getByRole("button", { name: "Override requests" }));

    expect(screen.getByText("Override notifications")).toBeTruthy();
    expect(screen.getByText("Browser notifications")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Enable this browser" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Send test notification" }));

    expect(mockTestPush).toHaveBeenCalledTimes(1);
  });
});
