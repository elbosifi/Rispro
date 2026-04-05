const TRIPOLI_TIME_ZONE = "Africa/Tripoli";
const DISPLAY_LOCALE = "en-GB";

const displayDateFormatter = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
  timeZone: TRIPOLI_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric"
});

const displayDateTimeFormatter = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
  timeZone: TRIPOLI_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

export const DATE_INPUT_LANG = "en-GB";

function extractIsoDate(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

function toDateOrNull(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const isoDate = extractIsoDate(value);
  if (isoDate) {
    // Noon UTC avoids accidental date rollover when formatting across time zones.
    const date = new Date(`${isoDate}T12:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(String(value ?? ""));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateLy(value: unknown): string {
  const date = toDateOrNull(value);
  if (!date) return "—";
  return displayDateFormatter.format(date);
}

export function formatDateTimeLy(value: unknown): string {
  const date = toDateOrNull(value);
  if (!date) return "—";
  return displayDateTimeFormatter.format(date);
}

export function todayIsoDateLy(): string {
  const parts = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    timeZone: TRIPOLI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const year = parts.find((p) => p.type === "year")?.value ?? "1970";
  return `${year}-${month}-${day}`;
}

