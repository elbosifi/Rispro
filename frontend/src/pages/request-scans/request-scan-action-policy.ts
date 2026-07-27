import type { Role } from "@/types/api";

export type RequestScanActionKind =
  | "preview"
  | "open-browser"
  | "view-attached"
  | "open-appointment"
  | "processing-details"
  | "start-now"
  | "stop-review"
  | "retry-automatic"
  | "assign-appointment"
  | "retry"
  | "retry-archive"
  | "retry-matching"
  | "dismiss"
  | "restore"
  | "return-to-incoming";

export type RequestScanAction = { kind: RequestScanActionKind };

export type RequestScanPolicyJob = {
  status: "pending" | "processing" | "processed" | "duplicate" | "failed";
  appointment_id: number | null;
  document_id: number | null;
  attachment_completed_at?: string | null;
  source_moved_at?: string | null;
  processing_stage?: string | null;
  dismissed_at?: string | null;
  return_source_path?: string | null;
  return_destination_path?: string | null;
  clinical_document_export_status?: "pending" | "exporting" | "exported" | "failed" | "blocked" | null;
};

export type DerivedRequestScanActions = {
  primary: RequestScanAction | null;
  secondary: RequestScanAction[];
};

const supervisorRoles = new Set<Role | string>(["supervisor", "super_admin"]);

function action(kind: RequestScanActionKind): RequestScanAction {
  return { kind };
}

function attachmentHasStarted(job: RequestScanPolicyJob): boolean {
  return Boolean(job.attachment_completed_at) || ["attaching_document", "moving_file", "completed"].includes(job.processing_stage ?? "");
}

function archiveTransferFailed(job: RequestScanPolicyJob): boolean {
  return job.status === "failed" && Boolean(job.attachment_completed_at && job.document_id && !job.source_moved_at);
}

/**
 * UI affordance policy only. Each route still performs authorization and
 * state validation on the server before changing a Request Scan job.
 */
export function deriveRequestScanActions(job: RequestScanPolicyJob, userRole?: Role | string): DerivedRequestScanActions {
  const secondary: RequestScanAction[] = [action("preview"), action("open-browser"), action("processing-details")];
  if (job.document_id) secondary.splice(2, 0, action("view-attached"));
  if (job.appointment_id) secondary.splice(job.document_id ? 3 : 2, 0, action("open-appointment"));

  let primary: RequestScanAction | null = null;
  if (job.status === "pending") {
    primary = action("start-now");
    secondary.push(action("start-now"));
  } else if (job.status === "processing" && !attachmentHasStarted(job)) {
    primary = action("stop-review");
    secondary.push(action("stop-review"));
  } else if (archiveTransferFailed(job)) {
    if (supervisorRoles.has(userRole ?? "")) {
      primary = action("retry-archive");
      secondary.push(action("retry-archive"));
    }
  } else if (job.status === "failed" && job.dismissed_at && supervisorRoles.has(userRole ?? "")) {
    secondary.push(action("restore"));
  } else if (job.status === "failed" && !job.appointment_id) {
    primary = action("assign-appointment");
    secondary.push(action("retry-automatic"), action("assign-appointment"));
  } else if (job.status === "failed") {
    primary = action("retry");
    secondary.push(action("retry"));
  } else if ((job.status === "processed" || job.status === "duplicate") && job.appointment_id) {
    primary = action("open-appointment");
  }

  if (job.status === "failed" && !job.dismissed_at && supervisorRoles.has(userRole ?? "")) secondary.push(action("dismiss"));
  if (job.status === "failed" && job.dismissed_at && supervisorRoles.has(userRole ?? "")) {
    if (!secondary.some((item) => item.kind === "restore")) secondary.push(action("restore"));
  }
  if (job.clinical_document_export_status === "blocked" && supervisorRoles.has(userRole ?? "")) secondary.push(action("retry-matching"));

  // The backend's retry route already performs the return-to-Incoming
  // checkpoint. Do not expose a duplicate recovery operation.
  if (job.status === "failed" && !job.dismissed_at && !job.attachment_completed_at && !job.document_id && job.return_source_path && job.return_destination_path) {
    // Kept intentionally empty: retry is the authoritative recovery action.
  }

  return { primary, secondary };
}

export function extractFilenameAccession(filename: string): string | null {
  const matches = [...filename.matchAll(/\bV2-(\d+)\b/gi)]
    .map((match) => `V2-${match[1]}`.toUpperCase())
    .filter((value, index, values) => values.indexOf(value) === index);
  return matches.length === 1 && Number(matches[0].slice(3)) > 0 ? matches[0] : null;
}
