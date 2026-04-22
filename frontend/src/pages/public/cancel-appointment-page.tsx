import { type ReactNode, useMemo, useState } from "react";
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

function formatBookingStatusAr(status: string): string {
  const map: Record<string, string> = {
    scheduled: "مجدول",
    arrived: "وصل",
    waiting: "في الانتظار",
    completed: "مكتمل",
    cancelled: "ملغي",
    "no-show": "لم يحضر",
    discontinued: "متوقف",
  };
  return map[status] ?? status;
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
    <div className={`rounded-2xl border p-4 shadow-sm ${toneClass}`}>
      <h2 className="text-base font-bold">{props.title}</h2>
      <p className="mt-1 text-sm leading-7">{props.message}</p>
    </div>
  );
}

function PublicPageFrame(props: { children: ReactNode }) {
  return (
    <main
      dir="rtl"
      className="min-h-screen bg-gradient-to-b from-rose-50 via-white to-slate-50 px-4 py-8 text-slate-900"
      style={{ fontFamily: "'Tajawal', 'Cairo', 'Noto Kufi Arabic', sans-serif" }}
    >
      <div className="mx-auto w-full max-w-xl space-y-4">{props.children}</div>
    </main>
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
      <PublicPageFrame>
        <StatusCard
          tone="danger"
          title="رابط الإلغاء غير صالح"
          message="الرابط لا يحتوي على معلومات كافية."
        />
      </PublicPageFrame>
    );
  }

  if (previewQuery.isLoading) {
    return (
      <PublicPageFrame>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-slate-600">جاري تحميل بيانات الموعد...</p>
        </div>
      </PublicPageFrame>
    );
  }

  if (previewQuery.isError) {
    const state = classifyLinkError(previewQuery.error);
    const title =
      state === "expired"
        ? "انتهت صلاحية رابط الإلغاء"
        : state === "unavailable"
          ? "خدمة الإلغاء غير متاحة مؤقتًا"
          : "رابط الإلغاء غير صالح";
    const message =
      state === "expired"
        ? "انتهت صلاحية هذا الرابط. يرجى التواصل مع الاستقبال لإلغاء الموعد."
        : state === "unavailable"
          ? "يرجى التواصل مع قسم الاستقبال للمساعدة."
          : "الرابط غير صالح أو تم التلاعب به.";

    return (
      <PublicPageFrame>
        <StatusCard tone="danger" title={title} message={message} />
      </PublicPageFrame>
    );
  }

  const preview = previewQuery.data;
  if (!preview) {
    return (
      <PublicPageFrame>
        <StatusCard
          tone="danger"
          title="تعذر تحميل بيانات الموعد"
          message="لا يمكن عرض معلومات الموعد لهذا الرابط."
        />
      </PublicPageFrame>
    );
  }

  return (
    <PublicPageFrame>
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-lg shadow-slate-200/60">
        <div className="mb-4 flex items-center gap-3 border-b border-slate-100 pb-4">
          <img src="/assets/nccb-logo.png" alt="NCCB Logo" className="h-14 w-14 rounded-xl object-contain" />
          <div>
            <p className="text-sm font-bold text-rose-700">المركز الوطني لعلاج الأورام - بنغازي</p>
            <h1 className="text-lg font-extrabold text-slate-900">إلغاء الموعد</h1>
            <p className="text-xs text-slate-500">قسم الأشعة التشخيصية</p>
          </div>
        </div>

        {result ? (
          <div className="mt-4 space-y-3">
            {result.alreadyCancelled ? (
              <StatusCard
                title="تم إلغاء الموعد مسبقًا"
                message="هذا الموعد تم إلغاؤه من قبل."
                tone="neutral"
              />
            ) : (
              <StatusCard
                title="تم إلغاء الموعد بنجاح"
                message="تم تسجيل طلب الإلغاء بنجاح."
                tone="success"
              />
            )}
          </div>
        ) : (
          <>
            <div className="mt-4 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              <p><strong>اسم المريض:</strong> {preview.patientDisplayName}</p>
              <p><strong>تاريخ الموعد:</strong> {preview.bookingDate}</p>
              <p><strong>الجهاز:</strong> {preview.modalityName}</p>
              <p><strong>نوع الفحص:</strong> {preview.examName}</p>
              <p><strong>الحالة الحالية:</strong> {formatBookingStatusAr(preview.currentStatus)}</p>
            </div>

            <p className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              تنبيه: لا يمكن التراجع عن الإلغاء بعد التأكيد.
            </p>

            {cancelMutation.isError ? (
              <StatusCard
                tone="danger"
                title="تعذر إلغاء الموعد"
                message="يرجى المحاولة مرة أخرى أو التواصل مع الاستقبال."
              />
            ) : null}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700"
                onClick={() => navigate(-1)}
              >
                رجوع
              </button>
              <button
                type="button"
                className="flex-1 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                disabled={cancelMutation.isPending}
                onClick={() => cancelMutation.mutate()}
              >
                {cancelMutation.isPending ? "جاري الإلغاء..." : "تأكيد الإلغاء"}
              </button>
            </div>
          </>
        )}
      </div>
    </PublicPageFrame>
  );
}
