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

export function e2eTodayInTripoli(): string { return tripoliDate(); }
export function e2eYesterdayInTripoli(): string { return tripoliDate(-1); }
export function e2eTomorrowInTripoli(): string { return tripoliDate(1); }
