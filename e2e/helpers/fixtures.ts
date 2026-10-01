function tripoliDate(offsetDays = 0): string {
  const date = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Tripoli",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function utcDate(offsetDays = 0): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

export function e2eTodayInTripoli(): string { return tripoliDate(); }
export function e2eYesterdayInTripoli(): string { return tripoliDate(-1); }
export function e2eTomorrowInTripoli(): string { return tripoliDate(1); }
export function e2eYesterdayUtc(): string { return utcDate(-1); }
export function e2eTomorrowUtc(): string { return utcDate(1); }
