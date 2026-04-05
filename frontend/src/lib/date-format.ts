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

export function isoToDisplayDateLy(isoDate: string): string {
  const normalized = extractIsoDate(isoDate);
  if (!normalized) return "";
  return formatDateLy(normalized);
}

export function displayDateToIso(value: string): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
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
