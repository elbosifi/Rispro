import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SchedulingOverrideApprovalCenter } from "../components/SchedulingOverrideApprovalCenter";
import type { SchedulingOverrideRequestDto } from "../types";
import type { User } from "@/types/api";

const mockApprove = vi.fn();
const mockReject = vi.fn();
const mockCancel = vi.fn();
let mockRequests: SchedulingOverrideRequestDto[] = [];

vi.mock("@/lib/toast", () => ({
  pushToast: vi.fn(),
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

describe("SchedulingOverrideApprovalCenter", () => {
  beforeEach(() => {
    mockApprove.mockReset();
    mockReject.mockReset();
    mockCancel.mockReset();
    mockApprove.mockResolvedValue({ request: request({ status: "approved" }) });
    mockReject.mockResolvedValue({ request: request({ status: "rejected" }) });
    mockCancel.mockResolvedValue({ request: request({ status: "cancelled" }) });
    mockRequests = [request()];
  });

  it("shows pending requests and calls approve/reject for supervisor", async () => {
    render(<SchedulingOverrideApprovalCenter user={user("supervisor")} />);

    await userEvent.click(screen.getByRole("button", { name: "Override requests" }));
    expect(screen.getByText("Nadia Test")).toBeTruthy();
    expect(screen.getByText("P-20 · ID 20")).toBeTruthy();
    expect(screen.getByText("MRI Brain")).toBeTruthy();
    expect(screen.getByText("Reception User")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Approval note for request 11"), { target: { value: "Approved note" } });
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(mockApprove).toHaveBeenCalledWith({ id: 11, approverReason: "Approved note" });

    await userEvent.click(screen.getByRole("button", { name: "Reject" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm rejection" }));
    expect(screen.getByText("Rejection reason is required.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Rejection reason for request 11"), { target: { value: "Not justified" } });
    await userEvent.click(screen.getByRole("button", { name: "Confirm rejection" }));
    expect(mockReject).toHaveBeenCalledWith({ id: 11, approverReason: "Not justified" });
  });

  it("does not allow supervisor to approve total capacity but superadmin can", async () => {
    mockRequests = [request({ id: 12, overrideType: "total_capacity_override" })];

    const { rerender } = render(<SchedulingOverrideApprovalCenter user={user("supervisor")} />);
    await userEvent.click(screen.getByRole("button", { name: "Override requests" }));
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.getByText("Supervisor cannot approve total capacity overrides. Superadmin approval is required.")).toBeTruthy();

    rerender(<SchedulingOverrideApprovalCenter user={user("super_admin")} />);
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
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
    render(<SchedulingOverrideApprovalCenter user={user("receptionist", 7)} />);

    await userEvent.click(screen.getByRole("button", { name: "Override requests" }));
    expect(screen.getByText("The scheduling state has changed. This request can no longer be approved with the original override type.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Cancel request" }));

    await waitFor(() => {
      expect(mockCancel).toHaveBeenCalledWith(13);
    });
  });
});
