import { type ReactNode, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarPlus,
  CheckCircle2,
  Clock3,
  Download,
  ExternalLink,
  Loader2,
  MapPin,
  Phone,
  ShieldCheck,
  Sparkles,
  StickyNote,
  FileText,
  MessageCircle,
} from "lucide-react";
import { ApiError } from "@/lib/api-client";
import { buildPatientAppointmentUrl } from "@/lib/patient-appointment-link";
import {
  cancelPublicAppointment,
  fetchPublicAppointmentCancelPreview,
  type PatientQrSettings,
  type PublicAppointmentCancelPreview,
  type PublicAppointmentCancelResult,
} from "@/lib/api-hooks";

type LinkErrorState = "invalid" | "expired" | "unavailable" | "disabled";
type FlowState = "landing" | "confirm" | "success" | "already_cancelled";

const INST_AR = "المركز الوطني للأورام بنغازي";
const DEPT_AR = "قسم الأشعة التشخيصية";
const DEFAULT_SETTINGS: PatientQrSettings = {
  enabled: true,
  printQrOnAppointmentSlip: true,
  allowCancellation: true,
  allowAddToCalendar: true,
  showPreparationInstructions: true,
  showDocumentsChecklist: true,
  showDepartmentContact: false,
  showLocationDirections: false,
  pageTitleAr: "خدمة المريض عبر رمز QR",
  introTextAr: "يمكنك مراجعة تفاصيل الموعد والتعليمات ومعلومات القسم من هذه الصفحة.",
  genericPreparationTextAr: "",
  documentsChecklistAr: [
    "ورقة الإحالة",
    "إثبات الهوية",
    "صور أو تقارير سابقة إن وجدت",
    "تحاليل حديثة إذا طُلبت من القسم",
  ],
  contact: {
    primaryPhone: "",
    secondaryPhone: "",
    whatsapp: "",
    whatsappEnabled: false,
    workingHoursAr: "",
    noteAr: "",
  },
  location: {
    centerNameAr: INST_AR,
    departmentLocationAr: "",
    roomUnitFloorAr: "",
    addressAr: "",
    arrivalInstructionsAr: "",
    googleMapsUrl: "",
    parkingNoteAr: "",
  },
};

function classifyLinkError(error: unknown): LinkErrorState {
  if (!(error instanceof ApiError)) return "invalid";
  const details = (error.details ?? {}) as { code?: string };
  const code = String(details.code || "");
  if (code === "patient_qr_disabled") return "disabled";
  if (code === "expired_link") return "expired";
  if (code === "public_cancel_not_configured" || error.status === 503) return "unavailable";
  return "invalid";
}

function formatBookingStatusAr(status: string): string {
  const map: Record<string, string> = {
    scheduled: "مجدول",
    arrived: "مجدول",
    waiting: "مجدول",
    "in-progress": "مكتمل",
    completed: "مكتمل",
    cancelled: "ملغى",
    "no-show": "لم يحضر",
    discontinued: "غير متاح للإلغاء",
  };
  return map[status] ?? "غير متاح للإلغاء";
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

function formatTimeAr(value: string | undefined | null): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const match = raw.match(/^(\d{2}):(\d{2})/);
  if (match) return `${match[1]}:${match[2]}`;
  return raw;
}

function normalizePhone(value: string): string {
  return String(value || "")
    .trim()
    .replace(/[\s().-]/g, "")
    .trim();
}

function isValidPhone(value: string): boolean {
  const normalized = normalizePhone(value);
  if (!normalized) return true;
  return /^\+?\d{7,15}$/.test(normalized);
}

function isValidUrl(value: string): boolean {
  const trimmed = String(value || "").trim();
  if (!trimmed) return true;
  try {
    // eslint-disable-next-line no-new
    new URL(trimmed);
    return true;
  } catch {
    return false;
  }
}

function isCancellableStatus(status: string): boolean {
  return ["scheduled", "arrived", "waiting"].includes(status);
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

function Card(props: { children: ReactNode; className?: string }) {
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

function Header(props: { centerName: string }) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-100 bg-white px-4 py-4 sm:px-5">
        <div className="flex items-start gap-3">
          <img
            src="/assets/nccb-logo.png"
            alt="شعار المركز الوطني للأورام بنغازي"
            className="h-14 w-14 shrink-0 rounded-2xl object-contain ring-1 ring-slate-100"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-6 text-rose-700">{INST_AR}</p>
            <p className="text-base font-bold leading-6 text-slate-900">{props.centerName || DEPT_AR}</p>
            <p className="mt-1 text-xs text-slate-500">{DEPT_AR}</p>
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

function Pill(props: { children: ReactNode; tone?: "neutral" | "success" | "warning" | "danger" | "info" }) {
  const tone = props.tone ?? "neutral";
  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold ${toneClasses(tone)}`}>
      {props.children}
    </span>
  );
}

function ActionButton(props: {
  children: ReactNode;
  tone?: "primary" | "danger" | "neutral";
  disabled?: boolean;
  onClick: () => void;
  icon?: ReactNode;
  type?: "button" | "submit";
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
      type={props.type ?? "button"}
      onClick={props.onClick}
      disabled={props.disabled}
      className={`flex min-h-12 items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-extrabold shadow-sm transition focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {props.icon}
      <span>{props.children}</span>
    </button>
  );
}

function AppointmentSummaryCard(props: {
  preview: PublicAppointmentCancelPreview;
  canCancel: boolean;
}) {
  const { preview } = props;
  const statusLabel = preview.currentStatus === "cancelled" ? "ملغى" : formatBookingStatusAr(preview.currentStatus);
  const eligibilityLabel = !props.canCancel && preview.currentStatus !== "cancelled" ? "غير متاح للإلغاء" : null;
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-500">تفاصيل الموعد</p>
          <h3 className="mt-1 text-lg font-extrabold text-slate-900">{preview.patientDisplayName}</h3>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Pill tone={preview.currentStatus === "cancelled" ? "danger" : "success"}>{statusLabel}</Pill>
          {eligibilityLabel ? <Pill tone="warning">{eligibilityLabel}</Pill> : null}
        </div>
      </div>

      <dl className="mt-4 space-y-3 text-sm">
        <SummaryRow label="اسم المريض" value={preview.patientDisplayName} />
        <SummaryRow label="تاريخ الموعد" value={formatDateAr(preview.bookingDate)} />
        {preview.bookingTime ? <SummaryRow label="وقت الموعد" value={formatTimeAr(preview.bookingTime)} /> : null}
        <SummaryRow label="الجهاز" value={preview.modalityNameAr || preview.modalityName || "—"} />
        <SummaryRow label="نوع الفحص" value={preview.examNameAr || preview.examName || "—"} />
        {preview.accessionNumber ? <SummaryRow label="رقم الموعد" value={preview.accessionNumber} /> : null}
      </dl>
    </Card>
  );
}

function SummaryRow(props: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="min-w-[7rem] text-slate-500">{props.label}</dt>
      <dd className="flex-1 text-left font-semibold text-slate-900 rtl:text-right">{props.value || "—"}</dd>
    </div>
  );
}

function InfoCard(props: { icon: ReactNode; title: string; body: string; tone?: "neutral" | "success" | "warning" | "danger" | "info" }) {
  const tone = props.tone ?? "info";
  return (
    <div className={`flex gap-3 rounded-2xl border px-4 py-3 ${toneClasses(tone)}`}>
      <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-current shadow-sm">
        {props.icon}
      </div>
      <div className="min-w-0">
        <h4 className="text-sm font-bold leading-6 text-slate-900">{props.title}</h4>
        <p className="mt-1 text-sm leading-7 text-slate-700">{props.body}</p>
      </div>
    </div>
  );
}

function ChecklistCard(props: { items: string[] }) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-3 flex items-start gap-3">
        <div className="rounded-full bg-teal-50 p-2 text-teal-700">
          <FileText className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-base font-extrabold text-slate-900">ما الذي يجب إحضاره؟</h3>
          <p className="mt-1 text-sm leading-7 text-slate-600">يرجى مراجعة هذه القائمة قبل الحضور إلى القسم.</p>
        </div>
      </div>
      <ul className="space-y-2">
        {props.items.map((item) => (
          <li key={item} className="flex items-start gap-2 rounded-2xl bg-slate-50 px-3 py-2 text-sm leading-7 text-slate-700">
            <span className="mt-2 h-2 w-2 rounded-full bg-teal-600" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ContactCard(props: { settings: PatientQrSettings["contact"] }) {
  const phones = [props.settings.primaryPhone, props.settings.secondaryPhone].filter(Boolean);
  const whatsapp = props.settings.whatsappEnabled && props.settings.whatsapp ? props.settings.whatsapp : "";

  if (phones.length === 0 && !whatsapp && !props.settings.workingHoursAr && !props.settings.noteAr) return null;

  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-3 flex items-start gap-3">
        <div className="rounded-full bg-sky-50 p-2 text-sky-700">
          <Phone className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-base font-extrabold text-slate-900">التواصل مع القسم</h3>
          <p className="mt-1 text-sm leading-7 text-slate-600">اختر وسيلة التواصل المناسبة عند الحاجة.</p>
        </div>
      </div>

      <div className="space-y-3">
        {phones.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {phones.map((phone) => (
              <a
                key={phone}
                href={`tel:${normalizePhone(phone)}`}
                className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800"
              >
                <span>{phone}</span>
                <Phone className="h-4 w-4 text-teal-600" />
              </a>
            ))}
          </div>
        ) : null}

        {whatsapp ? (
          <a
            href={`https://wa.me/${normalizePhone(whatsapp)}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900"
          >
            <span>{whatsapp}</span>
            <MessageCircle className="h-4 w-4" />
          </a>
        ) : null}

        {props.settings.workingHoursAr ? <InfoCard icon={<Clock3 className="h-5 w-5" />} title="ساعات العمل" body={props.settings.workingHoursAr} tone="neutral" /> : null}
        {props.settings.noteAr ? <InfoCard icon={<StickyNote className="h-5 w-5" />} title="ملاحظة" body={props.settings.noteAr} tone="info" /> : null}
      </div>
    </Card>
  );
}

function LocationCard(props: { settings: PatientQrSettings["location"] }) {
  const hasContent = Boolean(
    props.settings.departmentLocationAr ||
      props.settings.roomUnitFloorAr ||
      props.settings.addressAr ||
      props.settings.arrivalInstructionsAr ||
      props.settings.parkingNoteAr ||
      props.settings.googleMapsUrl
  );
  if (!hasContent) return null;

  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-3 flex items-start gap-3">
        <div className="rounded-full bg-amber-50 p-2 text-amber-700">
          <MapPin className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-base font-extrabold text-slate-900">موقع القسم</h3>
          <p className="mt-1 text-sm leading-7 text-slate-600">معلومات مختصرة للوصول إلى القسم بسهولة.</p>
        </div>
      </div>

      <div className="space-y-3">
        {props.settings.departmentLocationAr ? <InfoCard icon={<MapPin className="h-5 w-5" />} title="اسم القسم / الموقع" body={props.settings.departmentLocationAr} tone="info" /> : null}
        {props.settings.roomUnitFloorAr ? <InfoCard icon={<MapPin className="h-5 w-5" />} title="الطابق / الوحدة / الغرفة" body={props.settings.roomUnitFloorAr} tone="neutral" /> : null}
        {props.settings.addressAr ? <InfoCard icon={<MapPin className="h-5 w-5" />} title="العنوان" body={props.settings.addressAr} tone="neutral" /> : null}
        {props.settings.arrivalInstructionsAr ? <InfoCard icon={<Clock3 className="h-5 w-5" />} title="إرشادات الوصول" body={props.settings.arrivalInstructionsAr} tone="neutral" /> : null}
        {props.settings.parkingNoteAr ? <InfoCard icon={<Sparkles className="h-5 w-5" />} title="ملاحظة إضافية" body={props.settings.parkingNoteAr} tone="neutral" /> : null}
        {props.settings.googleMapsUrl ? (
          <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-white p-2 text-sky-700 shadow-sm">
                <MapPin className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h4 className="text-sm font-extrabold text-slate-900">خريطة الموقع</h4>
                <p className="mt-1 text-sm leading-7 text-slate-600">اضغط الزر لفتح الخريطة في تطبيق الخرائط أو المتصفح.</p>
              </div>
            </div>
            <a
              href={props.settings.googleMapsUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center justify-center gap-2 rounded-2xl bg-sky-600 px-4 py-3 text-sm font-extrabold text-white"
            >
              فتح الخريطة
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function addDays(date: Date, amount: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

function buildIcsDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function escapeIcs(value: string): string {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

export function createCalendarBlob(preview: PublicAppointmentCancelPreview, settings: PatientQrSettings, patientPageUrl: string): Blob {
  const title = [preview.examNameAr || preview.examName || "موعد أشعة", preview.modalityNameAr || preview.modalityName || ""]
    .filter(Boolean)
    .join(" - ");
  const bookingTime = formatTimeAr(preview.bookingTime || "");
  const hasBookingTime = Boolean(bookingTime);
  const startDate = new Date(`${preview.bookingDate}T${hasBookingTime ? bookingTime : "08:30"}:00`);
  const endDate = hasBookingTime
    ? (() => {
        const next = new Date(startDate);
        next.setMinutes(next.getMinutes() + 60);
        return next;
      })()
    : new Date(`${preview.bookingDate}T13:30:00`);

  const location = [
    settings.location.departmentLocationAr,
    settings.location.roomUnitFloorAr,
    settings.location.addressAr,
    settings.location.centerNameAr,
  ].filter(Boolean).join(" - ");
  const descriptionParts = [
    settings.introTextAr,
    settings.genericPreparationTextAr,
    settings.contact.noteAr,
    patientPageUrl ? `رابط صفحة الموعد: ${patientPageUrl}` : "",
    patientPageUrl ? "استخدم هذا الرابط للحصول على المزيد من المعلومات عن الجهاز والفحص." : "",
  ].filter(Boolean);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//RISpro//Patient QR//AR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:rispro-${preview.bookingId}@rispro`,
    `DTSTAMP:${buildIcsDate(new Date())}`,
    `SUMMARY:${escapeIcs(title)}`,
    `DTSTART:${buildIcsDate(startDate)}`,
    `DTEND:${buildIcsDate(endDate)}`,
    location ? `LOCATION:${escapeIcs(location)}` : null,
    descriptionParts.length > 0 ? `DESCRIPTION:${escapeIcs(descriptionParts.join("\n\n"))}` : null,
    patientPageUrl ? `URL:${escapeIcs(patientPageUrl)}` : null,
    [
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "DESCRIPTION:موعد الأشعة خلال 24 ساعة",
      "TRIGGER:-PT24H",
      "END:VALARM",
    ].join("\r\n"),
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);

  return new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
}

async function triggerDownload(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
    anchor.remove();
  }, 1000);
}

export default function PublicCancelAppointmentPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [flowState, setFlowState] = useState<FlowState>("landing");
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<PublicAppointmentCancelResult | null>(null);
  const token = useMemo(() => String(searchParams.get("t") || "").trim(), [searchParams]);

  const previewQuery = useQuery({
    queryKey: ["public-qr-preview", token],
    queryFn: () => fetchPublicAppointmentCancelPreview(token),
    enabled: token.length > 0,
    retry: false,
  });

  const preview = previewQuery.data;
  const settings = preview?.patientQrSettings ?? DEFAULT_SETTINGS;
  const patientPageUrl = useMemo(() => buildPatientAppointmentUrl(token, window.location.origin), [token]);
  const canCancel = Boolean(
    preview &&
      settings.enabled &&
      settings.allowCancellation &&
      isCancellableStatus(preview.currentStatus) &&
      preview.currentStatus !== "cancelled"
  );
  const isAlreadyCancelled = preview?.currentStatus === "cancelled" || result?.alreadyCancelled;
  const modalityInstructionsText =
    preview && settings.showPreparationInstructions ? preview.modalityInstructionAr || preview.modalityInstructionEn || "" : "";
  const examInstructionsText =
    preview && settings.showPreparationInstructions ? preview.examInstructionAr || preview.examInstructionEn || "" : "";
  const fallbackInstructionsText =
    preview && settings.showPreparationInstructions && !modalityInstructionsText && !examInstructionsText
      ? settings.genericPreparationTextAr || ""
      : "";

  const cancelMutation = useMutation({
    mutationFn: () => cancelPublicAppointment(token),
    onSuccess: (value) => {
      setSubmitError(null);
      setResult(value);
      setFlowState(value.alreadyCancelled ? "already_cancelled" : "success");
    },
    onError: (error) => {
      const details = error instanceof ApiError ? ((error.details ?? {}) as { code?: string }) : {};
      const code = String(details.code || "");
      if (code === "booking_already_cancelled") {
        setResult({
          ok: true,
          alreadyCancelled: true,
          bookingId: preview?.bookingId || 0,
          status: "cancelled",
        });
        setFlowState("already_cancelled");
        setSubmitError(null);
        return;
      }
      if (code === "booking_not_cancellable") {
        setSubmitError("هذا الموعد غير متاح للإلغاء من هذه الصفحة.");
        return;
      }
      setSubmitError("تعذر إلغاء الموعد الآن. يمكنك المحاولة مرة أخرى بأمان.");
    },
  });

  if (!token) {
    return (
      <PageShell>
        <Header centerName={INST_AR} />
        <SafeNotice
          title="رابط غير صالح أو منتهي الصلاحية"
          body="الرابط لا يحتوي على معلومات كافية لعرض الموعد."
        />
      </PageShell>
    );
  }

  if (previewQuery.isLoading) {
    return (
      <PageShell>
        <Header centerName={INST_AR} />
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
      state === "disabled"
        ? "خدمة عرض تفاصيل الموعد عبر رمز QR غير مفعلة حالياً."
        : state === "expired"
          ? "رابط غير صالح أو منتهي الصلاحية"
          : state === "unavailable"
            ? "خدمة الإلغاء غير متاحة مؤقتًا"
            : "رابط غير صالح أو منتهي الصلاحية";
    const body =
      state === "disabled"
        ? "يرجى التواصل مع القسم للحصول على المساعدة."
        : state === "expired"
          ? "انتهت صلاحية هذا الرابط. يرجى التواصل مع قسم الأشعة."
          : state === "unavailable"
            ? "الخدمة غير متاحة حالياً. يرجى المحاولة لاحقاً أو التواصل مع القسم."
            : "تعذر التحقق من الرابط بأمان.";

    return (
      <PageShell>
        <Header centerName={INST_AR} />
        <SafeNotice title={title} body={body} />
      </PageShell>
    );
  }

  if (!preview) {
    return (
      <PageShell>
        <Header centerName={INST_AR} />
        <SafeNotice title="رابط غير صالح أو منتهي الصلاحية" body="تعذر تحميل بيانات الموعد لهذا الرابط." />
      </PageShell>
    );
  }

  if (!settings.enabled) {
    return (
      <PageShell>
        <Header centerName={settings.location.centerNameAr || INST_AR} />
        <SafeNotice
          title="خدمة عرض تفاصيل الموعد عبر رمز QR غير مفعلة حالياً."
          body="يرجى التواصل مع القسم إذا كنت بحاجة إلى المساعدة."
        />
      </PageShell>
    );
  }

  if (isAlreadyCancelled) {
    return (
      <PageShell>
        <Header centerName={settings.location.centerNameAr || INST_AR} />
        <Card className="overflow-hidden">
          <div className="border-b border-emerald-100 bg-emerald-50 px-5 py-5">
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
            <InfoCard
              icon={<AlertTriangle className="h-5 w-5" />}
              title="تم إلغاء هذا الموعد مسبقاً"
              body="إذا كنت بحاجة إلى موعد جديد، يرجى التواصل مع قسم الأشعة."
              tone="info"
            />
            <AppointmentSummaryCard preview={preview} canCancel={false} />
            <StaticActionRow onBack={() => navigate(-1)} />
          </div>
        </Card>
      </PageShell>
    );
  }

  if (flowState === "success") {
    return (
      <PageShell>
        <Header centerName={settings.location.centerNameAr || INST_AR} />
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
            <InfoCard
              icon={<Sparkles className="h-5 w-5" />}
              title="أصبح الموعد متاحاً الآن"
              body="أصبح هذا الموعد متاحاً الآن لمريض آخر بحاجة إلى خدمة الأشعة."
              tone="success"
            />
            <AppointmentSummaryCard preview={{ ...preview, currentStatus: "cancelled" }} canCancel={false} />
            <StaticActionRow onBack={() => navigate(-1)} />
          </div>
        </Card>
      </PageShell>
    );
  }

  if (flowState === "confirm") {
    return (
      <PageShell>
        <Header centerName={settings.location.centerNameAr || INST_AR} />
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
            <AppointmentSummaryCard preview={preview} canCancel={canCancel} />

            <InfoCard
              tone="warning"
              icon={<ShieldCheck className="h-5 w-5" />}
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
              <span className="text-sm leading-7 text-slate-700">أفهم أن هذا الإلغاء نهائي ولا يمكن التراجع عنه</span>
            </label>

            {submitError ? <InfoCard tone="danger" icon={<AlertTriangle className="h-5 w-5" />} title="تعذر إلغاء الموعد" body={submitError} /> : null}

            <div className="flex gap-3">
              <ActionButton
                tone="neutral"
                onClick={() => {
                  setFlowState("landing");
                  setSubmitError(null);
                  setAcknowledged(false);
                }}
                icon={<ArrowLeft className="h-4 w-4" />}
              >
                رجوع
              </ActionButton>
              <ActionButton
                tone="danger"
                disabled={!acknowledged || cancelMutation.isPending}
                onClick={() => cancelMutation.mutate()}
                icon={cancelMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              >
                {cancelMutation.isPending ? "جاري الإلغاء..." : "تأكيد الإلغاء"}
              </ActionButton>
            </div>
          </div>
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <Header centerName={settings.location.centerNameAr || INST_AR} />

      <Card className="overflow-hidden">
        <div className="border-b border-teal-100 bg-teal-50 px-5 py-5">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-white p-3 text-teal-600 shadow-sm">
              <Clock3 className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-extrabold text-teal-800">{settings.pageTitleAr || "خدمة المريض عبر رمز QR"}</h1>
              <p className="mt-2 text-sm leading-7 text-teal-900/90">{settings.introTextAr}</p>
            </div>
          </div>
        </div>

        <div className="space-y-5 p-5">
          <AppointmentSummaryCard preview={preview} canCancel={canCancel} />

          {modalityInstructionsText ? (
            <InstructionCard
              title="تعليمات خاصة بالجهاز"
              subtitle="التزم بتعليمات التحضير الخاصة بالجهاز عند وجودها."
              body={modalityInstructionsText}
            />
          ) : null}

          {examInstructionsText ? (
            <InstructionCard
              title="تعليمات خاصة بالفحص"
              subtitle="التزم بتعليمات التحضير الخاصة بالفحص عند وجودها."
              body={examInstructionsText}
            />
          ) : null}

          {fallbackInstructionsText ? (
            <InstructionCard
              title="تعليمات التحضير"
              subtitle="تظهر هذه التعليمات عندما لا تتوفر تعليمات خاصة."
              body={fallbackInstructionsText}
            />
          ) : null}

          {settings.showDocumentsChecklist && settings.documentsChecklistAr.length > 0 ? (
            <ChecklistCard items={settings.documentsChecklistAr} />
          ) : null}

          {settings.showDepartmentContact ? <ContactCard settings={settings.contact} /> : null}
          {settings.showLocationDirections ? <LocationCard settings={settings.location} /> : null}

          {settings.allowAddToCalendar ? (
            <Card className="p-4 sm:p-5">
              <div className="mb-3 flex items-start gap-3">
                <div className="rounded-full bg-sky-50 p-2 text-sky-700">
                  <CalendarPlus className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">إضافة إلى التقويم</h3>
                  <p className="mt-1 text-sm leading-7 text-slate-600">يمكنك حفظ الموعد على هاتفك أو حاسوبك كملف تقويم.</p>
                </div>
              </div>
              <ActionButton
                tone="primary"
                onClick={async () => {
                  const blob = createCalendarBlob(preview, settings, patientPageUrl);
                  const filename = `rispro-${preview.accessionNumber || preview.bookingId}.ics`;
                  await triggerDownload(blob, filename);
                }}
                icon={<Download className="h-4 w-4" />}
              >
                إضافة إلى التقويم
              </ActionButton>
            </Card>
          ) : null}

          {canCancel ? (
            <Card className="border-rose-200 bg-rose-50 p-4 sm:p-5">
              <div className="mb-3 flex items-start gap-3">
                <div className="rounded-full bg-white p-2 text-rose-700 shadow-sm">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-rose-900">إلغاء الموعد</h3>
                  <p className="mt-1 text-sm leading-7 text-rose-900/80">إذا لم تعد بحاجة إلى الموعد، يمكنك إلغاؤه بأمان من الخطوة التالية.</p>
                </div>
              </div>
              <ActionButton
                tone="danger"
                onClick={() => {
                  setFlowState("confirm");
                  setSubmitError(null);
                  setAcknowledged(false);
                }}
                icon={<ArrowLeft className="h-4 w-4" />}
              >
                إلغاء الموعد
              </ActionButton>
            </Card>
          ) : (
            <InfoCard
              tone="warning"
              icon={<AlertTriangle className="h-5 w-5" />}
              title="إلغاء الموعد غير متاح"
              body="الحالة الحالية للموعد لا تسمح بالإلغاء من هذه الصفحة."
            />
          )}
        </div>
      </Card>
    </PageShell>
  );
}

function SafeNotice(props: { title: string; body: string }) {
  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-rose-50 p-3 text-rose-700">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-lg font-extrabold text-slate-900">{props.title}</h1>
          <p className="mt-2 text-sm leading-7 text-slate-600">{props.body}</p>
        </div>
      </div>
      <div className="mt-5 flex gap-3">
        <ActionButton tone="neutral" onClick={() => window.history.back()} icon={<ArrowLeft className="h-4 w-4" />}>
          رجوع
        </ActionButton>
      </div>
    </Card>
  );
}

function StaticActionRow(props: { onBack: () => void }) {
  return (
    <div className="flex gap-3">
      <ActionButton tone="neutral" onClick={props.onBack} icon={<ArrowLeft className="h-4 w-4" />}>
        رجوع
      </ActionButton>
    </div>
  );
}

function InstructionCard(props: { title: string; subtitle: string; body: string }) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-3 flex items-start gap-3">
        <div className="rounded-full bg-amber-50 p-2 text-amber-700">
          <Sparkles className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-base font-extrabold text-slate-900">{props.title}</h3>
          <p className="mt-1 text-sm leading-7 text-slate-600">{props.subtitle}</p>
        </div>
      </div>
      <p className="rounded-2xl bg-slate-50 px-4 py-3 text-sm leading-7 text-slate-700">{props.body}</p>
    </Card>
  );
}
