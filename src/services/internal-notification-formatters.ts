/** Full identity details are permitted only in authenticated internal-staff notifications. */
export interface InternalNotificationPatientIdentity {
  fullName: string | null;
  primaryIdentifier: string | null;
}

export function sanitizeNotificationText(value: unknown): string {
  return String(value ?? "").replace(/[\t\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

export function truncateNotificationText(value: unknown, maxLength: number): string {
  const text = sanitizeNotificationText(value);
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…` : text;
}

export function buildInternalNotificationPatientLabel(identity: InternalNotificationPatientIdentity): string | null {
  const fullName = sanitizeNotificationText(identity.fullName);
  const primaryIdentifier = sanitizeNotificationText(identity.primaryIdentifier);
  const parts = [fullName || null, primaryIdentifier ? `ID: ${primaryIdentifier}` : null].filter(Boolean);
  return parts.length ? parts.join(" • ") : null;
}

export function joinNotificationParts(parts: Array<string | null | undefined>, maxLength = Number.MAX_SAFE_INTEGER): string {
  return truncateNotificationText(parts.map((part) => sanitizeNotificationText(part)).filter(Boolean).join(" • "), maxLength);
}

export function formatNotificationDate(value: unknown, prefix = ""): string | null {
  const date = sanitizeNotificationText(value);
  if (!date) return null;
  const parsed = new Date(`${date.slice(0, 10)}T12:00:00Z`);
  const formatted = Number.isNaN(parsed.getTime()) ? date.slice(0, 10) : new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" }).format(parsed);
  return `${prefix}${formatted}`;
}

export function buildReportingCaseAssignedNotification(input: { modality?: unknown; exam?: unknown; date?: unknown; patient?: string | null; note?: unknown }) {
  return { title: truncateNotificationText(`Case assigned • ${sanitizeNotificationText(input.modality) || "Study"}`, 55), body: joinNotificationParts([truncateNotificationText(input.exam || "Study", 70), formatNotificationDate(input.date), input.patient, sanitizeNotificationText(input.note) ? `Note: ${truncateNotificationText(input.note, 80)}` : null]) };
}

export function buildComparisonCaseAssignedNotification(input: { modality?: unknown; exam?: unknown; priorDate?: unknown; patient?: string | null; note?: unknown }) {
  return { title: truncateNotificationText(`Comparison case assigned • ${sanitizeNotificationText(input.modality) || "Study"}`, 55), body: joinNotificationParts([input.patient, truncateNotificationText(input.exam || "Comparison study", 70), formatNotificationDate(input.priorDate, "Prior: "), sanitizeNotificationText(input.note) ? `Note: ${truncateNotificationText(input.note, 80)}` : null]) };
}

export function buildSchedulingOverrideNotification(input: { state: "created" | "approved" | "rejected" | "failed" | "expired" | "cancelled"; modality?: unknown; date?: unknown; exam?: unknown; patient?: string | null; capacity?: string | null; overbook?: number | null; requesterReason?: unknown; approverReason?: unknown; failure?: unknown }) {
  const stateText = input.state === "created" ? "Overbooking review" : input.state === "failed" ? "Overbooking approval failed" : `Overbooking ${input.state}`;
  const title = truncateNotificationText(`${stateText} • ${sanitizeNotificationText(input.modality) || "Study"}${formatNotificationDate(input.date) ? ` • ${formatNotificationDate(input.date)}` : ""}`, 55);
  const decision = input.state === "failed" ? truncateNotificationText(input.failure || "Approval could not be completed.", 85) : input.approverReason ? `Decision: ${truncateNotificationText(input.approverReason, 80)}` : null;
  const body = joinNotificationParts([input.patient, truncateNotificationText(input.exam || "Scheduled study", 70), input.capacity, input.overbook != null ? `+${input.overbook} above capacity` : null, input.state === "created" && input.requesterReason ? `Reason: ${truncateNotificationText(input.requesterReason, 80)}` : null, decision, input.state === "failed" ? "Open RISpro to review." : null]);
  return { title, body };
}
