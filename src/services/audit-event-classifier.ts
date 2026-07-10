export type AuditCategory = "important" | "security" | "automated" | "other";
export type AuditOutcome = "successful" | "failed" | "rejected" | "cancelled" | "pending" | "informational" | "unknown";
export type AuditImportance = "high" | "medium" | "low";

export interface AuditClassification {
  category: AuditCategory;
  outcome: AuditOutcome;
  importance: AuditImportance;
}

export interface AuditPresentationInput {
  actionType: string;
  entityType: string;
  entityId?: number | string | null;
  changedByName?: string | null;
  changedByUsername?: string | null;
  changedByUserId?: number | string | null;
  newValues?: unknown;
  oldValues?: unknown;
}

export interface AuditPresentation extends AuditClassification {
  title: string;
  summary: string;
  actorLabel: string;
  targetLabel: string;
}

const sensitiveKeyPattern = /password|passphrase|pin|token|session|cookie|authorization|api.?key|secret|encryption.?key|database.?url|pacs.?password|orthanc.?password|sonicdicom.?password|backup.?passphrase/i;
const sensitiveTextPattern = /(password|passphrase|token|secret|api[_-]?key|authorization|cookie|database[_-]?url|pacs[_-]?password|orthanc[_-]?password|sonicdicom[_-]?password|backup[_-]?passphrase)\s*([=:])\s*[^\s,;"']+/gi;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function normalized(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function valueText(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function explicitOutcome(values: unknown): AuditOutcome | null {
  const record = asRecord(values);
  if (!record) return null;
  const candidates = [record.outcome, record.result, record.status, record.state, record.error, record.failure];
  for (const candidate of candidates) {
    const value = valueText(candidate);
    if (!value) continue;
    if (["failed", "failure", "error", "errored", "exception", "timeout"].includes(value)) return "failed";
    if (["rejected", "denied", "declined"].includes(value)) return "rejected";
    if (["cancelled", "canceled", "aborted", "voided"].includes(value)) return "cancelled";
    if (["pending", "queued", "in_progress", "in-progress"].includes(value)) return "pending";
    if (["success", "successful", "succeeded", "ok", "completed", "complete"].includes(value)) return "successful";
    if (["informational", "info", "not_found", "no_report"].includes(value)) return "informational";
  }
  return null;
}

export function classifyAuditEvent(input: Pick<AuditPresentationInput, "actionType" | "entityType" | "newValues" | "oldValues">): AuditClassification {
  const action = normalized(input.actionType);
  const entity = normalized(input.entityType);
  const combined = `${action} ${entity}`;

  const automated = /report_status|pacs|orthanc|dicom|mwl|sonicdicom|notification|background|scheduled_process|poll|synchroni[sz]|auto_complete|worker/.test(combined);
  const security = /(^|_)(login|logout|auth|reauth|password|action_pin|pin|permission|security|access)(_|$)|reauth|failed_login|role_change|page_access/.test(combined);
  const important = /patient|appointment|booking|override|capacity|modality|user_(create|delete|deactivate|activate|update|role)|document|backup|restore|report_final|destructive|merge/.test(combined);

  const category: AuditCategory = automated ? "automated" : security ? "security" : important ? "important" : "other";
  const outcome = explicitOutcome(input.newValues) ?? explicitOutcome(input.oldValues) ?? "unknown";
  return {
    category,
    outcome,
    importance: category === "important" || category === "security" ? "high" : category === "automated" ? "low" : "medium"
  };
}

function actionTitle(action: string, entity: string, values: unknown): string {
  const key = normalized(action);
  const entityKey = normalized(entity);
  const record = asRecord(values);

  if (key === "supervisor_reauth" && entityKey === "auth") return "Completed supervisor re-authentication";
  if (key === "login" && entityKey === "auth") return "Signed in";
  if (key === "logout" && entityKey === "auth") return "Signed out";
  if (key === "report_status_final" && entityKey === "patient_report") return "Report status confirmed as final";
  if (key === "report_status_no_report" && entityKey === "patient_report") return "No final report was found";
  if (key === "patient_merge" || (key.includes("merge") && entityKey.includes("patient"))) return "Merged patient records";
  if (key.includes("reschedul") || key === "appointment_rescheduled") return "Rescheduled appointment";
  if (key.includes("cancel") && (entityKey.includes("appointment") || entityKey.includes("booking"))) return "Cancelled appointment";
  if ((key.includes("capacity") || key === "update") && entityKey.includes("modality")) return "Changed modality daily capacity";
  if (key.includes("password") && key.includes("reset")) return "Reset a user password";
  if (key.includes("password") && (key.includes("change") || key.includes("update"))) return "Changed a user password";
  if (key.includes("override")) return `${key.includes("request") ? "Requested" : key.includes("approv") ? "Approved" : key.includes("reject") ? "Rejected" : key.includes("cancel") ? "Cancelled" : "Updated"} scheduling override`;
  if (key.includes("create") && entityKey.includes("appointment")) return "Created appointment";
  if (key.includes("delete") && entityKey.includes("document")) return "Deleted document";
  if (key.includes("role") && entityKey.includes("user")) return "Changed user role";
  if (key.includes("action_pin") || (key.includes("pin") && entityKey.includes("security"))) return "Updated Action PIN security";
  if (key.includes("login") && key.includes("fail")) return "Failed sign-in attempt";

  const actionLabel = String(action || "unknown").replaceAll("_", " ").trim();
  const entityLabel = String(entity || "entity").replaceAll("_", " ").trim();
  void record;
  return `Performed ${actionLabel} on ${entityLabel}`;
}

function summaryFor(input: AuditPresentationInput, classification: AuditClassification): string {
  const target = targetLabel(input.entityType, input.entityId);
  if (classification.outcome === "failed") return `${target} action failed.`;
  if (classification.outcome === "rejected") return `${target} action was rejected.`;
  if (classification.outcome === "cancelled") return `${target} action was cancelled.`;
  if (classification.outcome === "pending") return `${target} action is pending.`;
  if (classification.outcome === "informational") return `Recorded information about ${target.toLowerCase()}.`;
  return `${target} was affected by this activity.`;
}

export function actorLabel(input: Pick<AuditPresentationInput, "changedByName" | "changedByUsername" | "changedByUserId">): string {
  return input.changedByName?.trim() || input.changedByUsername?.trim() || (input.changedByUserId ? `User #${input.changedByUserId}` : "System");
}

export function targetLabel(entityType: string, entityId?: number | string | null): string {
  const entity = normalized(entityType);
  const label = entity.includes("patient") ? "Patient" : entity.includes("appointment") || entity.includes("booking") ? "Appointment" : entity.includes("user") ? "User" : entity.includes("modality") ? "Modality" : entity.includes("setting") ? "Setting" : String(entityType || "Entity").replaceAll("_", " ");
  return entityId === null || entityId === undefined || entityId === "" ? label : `${label} #${entityId}`;
}

export function presentAuditEvent(input: AuditPresentationInput): AuditPresentation {
  const classification = classifyAuditEvent(input);
  return {
    ...classification,
    title: actionTitle(input.actionType, input.entityType, input.newValues),
    summary: summaryFor(input, classification),
    actorLabel: actorLabel(input),
    targetLabel: targetLabel(input.entityType, input.entityId)
  };
}

export function redactAuditValue(value: unknown, key?: string): unknown {
  if (key && sensitiveKeyPattern.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => redactAuditValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [childKey, redactAuditValue(childValue, childKey)]));
  }
  if (typeof value === "string") return value.replace(sensitiveTextPattern, "$1$2[REDACTED]");
  return value;
}

export function redactAuditText(value: unknown): string {
  return String(value ?? "").replace(sensitiveTextPattern, "$1$2[REDACTED]");
}
