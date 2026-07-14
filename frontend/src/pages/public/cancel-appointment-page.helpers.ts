import type { PatientQrSettings, PublicAppointmentCancelPreview } from "@/lib/api-hooks";

function formatCalendarTime(value: string | undefined | null): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const match = raw.match(/^(\d{2}):(\d{2})/);
  if (match) return `${match[1]}:${match[2]}`;
  return raw;
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
  const bookingTime = formatCalendarTime(preview.bookingTime || "");
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
