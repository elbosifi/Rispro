import crypto from "node:crypto";
import { HttpError } from "../../utils/http-error.js";
import type { ImagingStudy, StudyMatchResult } from "./types.js";

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

export function createLaunchToken(): { token: string; tokenHash: string } {
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
