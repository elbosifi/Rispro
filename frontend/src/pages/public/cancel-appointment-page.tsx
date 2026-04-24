import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Home,
  Loader2,
  ShieldCheck,
  Users2,
} from "lucide-react";
import { ApiError } from "@/lib/api-client";
import {
  cancelPublicAppointment,
  fetchPublicAppointmentCancelPreview,
  type PublicAppointmentCancelPreview,
  type PublicAppointmentCancelResult,
} from "@/lib/api-hooks";

type LinkErrorState = "invalid" | "expired" | "unavailable";
type FlowState = "landing" | "confirm" | "success" | "already_cancelled" | "non_cancellable" | "error";

const INST_AR = "المركز الوطني لعلاج الأورام - بنغازي";
const DEPT_AR = "قسم الأشعة التشخيصية";

const CANCELLABLE_STATUSES = new Set(["scheduled", "arrived", "waiting"]);

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
    "in-progress": "قيد التنفيذ",
    completed: "مكتمل",
    cancelled: "ملغى",
    "no-show": "لم يحضر",
    discontinued: "متوقف",
  };
  return map[status] ?? status;
}

function formatDateAr(value: string): string {
  const normalized = value.includes("T") ? value : `${value}T12:00:00`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return value || "—";
  }

  try {
    return new Intl.DateTimeFormat("ar-LY", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(date);
  } catch {
    return value || "—";
  }
}

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "cancelled") return "danger";
  if (CANCELLABLE_STATUSES.has(status)) return "success";
  if (status === "completed" || status === "discontinued" || status === "no-show") return "warning";
  return "neutral";
}

function toneClasses(tone: "neutral" | "success" | "warning" | "danger" | "info") {
  switch (tone) {
    case "success":
      return "border-emerald-200 bg-emerald-50 text-emerald-900";
    case "warning":
      return "border-amber-200 bg-amber-50 text-amber-900";
    case "danger":
      return "border-rose-200 bg-rose-50 text-rose-900";
    case "info":
      return "border-sky-200 bg-sky-50 text-sky-900";
    default:
      return "border-slate-200 bg-white text-slate-900";
  }
}

function StatusBadge(props: { status: string; className?: string }) {
  const tone = statusTone(props.status);
  const label = formatBookingStatusAr(props.status);
  const className = props.className || "";
  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold ${toneClasses(tone)} ${className}`}>
      {label}
    </span>
  );
}

function Card(props: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`rounded-3xl border border-slate-200 bg-white shadow-sm ${props.className || ""}`}>{props.children}</div>;
}

function PageShell(props: { children: ReactNode }) {
  return (
    <main
      dir="rtl"
      className="min-h-screen bg-[radial-gradient(circle_at_top_right,_rgba(13,148,136,0.08),_transparent_32%),linear-gradient(180deg,#f8fafc_0%,#ffffff_100%)] px-4 py-5 text-slate-900 sm:py-8"
      style={{ fontFamily: "'Tajawal', 'Cairo', 'Noto Kufi Arabic', sans-serif" }}
    >
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4">{props.children}</div>
    </main>
  );
}

function Header() {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-100 bg-white px-4 py-4 sm:px-5">
        <div className="flex items-start gap-3">
          <img
            src="/assets/nccb-logo.png"
            alt="شعار المركز الوطني لعلاج الأورام - بنغازي"
            className="h-14 w-14 shrink-0 rounded-2xl object-contain ring-1 ring-slate-100"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-6 text-rose-700">{INST_AR}</p>
            <p className="text-base font-bold leading-6 text-slate-900">{DEPT_AR}</p>
            <p className="mt-1 text-xs text-slate-500">خدمة إلغاء موعد الأشعة عبر رمز QR</p>
          </div>
        </div>
      </div>
    </Card>
  );
}

function SectionTitle(props: { title: string; subtitle?: string }) {
  return (
    <div className="space-y-1">
      <h2 className="text-lg font-extrabold tracking-tight text-slate-900">{props.title}</h2>
      {props.subtitle ? <p className="text-sm leading-7 text-slate-600">{props.subtitle}</p> : null}
    </div>
  );
}

function AppointmentSummaryCard(props: { preview: PublicAppointmentCancelPreview; emphasizeStatus?: boolean }) {
  const { preview } = props;
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-500">تفاصيل الموعد</p>
          <h3 className="mt-1 text-lg font-extrabold text-slate-900">{preview.patientDisplayName}</h3>
        </div>
        <StatusBadge status={preview.currentStatus} />
      </div>

      <dl className="mt-4 space-y-3 text-sm">
        <div className="flex items-start justify-between gap-4">
          <dt className="min-w-[7rem] text-slate-500">اسم المريض</dt>
          <dd className="flex-1 text-left font-semibold text-slate-900 rtl:text-right">{preview.patientDisplayName}</dd>
        </div>
        <div className="flex items-start justify-between gap-4">
          <dt className="min-w-[7rem] text-slate-500">تاريخ الموعد</dt>
          <dd className="flex-1 text-left font-semibold text-slate-900 rtl:text-right">{formatDateAr(preview.bookingDate)}</dd>
        </div>
        <div className="flex items-start justify-between gap-4">
          <dt className="min-w-[7rem] text-slate-500">الجهاز</dt>
          <dd className="flex-1 text-left font-semibold text-slate-900 rtl:text-right">{preview.modalityName || "—"}</dd>
        </div>
        <div className="flex items-start justify-between gap-4">
          <dt className="min-w-[7rem] text-slate-500">نوع الفحص</dt>
          <dd className="flex-1 text-left font-semibold text-slate-900 rtl:text-right">{preview.examName || "—"}</dd>
        </div>
        <div className="flex items-start justify-between gap-4">
          <dt className="min-w-[7rem] text-slate-500">الحالة الحالية</dt>
          <dd className="flex-1 text-left rtl:text-right">
            <StatusBadge status={preview.currentStatus} className={props.emphasizeStatus ? "font-extrabold" : ""} />
          </dd>
        </div>
      </dl>
    </Card>
  );
}

function BenefitCard(props: { icon: ReactNode; title: string; description: string }) {
  return (
    <div className="flex gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-teal-700 shadow-sm ring-1 ring-teal-100">
        {props.icon}
      </div>
      <div className="min-w-0">
        <h4 className="text-sm font-bold leading-6 text-slate-900">{props.title}</h4>
        <p className="mt-1 text-sm leading-7 text-slate-600">{props.description}</p>
      </div>
    </div>
  );
}

function WarningBox(props: { title: string; body: string; tone?: "amber" | "rose" | "sky" }) {
  const tone = props.tone ?? "amber";
  const className =
    tone === "rose"
      ? "border-rose-200 bg-rose-50 text-rose-900"
      : tone === "sky"
        ? "border-sky-200 bg-sky-50 text-sky-900"
        : "border-amber-200 bg-amber-50 text-amber-900";

  return (
    <div className={`rounded-2xl border px-4 py-4 ${className}`}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-full bg-white/80 p-2">
          <AlertTriangle className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h4 className="text-sm font-extrabold leading-6">{props.title}</h4>
          <p className="mt-1 text-sm leading-7">{props.body}</p>
        </div>
      </div>
    </div>
  );
}

function FinalActionButton(props: {
  children: ReactNode;
  tone?: "primary" | "danger" | "neutral";
  disabled?: boolean;
  onClick: () => void;
  icon?: ReactNode;
}) {
  const tone = props.tone ?? "primary";
  const className =
    tone === "danger"
      ? "bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-500"
      : tone === "neutral"
        ? "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 focus-visible:ring-slate-400"
        : "bg-teal-600 text-white hover:bg-teal-700 focus-visible:ring-teal-500";

  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      className={`flex min-h-12 items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-extrabold shadow-sm transition focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {props.icon}
      <span>{props.children}</span>
    </button>
  );
}

export default function PublicCancelAppointmentPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [flowState, setFlowState] = useState<FlowState>("landing");
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<PublicAppointmentCancelResult | null>(null);

  const token = useMemo(() => String(searchParams.get("t") || "").trim(), [searchParams]);

  const previewQuery = useQuery({
    queryKey: ["public-cancel-preview", token],
    queryFn: () => fetchPublicAppointmentCancelPreview(token),
    enabled: token.length > 0,
    retry: false,
  });

  useEffect(() => {
    setFlowState("landing");
    setAcknowledged(false);
    setSubmitError(null);
    setOutcome(null);
  }, [token]);

  const cancelMutation = useMutation({
    mutationFn: () => cancelPublicAppointment(token),
    onSuccess: (value) => {
      setSubmitError(null);
      setOutcome(value);
      setFlowState(value.alreadyCancelled ? "already_cancelled" : "success");
    },
    onError: (error) => {
      const details = error instanceof ApiError ? ((error.details ?? {}) as { code?: string }) : {};
      const code = String(details.code || "");
      if (code === "booking_already_cancelled") {
        setOutcome({
          ok: true,
          alreadyCancelled: true,
          bookingId: previewQuery.data?.bookingId || 0,
          status: "cancelled",
        });
        setFlowState("already_cancelled");
        setSubmitError(null);
        return;
      }
      if (code === "booking_not_cancellable") {
        setFlowState("non_cancellable");
        setSubmitError(null);
        return;
      }

      setSubmitError("تعذر إلغاء الموعد الآن. يمكنك المحاولة مرة أخرى بأمان.");
    },
  });

  if (!token) {
    return (
      <PageShell>
        <Header />
        <Card className="p-5">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-rose-50 p-3 text-rose-700">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-extrabold text-slate-900">رابط غير صالح أو منتهي الصلاحية</h1>
              <p className="mt-2 text-sm leading-7 text-slate-600">الرابط لا يحتوي على معلومات كافية لعرض الموعد.</p>
            </div>
          </div>
          <div className="mt-5 flex gap-3">
            <FinalActionButton tone="neutral" onClick={() => navigate(-1)} icon={<ArrowLeft className="h-4 w-4" />}>
              رجوع
            </FinalActionButton>
            <FinalActionButton tone="primary" onClick={() => navigate("/")} icon={<Home className="h-4 w-4" />}>
              العودة للرئيسية
            </FinalActionButton>
          </div>
        </Card>
      </PageShell>
    );
  }

  if (previewQuery.isLoading) {
    return (
      <PageShell>
        <Header />
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-teal-600" />
            <p className="text-sm text-slate-600">جاري تحميل بيانات الموعد...</p>
          </div>
        </Card>
      </PageShell>
    );
  }

  if (previewQuery.isError) {
    const state = classifyLinkError(previewQuery.error);
    const title =
      state === "expired"
        ? "رابط غير صالح أو منتهي الصلاحية"
        : state === "unavailable"
          ? "خدمة الإلغاء غير متاحة مؤقتًا"
          : "رابط غير صالح أو منتهي الصلاحية";
    const message =
      state === "expired"
        ? "انتهت صلاحية هذا الرابط. يرجى التواصل مع قسم الأشعة."
        : state === "unavailable"
          ? "الخدمة غير متاحة حالياً. يرجى المحاولة لاحقاً أو التواصل مع القسم."
          : "تعذر التحقق من الرابط بأمان.";

    return (
      <PageShell>
        <Header />
        <Card className="p-5">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-rose-50 p-3 text-rose-700">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-extrabold text-slate-900">{title}</h1>
              <p className="mt-2 text-sm leading-7 text-slate-600">{message}</p>
            </div>
          </div>
          <div className="mt-5 flex gap-3">
            <FinalActionButton tone="neutral" onClick={() => navigate(-1)} icon={<ArrowLeft className="h-4 w-4" />}>
              رجوع
            </FinalActionButton>
            <FinalActionButton tone="primary" onClick={() => navigate("/")} icon={<Home className="h-4 w-4" />}>
              العودة للرئيسية
            </FinalActionButton>
          </div>
        </Card>
      </PageShell>
    );
  }

  const preview = previewQuery.data;
  if (!preview) {
    return (
      <PageShell>
        <Header />
        <Card className="p-5">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-rose-50 p-3 text-rose-700">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-extrabold text-slate-900">رابط غير صالح أو منتهي الصلاحية</h1>
              <p className="mt-2 text-sm leading-7 text-slate-600">تعذر تحميل بيانات الموعد لهذا الرابط.</p>
            </div>
          </div>
          <div className="mt-5 flex gap-3">
            <FinalActionButton tone="neutral" onClick={() => navigate(-1)} icon={<ArrowLeft className="h-4 w-4" />}>
              رجوع
            </FinalActionButton>
            <FinalActionButton tone="primary" onClick={() => navigate("/")} icon={<Home className="h-4 w-4" />}>
              العودة للرئيسية
            </FinalActionButton>
          </div>
        </Card>
      </PageShell>
    );
  }

  const canCancel = CANCELLABLE_STATUSES.has(preview.currentStatus);
  const isAlreadyCancelled = preview.currentStatus === "cancelled";

  if (outcome?.alreadyCancelled || isAlreadyCancelled) {
    return (
      <PageShell>
        <Header />
        <Card className="overflow-hidden">
          <div className="border-b border-slate-100 bg-emerald-50 px-5 py-5">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-white p-3 text-emerald-600 shadow-sm">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <h1 className="text-xl font-extrabold text-emerald-800">هذا الموعد ملغى مسبقاً</h1>
                <p className="mt-2 text-sm leading-7 text-emerald-900/90">لا توجد أي إجراءات مطلوبة.</p>
              </div>
            </div>
          </div>

          <div className="space-y-4 p-5">
            <WarningBox
              tone="sky"
              title="تم إلغاء هذا الموعد مسبقاً"
              body="إذا كنت بحاجة إلى موعد جديد، يرجى التواصل مع قسم الأشعة."
            />
            <AppointmentSummaryCard preview={{ ...preview, currentStatus: "cancelled" }} />
            <div className="flex gap-3">
              <FinalActionButton tone="neutral" onClick={() => navigate(-1)} icon={<ArrowLeft className="h-4 w-4" />}>
                رجوع
              </FinalActionButton>
              <FinalActionButton tone="primary" onClick={() => navigate("/")} icon={<Home className="h-4 w-4" />}>
                العودة للرئيسية
              </FinalActionButton>
            </div>
          </div>
        </Card>
      </PageShell>
    );
  }

  if (outcome && !outcome.alreadyCancelled) {
    return (
      <PageShell>
        <Header />
        <Card className="overflow-hidden">
          <div className="border-b border-emerald-100 bg-emerald-50 px-5 py-5">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-white p-3 text-emerald-600 shadow-sm">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <h1 className="text-xl font-extrabold text-emerald-800">تم إلغاء الموعد بنجاح</h1>
                <p className="mt-2 text-sm leading-7 text-emerald-900/90">شكراً لك على مساعدتنا في تقديم رعاية أفضل للجميع.</p>
              </div>
            </div>
          </div>

          <div className="space-y-4 p-5">
            <WarningBox
              tone="sky"
              title="أصبح الموعد متاحاً الآن"
              body="أصبح هذا الموعد متاحاً الآن لمريض آخر بحاجة إلى خدمة الأشعة."
            />
            <AppointmentSummaryCard preview={{ ...preview, currentStatus: "cancelled" }} />
            <div className="flex gap-3">
              <FinalActionButton tone="neutral" onClick={() => navigate(-1)} icon={<ArrowLeft className="h-4 w-4" />}>
                رجوع
              </FinalActionButton>
              <FinalActionButton tone="primary" onClick={() => navigate("/")} icon={<Home className="h-4 w-4" />}>
                العودة للرئيسية
              </FinalActionButton>
            </div>
          </div>
        </Card>
      </PageShell>
    );
  }

  if (!canCancel) {
    return (
      <PageShell>
        <Header />
        <Card className="overflow-hidden">
          <div className="border-b border-amber-100 bg-amber-50 px-5 py-5">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-white p-3 text-amber-600 shadow-sm">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <h1 className="text-xl font-extrabold text-amber-800">هذا الموعد غير قابل للإلغاء من هذه الصفحة</h1>
                <p className="mt-2 text-sm leading-7 text-amber-900/90">
                  يرجى التواصل مع قسم الأشعة إذا كنت بحاجة إلى المساعدة.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-4 p-5">
            <WarningBox
              title="الحالة الحالية لا تسمح بالإلغاء"
              body="لا يمكن إظهار زر التأكيد لهذا الموعد لأن حالته الحالية لم تعد قابلة للإلغاء."
              tone="amber"
            />
            <AppointmentSummaryCard preview={preview} />
            <div className="flex gap-3">
              <FinalActionButton tone="neutral" onClick={() => navigate(-1)} icon={<ArrowLeft className="h-4 w-4" />}>
                رجوع
              </FinalActionButton>
              <FinalActionButton tone="primary" onClick={() => navigate("/")} icon={<Home className="h-4 w-4" />}>
                العودة للرئيسية
              </FinalActionButton>
            </div>
          </div>
        </Card>
      </PageShell>
    );
  }

  if (flowState === "confirm") {
    return (
      <PageShell>
        <Header />

        <Card className="overflow-hidden">
          <div className="border-b border-rose-100 bg-rose-50 px-5 py-5">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-white p-3 text-rose-600 shadow-sm">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <h1 className="text-xl font-extrabold text-rose-800">تأكيد إلغاء الموعد</h1>
                <p className="mt-2 text-sm leading-7 text-rose-900/90">
                  بمجرد تأكيد الإلغاء، سيتم إلغاء الموعد نهائياً وقد يتم منح هذا الموعد لمريض آخر ينتظر.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-4 p-5">
            <AppointmentSummaryCard preview={preview} />

            <WarningBox
              tone="rose"
              title="تنبيه مهم"
              body="بمجرد تأكيد الإلغاء، سيتم إلغاء الموعد نهائياً وقد يتم منح هذا الموعد لمريض آخر ينتظر."
            />

            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
                className="mt-1 h-5 w-5 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
              />
              <span className="text-sm leading-7 text-slate-700">
                أفهم أن هذا الإلغاء نهائي ولا يمكن التراجع عنه
              </span>
            </label>

            {submitError ? (
              <WarningBox tone="rose" title="تعذر إلغاء الموعد" body={submitError} />
            ) : null}

            <div className="flex gap-3">
              <FinalActionButton
                tone="neutral"
                onClick={() => {
                  setFlowState("landing");
                  setSubmitError(null);
                  setAcknowledged(false);
                }}
                icon={<ArrowLeft className="h-4 w-4" />}
              >
                رجوع
              </FinalActionButton>
              <FinalActionButton
                tone="danger"
                disabled={!acknowledged || cancelMutation.isPending}
                onClick={() => cancelMutation.mutate()}
                icon={cancelMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              >
                {cancelMutation.isPending ? "جاري الإلغاء..." : "تأكيد الإلغاء"}
              </FinalActionButton>
            </div>
          </div>
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <Header />

      <Card className="overflow-hidden">
        <div className="border-b border-teal-100 bg-teal-50 px-5 py-5">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-white p-3 text-teal-600 shadow-sm">
              <Clock3 className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-extrabold text-teal-800">إلغاء الموعد</h1>
              <p className="mt-2 text-sm leading-7 text-teal-900/90">
                إلغاء الموعد مبكراً يساعد مريضاً آخر على الحصول على موعد أسرع ويقلل وقت الانتظار.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-5 p-5">
          <AppointmentSummaryCard preview={preview} />

          <div className="space-y-3">
            <SectionTitle
              title="لماذا يهم الإلغاء المبكر؟"
              subtitle="يساعدنا ذلك على إدارة المواعيد بشكل أفضل وتقديم خدمة أسرع للمرضى الذين ينتظرون."
            />
            <div className="space-y-3">
              <BenefitCard
                icon={<Users2 className="h-5 w-5" />}
                title="يساعد مريضاً آخر في الحصول على موعد أسرع"
                description="عندما يتم تحرير الموعد مبكراً، يمكن إعادة تخصيصه لمريض بحاجة إلى الفحص في وقت أقرب."
              />
              <BenefitCard
                icon={<Clock3 className="h-5 w-5" />}
                title="يساهم في تقليل أوقات الانتظار"
                description="الإلغاء المبكر يمنح القسم فرصة أفضل لتنظيم الجدول اليومي وتقليل الفترات الضائعة."
              />
              <BenefitCard
                icon={<ShieldCheck className="h-5 w-5" />}
                title="يساعدنا على تقديم خدمة أفضل لك مستقبلاً"
                description="الالتزام بإلغاء الموعد عند عدم الحاجة إليه يدعم الانضباط وجودة الخدمة للجميع."
              />
            </div>
          </div>

          <div className="flex gap-3">
            <FinalActionButton
              tone="primary"
              onClick={() => {
                setSubmitError(null);
                setFlowState("confirm");
              }}
              icon={<ArrowLeft className="h-4 w-4" />}
            >
              متابعة الإلغاء
            </FinalActionButton>
            <FinalActionButton tone="neutral" onClick={() => navigate(-1)} icon={<Home className="h-4 w-4" />}>
              الاحتفاظ بالموعد
            </FinalActionButton>
          </div>
        </div>
      </Card>
    </PageShell>
  );
}
