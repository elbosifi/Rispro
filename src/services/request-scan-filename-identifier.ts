import path from "node:path";
import { normalizeV2AccessionNumber } from "../modules/appointments-v2/shared/utils/accession.js";

const UPLOAD_EXTENSION = /\.(?:pdf|jpe?g)$/i;
const WINDOWS_DUPLICATE_SUFFIX = / \(\d+\)$/;
const ACCESSION_CANDIDATE = /V2-\d+/gi;
const TOKEN_MARKERS = ["/public/appointment?t=", "_public_appointment_t="] as const;

export type RequestScanFilenameIdentifiers = {
  normalizedBasename: string;
  accessions: string[];
  qrTokens: string[];
  invalidAccessionCount: number;
  invalidQrCount: number;
};

export type RequestScanFilenameEvidence = {
  accessionCandidateCount: number;
  qrCandidateCount: number;
  invalidCandidateCount: number;
  unresolvedCandidateCount: number;
  verified: Array<{ appointmentId: number; source: "accession" | "qr" }>;
};

export type RequestScanFilenameDecision =
  | { kind: "none"; appointmentId: null; strategy: "document" }
  | { kind: "partial"; appointmentId: number | null; strategy: "document_confirmation" }
  | { kind: "conflict"; appointmentId: null; strategy: "manual_review" }
  | { kind: "success"; appointmentId: number; strategy: "filename_accession" | "filename_qr" | "filename_consensus" };

function filenameInput(value: string): string {
  // A normal public appointment URL is an explicitly supported filename
  // representation. All other inputs are reduced to a basename first.
  return /^https?:\/\//i.test(value) ? value : path.win32.basename(path.posix.basename(value));
}

export function normalizeRequestScanFilename(filename: string): string {
  const withoutExtension = filenameInput(filename).replace(UPLOAD_EXTENSION, "");
  return withoutExtension.replace(WINDOWS_DUPLICATE_SUFFIX, "");
}

export function parseRequestScanFilenameIdentifiers(filename: string): RequestScanFilenameIdentifiers {
  const normalizedBasename = normalizeRequestScanFilename(filename);
  const accessions = new Set<string>();
  let invalidAccessionCount = 0;

  for (const match of normalizedBasename.matchAll(ACCESSION_CANDIDATE)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (/[A-Z0-9]/i.test(normalizedBasename[start - 1] ?? "") || /[A-Z0-9]/i.test(normalizedBasename[end] ?? "")) {
      continue;
    }
    const normalized = normalizeV2AccessionNumber(match[0]);
    if (normalized) accessions.add(normalized);
    else invalidAccessionCount += 1;
  }

  const qrTokens = new Set<string>();
  let invalidQrCount = 0;
  const lower = normalizedBasename.toLowerCase();
  for (const marker of TOKEN_MARKERS) {
    let offset = 0;
    while (offset < lower.length) {
      const markerIndex = lower.indexOf(marker, offset);
      if (markerIndex < 0) break;
      const token = normalizedBasename.slice(markerIndex + marker.length);
      if (token) qrTokens.add(token);
      else invalidQrCount += 1;
      offset = markerIndex + marker.length;
    }
  }

  return {
    normalizedBasename,
    accessions: [...accessions],
    qrTokens: [...qrTokens],
    invalidAccessionCount,
    invalidQrCount,
  };
}

export function decideRequestScanFilenameEvidence(evidence: RequestScanFilenameEvidence): RequestScanFilenameDecision {
  const appointmentIds = [...new Set(evidence.verified.map((candidate) => candidate.appointmentId))];
  if (appointmentIds.length > 1) return { kind: "conflict", appointmentId: null, strategy: "manual_review" };

  const incomplete = evidence.invalidCandidateCount > 0 || evidence.unresolvedCandidateCount > 0;
  if (incomplete) {
    return {
      kind: "partial",
      appointmentId: appointmentIds.length === 1 ? appointmentIds[0] : null,
      strategy: "document_confirmation",
    };
  }
  if (appointmentIds.length === 0) return { kind: "none", appointmentId: null, strategy: "document" };

  const sources = new Set(evidence.verified.map((candidate) => candidate.source));
  const strategy = sources.size > 1 || evidence.verified.length > 1
    ? "filename_consensus"
    : sources.has("qr")
      ? "filename_qr"
      : "filename_accession";
  return { kind: "success", appointmentId: appointmentIds[0], strategy };
}

export function requestScanSafeDisplayFilename(filename: string): string {
  const parsed = parseRequestScanFilenameIdentifiers(filename);
  if (!parsed.qrTokens.length && !parsed.invalidQrCount) return filename;
  const extension = path.extname(filenameInput(filename)).toLowerCase();
  return `Patient appointment QR${UPLOAD_EXTENSION.test(extension) ? extension : ""}`;
}
