import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ApiError } from "@/lib/api-client";
import {
  cancelPublicAppointment,
  fetchPublicAppointmentCancelPreview,
  type PublicAppointmentCancelResult,
} from "@/lib/api-hooks";

type LinkErrorState = "invalid" | "expired" | "unavailable";

function classifyLinkError(error: unknown): LinkErrorState {
  if (!(error instanceof ApiError)) {
    return "invalid";
  }

  const details = (error.details ?? {}) as { code?: string };
  const code = String(details.code || "");
  if (code === "expired_link") {
    return "expired";
  }
  if (code === "public_cancel_not_configured" || error.status === 503) {
    return "unavailable";
  }
  return "invalid";
}

function StatusCard(props: { title: string; message: string; tone?: "neutral" | "success" | "danger" }) {
  const tone = props.tone ?? "neutral";
  const toneClass =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : tone === "danger"
        ? "border-rose-200 bg-rose-50 text-rose-900"
        : "border-slate-200 bg-white text-slate-900";

  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <h2 className="text-lg font-semibold">{props.title}</h2>
      <p className="mt-1 text-sm leading-6">{props.message}</p>
    </div>
  );
}

export default function PublicCancelAppointmentPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [result, setResult] = useState<PublicAppointmentCancelResult | null>(null);
  const token = useMemo(() => String(searchParams.get("t") || "").trim(), [searchParams]);

  const previewQuery = useQuery({
    queryKey: ["public-cancel-preview", token],
    queryFn: () => fetchPublicAppointmentCancelPreview(token),
    enabled: token.length > 0,
    retry: false,
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelPublicAppointment(token),
    onSuccess: (value) => {
      setResult(value);
    },
  });

  if (!token) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="mx-auto w-full max-w-md space-y-4">
          <StatusCard
            tone="danger"
            title="Invalid cancellation link"
            message="This link is missing required information."
          />
        </div>
      </main>
    );
  }

  if (previewQuery.isLoading) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="mx-auto w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-600">Loading appointment details...</p>
        </div>
      </main>
    );
  }

  if (previewQuery.isError) {
    const state = classifyLinkError(previewQuery.error);
    const title =
      state === "expired"
        ? "Cancellation link expired"
        : state === "unavailable"
          ? "Cancellation temporarily unavailable"
          : "Invalid cancellation link";
    const message =
      state === "expired"
        ? "This link has expired. Please contact the hospital to cancel your appointment."
        : state === "unavailable"
          ? "Please contact the hospital reception desk for help."
          : "This link is invalid or has been tampered with.";

    return (
      <main className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="mx-auto w-full max-w-md space-y-4">
          <StatusCard tone="danger" title={title} message={message} />
        </div>
      </main>
    );
  }

  const preview = previewQuery.data;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto w-full max-w-md space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h1 className="text-xl font-bold text-slate-900">Cancel Appointment</h1>
          <p className="mt-1 text-sm text-slate-600">Please review your appointment before confirmation.</p>

          {result ? (
            <div className="mt-4 space-y-3">
              {result.alreadyCancelled ? (
                <StatusCard
                  title="Appointment already cancelled"
                  message="This appointment was already cancelled earlier."
                  tone="neutral"
                />
              ) : (
                <StatusCard
                  title="Appointment cancelled"
                  message="Your appointment has been cancelled successfully."
                  tone="success"
                />
              )}
            </div>
          ) : (
            <>
              <div className="mt-4 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                <p><strong>Patient:</strong> {preview.patientDisplayName}</p>
                <p><strong>Date:</strong> {preview.bookingDate}</p>
                <p><strong>Modality:</strong> {preview.modalityName}</p>
                <p><strong>Exam:</strong> {preview.examName}</p>
                <p><strong>Status:</strong> {preview.currentStatus}</p>
              </div>

              <p className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                Warning: cancellation cannot be undone.
              </p>

              {cancelMutation.isError ? (
                <StatusCard
                  tone="danger"
                  title="Cancellation failed"
                  message="Please try again or contact the hospital reception desk."
                />
              ) : null}

              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700"
                  onClick={() => navigate(-1)}
                >
                  Back
                </button>
                <button
                  type="button"
                  className="flex-1 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  disabled={cancelMutation.isPending}
                  onClick={() => cancelMutation.mutate()}
                >
                  {cancelMutation.isPending ? "Cancelling..." : "Confirm cancellation"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
