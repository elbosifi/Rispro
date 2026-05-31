import { useEffect, useMemo, useState } from "react";
import { Bell, X } from "lucide-react";
import { SupervisorReAuthModal } from "@/components/auth/supervisor-reauth-modal";
import { Button, Badge } from "@/components/shared";
import { t } from "@/lib/i18n";
import { pushToast } from "@/lib/toast";
import { useLanguage } from "@/providers/language-provider";
import type { User } from "@/types/api";
import {
  useApproveSchedulingOverrideRequest,
  useCancelSchedulingOverrideRequest,
  useRejectSchedulingOverrideRequest,
  useSendUserTestPush,
  useSubscribeUserPush,
  useSchedulingOverrideRequests,
  useUnsubscribeUserPush,
  useUserPushConfig,
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
const OVERRIDE_TYPE_OPTIONS: Array<SchedulingOverrideType | ""> = ["", "closed_weekday_override", "category_override", "exam_mix_override", "total_capacity_override"];

function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function urlBase64ToUint8Array(value: string): ArrayBuffer {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) output[index] = raw.charCodeAt(index);
  return output.buffer;
}

export function SchedulingOverrideApprovalCenter({ user }: { user: User | null }) {
  const { language } = useLanguage();
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
        aria-label={t(language, "overrideRequests.title")}
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
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-foreground">Override notifications</h2>
                  {actionableCount > 0 ? <Badge variant="error" size="sm">{actionableCount}</Badge> : null}
                </div>
                <p className="text-xs text-muted-foreground">Browser alerts and pending override requests in one drawer.</p>
              </div>
              <button type="button" className="btn-ghost" onClick={() => setOpen(false)} aria-label={t(language, "overrideRequests.close")}>
                <X className="h-4 w-4" />
              </button>
            </div>

            <OverridePushControls enabled={open} userId={Number(user.id)} />
            <SchedulingOverrideRequestsWorkspace user={user} variant="drawer" />
          </aside>
        </div>
      ) : null}
    </>
  );
}

function OverridePushControls({ enabled, userId }: { enabled: boolean; userId: number }) {
  const configQuery = useUserPushConfig(enabled);
  const subscribeMutation = useSubscribeUserPush();
  const unsubscribeMutation = useUnsubscribeUserPush();
  const testMutation = useSendUserTestPush();
  const supported = pushSupported();
  const [message, setMessage] = useState<string | null>(null);
  const [currentBrowserSubscribed, setCurrentBrowserSubscribed] = useState(false);
  const [checkingBrowser, setCheckingBrowser] = useState(false);
  const storageKey = `rispro-override-push-enabled:${userId}`;

  useEffect(() => {
    let cancelled = false;

    async function readCurrentSubscription() {
      if (!enabled || !supported) return;
      setCheckingBrowser(true);
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = await registration?.pushManager.getSubscription();
        if (!subscription) localStorage.removeItem(storageKey);
        if (!cancelled) setCurrentBrowserSubscribed(Boolean(subscription && localStorage.getItem(storageKey) === "1"));
      } catch {
        if (!cancelled) setCurrentBrowserSubscribed(false);
      } finally {
        if (!cancelled) setCheckingBrowser(false);
      }
    }

    void readCurrentSubscription();
    return () => {
      cancelled = true;
    };
  }, [enabled, supported, configQuery.data?.subscribed, storageKey]);

  const config = configQuery.data;
  const setupAvailable = Boolean(supported && config?.enabled && config.publicKey);
  const busy = subscribeMutation.isPending || unsubscribeMutation.isPending || testMutation.isPending;
  const statusText = !supported
    ? "Browser notifications are not supported in this browser."
    : configQuery.isLoading || checkingBrowser
      ? "Checking browser notification setup..."
      : !config?.enabled || !config.publicKey
        ? "Browser notification setup is not available yet."
        : currentBrowserSubscribed
          ? "Enabled on this browser."
          : config.subscribed
            ? "Enabled on another device. Enable this browser to receive alerts here."
            : "Enable alerts for override request updates.";

  async function enableThisBrowser() {
    setMessage(null);
    try {
      if (!config?.publicKey) throw new Error("Browser notification setup is not available yet.");
      if (!pushSupported()) throw new Error("Browser notifications are not supported in this browser.");
      const permission = window.Notification.permission === "granted"
        ? "granted"
        : await window.Notification.requestPermission();
      if (permission !== "granted") throw new Error("Notification permission was not granted.");
      const registration = await navigator.serviceWorker.register("/rispro-push-sw.js");
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.publicKey),
      });
      await subscribeMutation.mutateAsync(subscription.toJSON());
      localStorage.setItem(storageKey, "1");
      setCurrentBrowserSubscribed(true);
      setMessage("Browser notifications enabled on this browser.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not enable browser notifications.");
    }
  }

  async function disableThisBrowser() {
    setMessage(null);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription) {
        setCurrentBrowserSubscribed(false);
        setMessage("This browser is not subscribed.");
        return;
      }
      await unsubscribeMutation.mutateAsync(subscription.toJSON());
      await subscription.unsubscribe();
      localStorage.removeItem(storageKey);
      setCurrentBrowserSubscribed(false);
      setMessage("Browser notifications disabled on this browser.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not disable browser notifications.");
    }
  }

  async function sendTest() {
    setMessage(null);
    try {
      const result = await testMutation.mutateAsync();
      setMessage(result.sent > 0 ? "Test notification sent." : "No active browser subscription found.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not send test notification.");
    }
  }

  return (
    <section className="border-b border-border px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Browser notifications</h3>
          <p className="mt-1 text-xs text-muted-foreground">{statusText}</p>
        </div>
        {currentBrowserSubscribed ? <Badge variant="success" size="sm">Enabled</Badge> : null}
      </div>
      {message ? <p className="mt-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">{message}</p> : null}
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Button
          type="button"
          variant={currentBrowserSubscribed ? "secondary" : "primary"}
          onClick={currentBrowserSubscribed ? disableThisBrowser : enableThisBrowser}
          disabled={busy || checkingBrowser || (currentBrowserSubscribed ? !supported : !setupAvailable)}
        >
          {currentBrowserSubscribed ? "Disable this browser" : "Enable this browser"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={sendTest}
          disabled={busy || (!config?.subscribed && !currentBrowserSubscribed)}
        >
          Send test notification
        </Button>
      </div>
    </section>
  );
}

export function SchedulingOverrideRequestsWorkspace({
  user,
  variant = "page",
}: {
  user: User | null;
  variant?: "page" | "drawer";
}) {
  const { language } = useLanguage();
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
  const [pendingReauthAction, setPendingReauthAction] = useState<null | (() => void)>(null);

  const requests = useMemo(() => listQuery.data?.requests ?? [], [listQuery.data?.requests]);

  if (!user) return null;

  async function approveAfterReauth(request: SchedulingOverrideRequestDto) {
    setActionError(null);
    try {
      await approveMutation.mutateAsync({
        id: request.id,
        approverReason: approveReasonById[String(request.id)] || null,
      });
      pushToast({ type: "success", title: t(language, "overrideRequests.approvedTitle"), message: t(language, "overrideRequests.approvedMessage") });
    } catch (error) {
      const message = error instanceof Error ? overrideFailureMessage(error.message) : t(language, "overrideRequests.approvalFailed");
      setActionError(message);
      pushToast({ type: "error", title: t(language, "overrideRequests.approvalFailed"), message });
    }
  }

  function approve(request: SchedulingOverrideRequestDto) {
    setPendingReauthAction(() => () => void approveAfterReauth(request));
  }

  async function rejectAfterReauth(request: SchedulingOverrideRequestDto) {
    setActionError(null);
    try {
      await rejectMutation.mutateAsync({ id: request.id, approverReason: rejectReason.trim() });
      setRejectingId(null);
      setRejectReason("");
      pushToast({ type: "success", title: t(language, "overrideRequests.rejectedTitle"), message: t(language, "overrideRequests.rejectedMessage") });
    } catch (error) {
      const message = error instanceof Error ? error.message : t(language, "overrideRequests.rejectionFailed");
      setActionError(message);
      pushToast({ type: "error", title: t(language, "overrideRequests.rejectionFailed"), message });
    }
  }

  function reject(request: SchedulingOverrideRequestDto) {
    if (!rejectReason.trim()) {
      setActionError(t(language, "overrideRequests.rejectionReasonRequired"));
      return;
    }
    setPendingReauthAction(() => () => void rejectAfterReauth(request));
  }

  async function cancel(request: SchedulingOverrideRequestDto) {
    setActionError(null);
    try {
      await cancelMutation.mutateAsync(request.id);
      pushToast({ type: "success", title: t(language, "overrideRequests.cancelledTitle"), message: t(language, "overrideRequests.cancelledMessage") });
    } catch (error) {
      const message = error instanceof Error ? error.message : t(language, "overrideRequests.cancellationFailed");
      setActionError(message);
      pushToast({ type: "error", title: t(language, "overrideRequests.cancellationFailed"), message });
    }
  }

  return (
    <div className={variant === "page" ? "space-y-4" : "flex min-h-0 flex-1 flex-col"}>
      <div className={`grid grid-cols-2 gap-2 ${variant === "drawer" ? "border-b border-border p-3 sm:grid-cols-4" : "rounded-2xl border border-border bg-card p-3 shadow-sm sm:grid-cols-4"}`}>
        <select aria-label={t(language, "overrideRequests.statusFilter")} className="input-premium h-9 text-xs" value={status} onChange={(e) => setStatus(e.target.value as SchedulingOverrideRequestStatus | "")}>
          {STATUS_OPTIONS.map((value) => <option key={value || "all"} value={value}>{value || t(language, "calendar.allStatuses")}</option>)}
        </select>
        <select aria-label={t(language, "overrideRequests.requestTypeFilter")} className="input-premium h-9 text-xs" value={requestType} onChange={(e) => setRequestType(e.target.value as typeof requestType)}>
          {REQUEST_TYPE_OPTIONS.map((value) => <option key={value || "all"} value={value}>{value ? formatRequestType(value) : t(language, "overrideRequests.allRequestTypes")}</option>)}
        </select>
        <select aria-label={t(language, "overrideRequests.overrideTypeFilter")} className="input-premium h-9 text-xs" value={overrideType} onChange={(e) => setOverrideType(e.target.value as SchedulingOverrideType | "")}>
          {OVERRIDE_TYPE_OPTIONS.map((value) => <option key={value || "all"} value={value}>{value ? formatOverrideType(value) : t(language, "overrideRequests.allOverrideTypes")}</option>)}
        </select>
        <input aria-label={t(language, "overrideRequests.requestedDateFilter")} type="date" className="input-premium h-9 text-xs" value={requestedDate} onChange={(e) => setRequestedDate(e.target.value)} />
      </div>

      {actionError ? (
        <div className={`${variant === "drawer" ? "mx-3 mt-3" : ""} rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700`}>
          {actionError}
        </div>
      ) : null}

      <div className={variant === "drawer" ? "flex-1 overflow-y-auto p-3" : ""}>
        {listQuery.isLoading ? (
          <p className="p-4 text-sm text-muted-foreground">{t(language, "overrideRequests.loading")}</p>
        ) : requests.length === 0 ? (
          <p className="rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">{t(language, "overrideRequests.empty")}</p>
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
      {pendingReauthAction ? (
        <SupervisorReAuthModal
          onClose={() => setPendingReauthAction(null)}
          onSuccess={() => {
            const action = pendingReauthAction;
            setPendingReauthAction(null);
            action?.();
          }}
        />
      ) : null}
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
  const { language } = useLanguage();
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
          label={t(language, "overrideRequests.patient")}
          value={request.patientDisplayName || t(language, "overrideRequests.patientFallback", { id: request.patientId })}
          meta={request.patientIdentifier ? `${request.patientIdentifier} · ${t(language, "overrideRequests.idMeta", { id: request.patientId })}` : t(language, "overrideRequests.idMeta", { id: request.patientId })}
        />
        <Info
          label={t(language, "overrideRequests.modality")}
          value={request.modalityName || request.modalityCode || t(language, "overrideRequests.modalityFallback", { id: request.modalityId })}
          meta={request.modalityCode ? `${request.modalityCode} · ${t(language, "overrideRequests.idMeta", { id: request.modalityId })}` : t(language, "overrideRequests.idMeta", { id: request.modalityId })}
        />
        <Info
          label={t(language, "overrideRequests.exam")}
          value={request.examTypeName || (request.examTypeId ? t(language, "overrideRequests.examFallback", { id: request.examTypeId }) : "—")}
          meta={request.examTypeId ? t(language, "overrideRequests.idMeta", { id: request.examTypeId }) : undefined}
        />
        <Info label={t(language, "overrideRequests.dateTime")} value={`${request.requestedBookingDate}${request.requestedBookingTime ? ` ${request.requestedBookingTime}` : ""}`} />
        <Info label={t(language, "overrideRequests.requestType")} value={formatRequestType(request.requestType)} />
        <Info
          label={t(language, "overrideRequests.requester")}
          value={request.requesterDisplayName || request.requesterUsername || t(language, "overrideRequests.userFallback", { id: request.requesterUserId })}
          meta={request.requesterUsername ? `${request.requesterUsername} · ${t(language, "overrideRequests.idMeta", { id: request.requesterUserId })}` : t(language, "overrideRequests.idMeta", { id: request.requesterUserId })}
        />
        {request.approverUserId ? (
          <Info
            label={t(language, "overrideRequests.approver")}
            value={request.approverDisplayName || request.approverUsername || t(language, "overrideRequests.userFallback", { id: request.approverUserId })}
            meta={request.approverUsername ? `${request.approverUsername} · ${t(language, "overrideRequests.idMeta", { id: request.approverUserId })}` : t(language, "overrideRequests.idMeta", { id: request.approverUserId })}
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
        <p className="mt-2 text-xs text-muted-foreground">{t(language, "overrideRequests.supervisorTotalCapacityBlocked")}</p>
      ) : null}

      {canApprove ? (
        <div className="mt-3 space-y-2">
          <input
            aria-label={t(language, "overrideRequests.approvalNoteForRequest", { id: request.id })}
            className="input-premium h-9 text-xs"
            value={approveReason}
            onChange={(event) => onChangeApproveReason(event.target.value)}
            placeholder={t(language, "overrideRequests.optionalApprovalNote")}
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" size="sm" onClick={onApprove} disabled={busy}>{t(language, "overrideRequests.approve")}</Button>
            <Button type="button" size="sm" variant="secondary" onClick={onStartReject} disabled={busy}>{t(language, "overrideRequests.reject")}</Button>
          </div>
        </div>
      ) : null}

      {rejecting ? (
        <div className="mt-3 rounded-xl border border-border bg-muted/30 p-2">
          <textarea
            aria-label={t(language, "overrideRequests.rejectionReasonForRequest", { id: request.id })}
            className="input-premium w-full resize-none text-xs"
            rows={2}
            value={rejectReason}
            onChange={(event) => onChangeRejectReason(event.target.value)}
            placeholder={t(language, "overrideRequests.rejectionReasonPlaceholder")}
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={onCancelReject} disabled={busy}>{t(language, "overrideRequests.keepPending")}</Button>
            <Button type="button" size="sm" onClick={onReject} disabled={busy}>{t(language, "overrideRequests.confirmRejection")}</Button>
          </div>
        </div>
      ) : null}

      {!canApprove && canCancel ? (
        <div className="mt-3 flex justify-end">
          <Button type="button" size="sm" variant="secondary" onClick={onCancel} disabled={busy}>{t(language, "overrideRequests.cancelRequest")}</Button>
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
