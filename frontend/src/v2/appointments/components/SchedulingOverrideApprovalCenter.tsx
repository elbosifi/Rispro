import { useMemo, useState } from "react";
import { Bell, X } from "lucide-react";
import { Button, Badge } from "@/components/shared";
import { pushToast } from "@/lib/toast";
import type { User } from "@/types/api";
import {
  useApproveSchedulingOverrideRequest,
  useCancelSchedulingOverrideRequest,
  useRejectSchedulingOverrideRequest,
  useSchedulingOverrideRequests,
} from "../api";
import type { SchedulingOverrideRequestDto, SchedulingOverrideRequestStatus, SchedulingOverrideType } from "../types";
import {
  canRoleApproveSchedulingOverride,
  formatOverrideType,
  formatRequestType,
  overrideFailureMessage,
} from "../utils/scheduling-override-requests";

const STATUS_OPTIONS: Array<SchedulingOverrideRequestStatus | ""> = ["", "pending", "approved", "rejected", "cancelled", "failed", "expired"];
const REQUEST_TYPE_OPTIONS = ["", "create_booking", "reschedule_booking"] as const;
const OVERRIDE_TYPE_OPTIONS: Array<SchedulingOverrideType | ""> = ["", "closed_weekday_override", "category_override", "total_capacity_override"];

export function SchedulingOverrideApprovalCenter({ user }: { user: User | null }) {
  const [open, setOpen] = useState(false);
  const badgeQuery = useSchedulingOverrideRequests({ status: "pending" });

  const actionableCount = badgeQuery.data?.requests.filter((request) => {
    if (user?.role === "receptionist") return Number(request.requesterUserId) === Number(user.id);
    if (user?.role === "supervisor") return canRoleApproveSchedulingOverride(user.role, request.overrideType);
    return user?.role === "super_admin";
  }).length ?? 0;

  if (!user) return null;

  return (
    <>
      <button
        type="button"
        className="btn-ghost relative"
        onClick={() => setOpen(true)}
        aria-label="Override requests"
      >
        <Bell className="h-4 w-4" />
        {actionableCount > 0 ? (
          <span className="absolute -right-1 -top-1 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
            {actionableCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="absolute bottom-0 right-0 top-0 flex w-full max-w-xl flex-col border-l border-border bg-background shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <h2 className="text-base font-semibold text-foreground">Override requests</h2>
                <p className="text-xs text-muted-foreground">Pending override requests are not confirmed bookings.</p>
              </div>
              <button type="button" className="btn-ghost" onClick={() => setOpen(false)} aria-label="Close override requests">
                <X className="h-4 w-4" />
              </button>
            </div>

            <SchedulingOverrideRequestsWorkspace user={user} variant="drawer" />
          </aside>
        </div>
      ) : null}
    </>
  );
}

export function SchedulingOverrideRequestsWorkspace({
  user,
  variant = "page",
}: {
  user: User | null;
  variant?: "page" | "drawer";
}) {
  const defaultStatus: SchedulingOverrideRequestStatus | undefined =
    user?.role === "supervisor" || user?.role === "super_admin" ? "pending" : undefined;
  const [status, setStatus] = useState<SchedulingOverrideRequestStatus | "">(defaultStatus ?? "");
  const [requestType, setRequestType] = useState<(typeof REQUEST_TYPE_OPTIONS)[number]>("");
  const [overrideType, setOverrideType] = useState<SchedulingOverrideType | "">("");
  const [requestedDate, setRequestedDate] = useState("");

  const listFilters = {
    ...(status ? { status } : {}),
    ...(requestType ? { requestType } : {}),
    ...(overrideType ? { overrideType } : {}),
    ...(requestedDate ? { requestedBookingDate: requestedDate } : {}),
  };
  const listQuery = useSchedulingOverrideRequests(listFilters);
  const approveMutation = useApproveSchedulingOverrideRequest();
  const rejectMutation = useRejectSchedulingOverrideRequest();
  const cancelMutation = useCancelSchedulingOverrideRequest();
  const [rejectingId, setRejectingId] = useState<number | string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [approveReasonById, setApproveReasonById] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<string | null>(null);

  const requests = useMemo(() => listQuery.data?.requests ?? [], [listQuery.data?.requests]);

  if (!user) return null;

  async function approve(request: SchedulingOverrideRequestDto) {
    setActionError(null);
    try {
      await approveMutation.mutateAsync({
        id: request.id,
        approverReason: approveReasonById[String(request.id)] || null,
      });
      pushToast({ type: "success", title: "Override request approved", message: "Appointment state has been updated." });
    } catch (error) {
      const message = error instanceof Error ? overrideFailureMessage(error.message) : "Approval failed.";
      setActionError(message);
      pushToast({ type: "error", title: "Approval failed", message });
    }
  }

  async function reject(request: SchedulingOverrideRequestDto) {
    if (!rejectReason.trim()) {
      setActionError("Rejection reason is required.");
      return;
    }
    setActionError(null);
    try {
      await rejectMutation.mutateAsync({ id: request.id, approverReason: rejectReason.trim() });
      setRejectingId(null);
      setRejectReason("");
      pushToast({ type: "success", title: "Override request rejected", message: "The requester can see the rejection." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Rejection failed.";
      setActionError(message);
      pushToast({ type: "error", title: "Rejection failed", message });
    }
  }

  async function cancel(request: SchedulingOverrideRequestDto) {
    setActionError(null);
    try {
      await cancelMutation.mutateAsync(request.id);
      pushToast({ type: "success", title: "Override request cancelled", message: "The pending request was cancelled." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cancellation failed.";
      setActionError(message);
      pushToast({ type: "error", title: "Cancellation failed", message });
    }
  }

  return (
    <div className={variant === "page" ? "space-y-4" : "flex min-h-0 flex-1 flex-col"}>
      <div className={`grid grid-cols-2 gap-2 ${variant === "drawer" ? "border-b border-border p-3 sm:grid-cols-4" : "rounded-2xl border border-border bg-card p-3 shadow-sm sm:grid-cols-4"}`}>
        <select aria-label="Override request status filter" className="input-premium h-9 text-xs" value={status} onChange={(e) => setStatus(e.target.value as SchedulingOverrideRequestStatus | "")}>
          {STATUS_OPTIONS.map((value) => <option key={value || "all"} value={value}>{value || "All statuses"}</option>)}
        </select>
        <select aria-label="Override request type filter" className="input-premium h-9 text-xs" value={requestType} onChange={(e) => setRequestType(e.target.value as typeof requestType)}>
          {REQUEST_TYPE_OPTIONS.map((value) => <option key={value || "all"} value={value}>{value ? formatRequestType(value) : "All request types"}</option>)}
        </select>
        <select aria-label="Override type filter" className="input-premium h-9 text-xs" value={overrideType} onChange={(e) => setOverrideType(e.target.value as SchedulingOverrideType | "")}>
          {OVERRIDE_TYPE_OPTIONS.map((value) => <option key={value || "all"} value={value}>{value ? formatOverrideType(value) : "All override types"}</option>)}
        </select>
        <input aria-label="Override requested date filter" type="date" className="input-premium h-9 text-xs" value={requestedDate} onChange={(e) => setRequestedDate(e.target.value)} />
      </div>

      {actionError ? (
        <div className={`${variant === "drawer" ? "mx-3 mt-3" : ""} rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700`}>
          {actionError}
        </div>
      ) : null}

      <div className={variant === "drawer" ? "flex-1 overflow-y-auto p-3" : ""}>
        {listQuery.isLoading ? (
          <p className="p-4 text-sm text-muted-foreground">Loading override requests...</p>
        ) : requests.length === 0 ? (
          <p className="rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">No override requests found.</p>
        ) : (
          <div className={variant === "page" ? "grid gap-3 lg:grid-cols-2" : "space-y-3"}>
            {requests.map((request) => (
              <RequestCard
                key={String(request.id)}
                request={request}
                user={user}
                approveReason={approveReasonById[String(request.id)] ?? ""}
                onChangeApproveReason={(value) => setApproveReasonById((current) => ({ ...current, [String(request.id)]: value }))}
                rejecting={rejectingId === request.id}
                rejectReason={rejectReason}
                onStartReject={() => {
                  setRejectingId(request.id);
                  setRejectReason("");
                  setActionError(null);
                }}
                onChangeRejectReason={setRejectReason}
                onApprove={() => approve(request)}
                onReject={() => reject(request)}
                onCancelReject={() => setRejectingId(null)}
                onCancel={() => cancel(request)}
                busy={approveMutation.isPending || rejectMutation.isPending || cancelMutation.isPending}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RequestCard({
  request,
  user,
  approveReason,
  onChangeApproveReason,
  rejecting,
  rejectReason,
  onStartReject,
  onChangeRejectReason,
  onApprove,
  onReject,
  onCancelReject,
  onCancel,
  busy,
}: {
  request: SchedulingOverrideRequestDto;
  user: User;
  approveReason: string;
  onChangeApproveReason: (value: string) => void;
  rejecting: boolean;
  rejectReason: string;
  onStartReject: () => void;
  onChangeRejectReason: (value: string) => void;
  onApprove: () => void;
  onReject: () => void;
  onCancelReject: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const isPending = request.status === "pending";
  const canApprove = isPending && canRoleApproveSchedulingOverride(user.role, request.overrideType);
  const isOwn = Number(request.requesterUserId) === Number(user.id);
  const canCancel = isPending && (isOwn || user.role === "supervisor" || user.role === "super_admin");
  const isSupervisorBlockedTotal = isPending && user.role === "supervisor" && request.overrideType === "total_capacity_override";

  return (
    <article className="rounded-2xl border border-border bg-card p-3 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={request.status === "failed" ? "error" : request.status === "pending" ? "warning" : request.status === "approved" ? "success" : "neutral"} size="sm">
            {request.status}
          </Badge>
          <Badge variant="info" size="sm">{formatOverrideType(request.overrideType)}</Badge>
        </div>
        <span className="text-[11px] text-muted-foreground">{new Date(request.createdAt).toLocaleString()}</span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <Info
          label="Patient"
          value={request.patientDisplayName || `Patient #${request.patientId}`}
          meta={request.patientIdentifier ? `${request.patientIdentifier} · ID ${request.patientId}` : `ID ${request.patientId}`}
        />
        <Info
          label="Modality"
          value={request.modalityName || request.modalityCode || `Modality #${request.modalityId}`}
          meta={request.modalityCode ? `${request.modalityCode} · ID ${request.modalityId}` : `ID ${request.modalityId}`}
        />
        <Info
          label="Exam"
          value={request.examTypeName || (request.examTypeId ? `Exam #${request.examTypeId}` : "—")}
          meta={request.examTypeId ? `ID ${request.examTypeId}` : undefined}
        />
        <Info label="Date/time" value={`${request.requestedBookingDate}${request.requestedBookingTime ? ` ${request.requestedBookingTime}` : ""}`} />
        <Info label="Request type" value={formatRequestType(request.requestType)} />
        <Info
          label="Requester"
          value={request.requesterDisplayName || request.requesterUsername || `User #${request.requesterUserId}`}
          meta={request.requesterUsername ? `${request.requesterUsername} · ID ${request.requesterUserId}` : `ID ${request.requesterUserId}`}
        />
        {request.approverUserId ? (
          <Info
            label="Approver"
            value={request.approverDisplayName || request.approverUsername || `User #${request.approverUserId}`}
            meta={request.approverUsername ? `${request.approverUsername} · ID ${request.approverUserId}` : `ID ${request.approverUserId}`}
          />
        ) : null}
      </div>

      <p className="mt-3 text-sm text-foreground">{request.requesterReason}</p>
      {request.failureMessage ? (
        <p className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {overrideFailureMessage(request.failureMessage)}
        </p>
      ) : null}
      {isSupervisorBlockedTotal ? (
        <p className="mt-2 text-xs text-muted-foreground">Supervisor cannot approve total capacity overrides. Superadmin approval is required.</p>
      ) : null}

      {canApprove ? (
        <div className="mt-3 space-y-2">
          <input
            aria-label={`Approval note for request ${request.id}`}
            className="input-premium h-9 text-xs"
            value={approveReason}
            onChange={(event) => onChangeApproveReason(event.target.value)}
            placeholder="Optional approval note"
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" size="sm" onClick={onApprove} disabled={busy}>Approve</Button>
            <Button type="button" size="sm" variant="secondary" onClick={onStartReject} disabled={busy}>Reject</Button>
          </div>
        </div>
      ) : null}

      {rejecting ? (
        <div className="mt-3 rounded-xl border border-border bg-muted/30 p-2">
          <textarea
            aria-label={`Rejection reason for request ${request.id}`}
            className="input-premium w-full resize-none text-xs"
            rows={2}
            value={rejectReason}
            onChange={(event) => onChangeRejectReason(event.target.value)}
            placeholder="Rejection reason is required"
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={onCancelReject} disabled={busy}>Keep pending</Button>
            <Button type="button" size="sm" onClick={onReject} disabled={busy}>Confirm rejection</Button>
          </div>
        </div>
      ) : null}

      {!canApprove && canCancel ? (
        <div className="mt-3 flex justify-end">
          <Button type="button" size="sm" variant="secondary" onClick={onCancel} disabled={busy}>Cancel request</Button>
        </div>
      ) : null}
    </article>
  );
}

function Info({ label, value, meta }: { label: string; value: string; meta?: string }) {
  return (
    <div className="rounded-lg bg-muted/40 p-2">
      <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
      <p className="truncate text-xs font-medium text-foreground">{value}</p>
      {meta ? <p className="truncate text-[10px] text-muted-foreground">{meta}</p> : null}
    </div>
  );
}
