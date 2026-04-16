/**
 * Appointments V2 — Date rule matching helpers.
 *
 * Pure functions: given a date string (yyyy-mm-dd) and rule parameters,
 * return whether the date matches the rule.
 */

/**
 * Check if a specific date (yyyy-mm-dd) falls on a monthly recurrence window
 * defined by month/day ranges.
 */
function matchesYearlyRecurrence(
  dateStr: string,
  recurStartMonth: number,
  recurStartDay: number,
  recurEndMonth: number,
  recurEndDay: number
): boolean {
  const [yearStr, monthStr, dayStr] = dateStr.split("-");
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);
  const year = parseInt(yearStr, 10);

  // Normalize: compare (month, day) tuples
  const startNum = recurStartMonth * 100 + recurStartDay;
  const endNum = recurEndMonth * 100 + recurEndDay;
  const dateNum = month * 100 + day;

  // Handle跨年 recurrence (e.g., Dec 20 – Jan 10)
  if (startNum <= endNum) {
    return dateNum >= startNum && dateNum <= endNum;
  }
  // Spans year boundary
  return dateNum >= startNum || dateNum <= endNum;
}

/**
 * Check if a date falls within a date range.
 */
function matchesDateRange(
  dateStr: string,
  startDate: string,
  endDate: string
): boolean {
  return dateStr >= startDate && dateStr <= endDate;
}

/**
 * Check if a date matches a weekly recurrence rule.
 * If alternateWeeks is true, compute week parity from the anchor date.
 */
function matchesWeeklyRule(
  dateStr: string,
  weekday: number, // 0=Sun, 6=Sat
  alternateWeeks: boolean,
  recurrenceAnchorDate: string | null
): boolean {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const jsWeekday = d.getUTCDay(); // 0=Sun, 6=Sat

  if (jsWeekday !== weekday) {
    return false;
  }

  if (!alternateWeeks) {
    return true; // Every occurrence of this weekday
  }

  if (!recurrenceAnchorDate) {
    return true; // No anchor; treat as every week
  }

  // Compute ISO week number difference from anchor
  const anchor = new Date(`${recurrenceAnchorDate}T00:00:00Z`);
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const diffWeeks = Math.round((d.getTime() - anchor.getTime()) / msPerWeek);

  // Even/odd week parity: same parity as week 0 (anchor week)
  return diffWeeks % 2 === 0;
}

/**
 * Check if a modality blocked rule matches the given date.
 */
export function blockedRuleMatchesDate(
  rule: {
    ruleType: "specific_date" | "date_range" | "yearly_recurrence";
    specificDate: string | null;
    startDate: string | null;
    endDate: string | null;
    recurStartMonth: number | null;
    recurStartDay: number | null;
    recurEndMonth: number | null;
    recurEndDay: number | null;
  },
  dateStr: string
): boolean {
  switch (rule.ruleType) {
    case "specific_date":
      return rule.specificDate === dateStr;

    case "date_range":
      if (!rule.startDate || !rule.endDate) return false;
      return matchesDateRange(dateStr, rule.startDate, rule.endDate);

    case "yearly_recurrence":
      if (
        rule.recurStartMonth == null ||
        rule.recurStartDay == null ||
        rule.recurEndMonth == null ||
        rule.recurEndDay == null
      ) {
        return false;
      }
      return matchesYearlyRecurrence(
        dateStr,
        rule.recurStartMonth,
        rule.recurStartDay,
        rule.recurEndMonth,
        rule.recurEndDay
      );

    default:
      return false;
  }
}

/**
 * Check if an exam type rule matches the given date.
 */
export function examRuleMatchesDate(
  rule: {
    ruleType: "specific_date" | "date_range" | "weekly_recurrence";
    specificDate: string | null;
    startDate: string | null;
    endDate: string | null;
    weekday: number | null;
    alternateWeeks: boolean;
    recurrenceAnchorDate: string | null;
  },
  dateStr: string
): boolean {
  switch (rule.ruleType) {
    case "specific_date":
      return rule.specificDate === dateStr;

    case "date_range":
      if (!rule.startDate || !rule.endDate) return false;
      return matchesDateRange(dateStr, rule.startDate, rule.endDate);

    case "weekly_recurrence":
      if (rule.weekday == null) return false;
      return matchesWeeklyRule(
        dateStr,
        rule.weekday,
        rule.alternateWeeks,
        rule.recurrenceAnchorDate
      );

    default:
      return false;
  }
}

/**
 * Check if an exam-mix quota rule matches the given date.
 * Rule semantics align with exam-type weekly/specific/range patterns.
 */
export function examMixQuotaRuleMatchesDate(
  rule: {
    ruleType: "specific_date" | "date_range" | "weekly_recurrence";
    specificDate: string | null;
    startDate: string | null;
    endDate: string | null;
    weekday: number | null;
    alternateWeeks: boolean;
    recurrenceAnchorDate: string | null;
  },
  dateStr: string
): boolean {
  return examRuleMatchesDate(rule, dateStr);
}
