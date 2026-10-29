import crypto from "node:crypto";
import { HttpError } from "../../utils/http-error.js";
import type { ExaminationMatchDiagnostic, ExaminationMatchResult, ImagingStudy, StudyMatchResult } from "./types.js";

const DICOM_UID_PATTERN = /^[0-9]+(?:\.[0-9]+)+$/;
const ENV_KEY_PATTERN = /^[A-Z][A-Z0-9_]{1,127}$/;

export function normalizeViewerBasePath(value: unknown, fallback = "/ohif"): string {
  const clean = String(value ?? fallback).trim() || fallback;
  if (!clean.startsWith("/") || clean.startsWith("//") || clean.includes("?") || clean.includes("#") || clean.includes("..")) {
    throw new HttpError(400, "OHIF public base URL must be a safe root-relative path.");
  }
  return clean.length > 1 ? clean.replace(/\/+$/, "") : clean;
}

export function normalizeDicomWebUrl(value: unknown, field: string): string {
  const clean = String(value ?? "").trim();
  if (!clean) throw new HttpError(400, `${field} is required.`);
  let parsed: URL;
  try {
    parsed = new URL(clean);
  } catch {
    throw new HttpError(400, `${field} must be an absolute http(s) URL.`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new HttpError(400, `${field} must be an absolute http(s) URL without credentials, query, or fragment.`);
  }
  return parsed.toString().replace(/\/+$/, "");
}

export function assertSameDicomWebOrigin(baseUrl: string, ...roots: Array<string | null | undefined>): void {
  const base = new URL(baseUrl);
  for (const root of roots) {
    if (!root) continue;
    const parsed = new URL(root);
    if (parsed.origin !== base.origin) {
      throw new HttpError(400, "All DICOMweb roots must use the allowlisted DICOMweb base origin.");
    }
  }
}

export function normalizeEnvironmentKey(value: unknown, field: string, required: boolean): string | null {
  const clean = String(value ?? "").trim();
  if (!clean) {
    if (required) throw new HttpError(400, `${field} is required for the selected authentication type.`);
    return null;
  }
  if (!ENV_KEY_PATTERN.test(clean)) throw new HttpError(400, `${field} must be an uppercase environment variable name.`);
  return clean;
}

export function isValidDicomUid(value: unknown): value is string {
  const clean = String(value ?? "").trim();
  return clean.length <= 64 && DICOM_UID_PATTERN.test(clean);
}

function normalizeIdentity(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeModality(value: unknown): string[] {
  return normalizeIdentity(value).split(/[\\, ]+/).filter(Boolean);
}

function dateDistanceDays(left: string, right: string): number | null {
  const normalize = (value: string) => value.replace(/-/g, "").slice(0, 8);
  const leftClean = normalize(left);
  const rightClean = normalize(right);
  if (!/^\d{8}$/.test(leftClean) || !/^\d{8}$/.test(rightClean)) return null;
  const toMs = (value: string) => Date.UTC(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8)));
  return Math.abs(toMs(leftClean) - toMs(rightClean)) / 86_400_000;
}

export function matchStudyByAccession(input: {
  studies: ImagingStudy[];
  accessionNumber: string;
  patientId?: string | null;
  modality?: string | null;
  studyDate?: string | null;
}): StudyMatchResult {
  const accession = normalizeIdentity(input.accessionNumber);
  const patientId = normalizeIdentity(input.patientId);
  const modality = normalizeIdentity(input.modality);
  const exact = input.studies.filter((study) => normalizeIdentity(study.accessionNumber) === accession && isValidDicomUid(study.studyInstanceUid));
  const patientSafe = exact.filter((study) => !patientId || !normalizeIdentity(study.patientId) || normalizeIdentity(study.patientId) === patientId);
  const rejectedPatientMismatchCount = exact.length - patientSafe.length;
  if (patientSafe.length === 0) return { status: "not_found", study: null, candidateCount: 0, rejectedPatientMismatchCount };

  const scored = patientSafe.map((study) => {
    let score = 0;
    if (patientId && normalizeIdentity(study.patientId) === patientId) score += 100;
    if (modality && normalizeModality(study.modality).includes(modality)) score += 10;
    const distance = input.studyDate ? dateDistanceDays(study.studyDate, input.studyDate) : null;
    if (distance !== null && distance <= 3) score += 5;
    return { study, score };
  }).sort((left, right) => right.score - left.score || left.study.studyInstanceUid.localeCompare(right.study.studyInstanceUid));

  const best = scored[0];
  const tied = scored.filter((candidate) => candidate.score === best.score);
  if (tied.length !== 1) return { status: "ambiguous", study: null, candidateCount: patientSafe.length, rejectedPatientMismatchCount };
  return { status: "matched", study: best.study, candidateCount: patientSafe.length, rejectedPatientMismatchCount };
}

// DICOM PatientID/issuer are case-sensitive identifiers. Only remove padding;
// never strip leading zeroes, punctuation, or fold case to manufacture a match.
export function matchAuthoritativeExamination(input: {
  studies: ImagingStudy[]; accessionNumber: string; patientId: string | null;
  patientIdIssuer?: string | null; modality: string; studyDate: string; preferredPrimaryUid?: string | null;
}): ExaminationMatchResult {
  const exact = input.studies.filter(s => s.accessionNumber.trim() === input.accessionNumber.trim());
  const patientId = (input.patientId || "").trim();
  const validStudyUid = (uid: string) => {
    const parts = uid.trim().split('.');
    return isValidDicomUid(uid) && /^[012]$/.test(parts[0]) && (parts[0] === '2' || Number(parts[1]) <= 39)
      && parts.every(part => part.length === 1 || !part.startsWith('0'));
  };
  const diagnostic: ExaminationMatchDiagnostic = {
    reason: "matched", rawCandidateCount: input.studies.length, exactAccessionCount: exact.length,
    invalidUidCount: exact.filter(s => !validStudyUid(s.studyInstanceUid)).length,
    rejectedPatientMismatchCount: exact.filter(s => s.patientId.trim() && s.patientId.trim() !== patientId).length,
    missingPatientIdCount: exact.filter(s => !s.patientId.trim()).length, currentStudyCount: 0,
  };
  const fail = (reason: ExaminationMatchDiagnostic["reason"], status: "not_found" | "ambiguous" = "ambiguous"): ExaminationMatchResult => ({
    status, study: null, studies: [], candidateCount: exact.length,
    rejectedPatientMismatchCount: diagnostic.rejectedPatientMismatchCount, diagnostic: { ...diagnostic, reason },
  });
  if (!input.studies.length) return fail("no_accession_studies", "not_found");
  if (!exact.length || !input.accessionNumber.trim()) return fail("accession_mismatch", "not_found");
  // Do not open a partial examination when an accession candidate cannot be verified.
  if (diagnostic.invalidUidCount) return fail("invalid_study_uid");
  if (!patientId || diagnostic.missingPatientIdCount) return fail("identity_missing");
  if (new Set(exact.map(s => s.patientId.trim())).size > 1) return fail("identity_conflict");
  if (diagnostic.rejectedPatientMismatchCount) return fail("patient_mismatch", "not_found");
  const issuers = new Set(exact.map(s => (s.patientIdIssuer || "").trim()));
  if (issuers.size > 1 || (input.patientIdIssuer && !issuers.has(input.patientIdIssuer.trim()))) return fail("issuer_conflict");

  const unique = new Map<string, ImagingStudy>();
  for (const study of exact) {
    const uid = study.studyInstanceUid.trim();
    const previous = unique.get(uid);
    if (previous && (previous.studyDate !== study.studyDate || previous.modality !== study.modality || previous.studyTime !== study.studyTime)) return fail("manual_review");
    unique.set(uid, { ...study, studyInstanceUid: uid });
  }
  const studies = [...unique.values()];
  if (studies.length > 1) {
    const expectedModality = normalizeModality(input.modality);
    const ancillary = ['SR', 'PR', 'KO', 'SEG', 'DOC'];
    if (expectedModality.length !== 1 || studies.some(s => {
      const modalities = normalizeModality(s.modality);
      return !modalities.includes(expectedModality[0]) || modalities.some(m => m !== expectedModality[0] && !ancillary.includes(m));
    })) return fail("manual_review");
    const dateMs = (date: string): number => {
      const clean = date.replaceAll('-', '');
      if (!/^\d{8}$/.test(clean)) return NaN;
      const ms = Date.UTC(Number(clean.slice(0, 4)), Number(clean.slice(4, 6)) - 1, Number(clean.slice(6, 8)));
      return new Date(ms).toISOString().slice(0, 10).replaceAll('-', '') === clean ? ms : NaN;
    };
    const dates = studies.map(s => dateMs(s.studyDate));
    const appointmentDate = dateMs(input.studyDate);
    if (!Number.isFinite(appointmentDate) || dates.some(d => !Number.isFinite(d) || Math.abs(d - appointmentDate) > 3 * 86_400_000)) return fail("manual_review");
    if (new Set(dates).size > 1) {
      // A midnight crossing needs actual study times, not just adjacent dates.
      const timestamps = studies.map((s, i) => {
        const time = /^(\d{2})(\d{2})(\d{2})(?:\.\d{1,6})?$/.exec(s.studyTime || '');
        if (!time || +time[1] > 23 || +time[2] > 59 || +time[3] > 59) return NaN;
        return dates[i] + (+time[1] * 3600 + +time[2] * 60 + +time[3]) * 1000;
      });
      if (timestamps.some(t => !Number.isFinite(t)) || Math.max(...timestamps) - Math.min(...timestamps) > 86_400_000) return fail("manual_review");
    }
  }
  studies.sort((a, b) => Number(b.studyInstanceUid === input.preferredPrimaryUid) - Number(a.studyInstanceUid === input.preferredPrimaryUid)
    || a.studyInstanceUid.localeCompare(b.studyInstanceUid));
  return { status: "matched", study: studies[0], studies, candidateCount: exact.length,
    rejectedPatientMismatchCount: 0, diagnostic: { ...diagnostic, currentStudyCount: studies.length } };
}

export function selectPriorStudies(input: {
  studies: ImagingStudy[];
  currentStudy: ImagingStudy;
  patientId: string;
  maxPriors: number;
}): ImagingStudy[] {
  const currentDate = input.currentStudy.studyDate.replace(/-/g, "");
  const patientId = normalizeIdentity(input.patientId);
  const currentModalities = normalizeModality(input.currentStudy.modality);
  const unique = new Map<string, ImagingStudy>();
  for (const study of input.studies) {
    if (!isValidDicomUid(study.studyInstanceUid) || study.studyInstanceUid === input.currentStudy.studyInstanceUid) continue;
    if (!patientId || normalizeIdentity(study.patientId) !== patientId) continue;
    const studyDate = study.studyDate.replace(/-/g, "");
    if (!/^\d{8}$/.test(studyDate) || (/^\d{8}$/.test(currentDate) && studyDate >= currentDate)) continue;
    unique.set(study.studyInstanceUid, study);
  }
  return [...unique.values()].sort((left, right) => {
    const leftSame = normalizeModality(left.modality).some((item) => currentModalities.includes(item)) ? 1 : 0;
    const rightSame = normalizeModality(right.modality).some((item) => currentModalities.includes(item)) ? 1 : 0;
    return rightSame - leftSame || right.studyDate.localeCompare(left.studyDate) || left.studyInstanceUid.localeCompare(right.studyInstanceUid);
  }).slice(0, Math.max(0, input.maxPriors));
}

// Authoritative history is based on the primary study's verified DICOM identity.
export function selectPatientHistory(studies: ImagingStudy[], currentStudy: ImagingStudy, verifiedPatientId: string, currentStudyUids: string[] = [currentStudy.studyInstanceUid]): ImagingStudy[] {
  const patientId = verifiedPatientId.trim();
  const issuer = (currentStudy.patientIdIssuer || "").trim();
  if (!patientId || currentStudy.patientId.trim() !== patientId) return [];
  const unique = new Map<string, ImagingStudy>();
  for (const study of studies) {
    if (!isValidDicomUid(study.studyInstanceUid) || currentStudyUids.includes(study.studyInstanceUid)) continue;
    if (study.patientId.trim() !== patientId || (study.patientIdIssuer || "").trim() !== issuer) continue;
    unique.set(study.studyInstanceUid, study);
  }
  return [...unique.values()].sort((a, b) => b.studyDate.localeCompare(a.studyDate) || a.studyInstanceUid.localeCompare(b.studyInstanceUid));
}

export function createLaunchToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, tokenHash: hashLaunchToken(token) };
}

export function createViewerSessionToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, tokenHash: hashLaunchToken(token) };
}

export function hashLaunchToken(token: string): string {
  return crypto.createHash("sha256").update(String(token || ""), "utf8").digest("hex");
}

export function requestedStudyUids(relativePathWithQuery: string): string[] {
  const parsed = new URL(relativePathWithQuery, "http://rispro.local");
  const uids = new Set<string>();
  const match = parsed.pathname.match(/(?:^|\/)studies\/([^/]+)/i);
  if (match) uids.add(decodeURIComponent(match[1]));
  for (const key of ["StudyInstanceUID", "0020000D"]) {
    for (const raw of parsed.searchParams.getAll(key)) {
      raw.split(/[\\,]/).map((value) => value.trim()).filter(Boolean).forEach((value) => uids.add(value));
    }
  }
  return [...uids];
}
