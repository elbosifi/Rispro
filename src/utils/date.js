const TRIPOLI_TIME_ZONE = "Africa/Tripoli";

function getTripoliParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TRIPOLI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  return formatter.formatToParts(date).reduce((accumulator, part) => {
    if (part.type !== "literal") {
      accumulator[part.type] = part.value;
    }

    return accumulator;
  }, {});
}

export function getTripoliToday(date = new Date()) {
  const parts = getTripoliParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function normalizeDateValue(value) {
  if (value instanceof Date) {
    return getTripoliToday(value);
  }

  return String(value || "").slice(0, 10);
}

export { TRIPOLI_TIME_ZONE };
