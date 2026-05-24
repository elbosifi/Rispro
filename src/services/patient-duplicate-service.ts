import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { logAuditEntry } from "./audit-service.js";
import { getPatientDirectorySummary, mergePatients, searchPatients, updatePatient, type PatientRow } from "./patient-service.js";
import { scorePatientDuplicatePair, type PatientDuplicateConflict, type PatientDuplicateSignal } from "./patient-duplicate-scoring.js";
import { normalizeArabicName } from "../utils/normalize.js";
import { normalizeIdentifierValue } from "../utils/identifier.js";
import type { PoolClient } from "pg";
import type { OptionalUserId, UnknownRecord, UserId } from "../types/http.js";

const DEFAULT_DUPLICATE_THRESHOLD = 75;
const MAX_DUPLICATE_CANDIDATES = 100;
const MATCH_MODES = ["strict", "balanced", "broad"] as const;

type DuplicateMatchMode = (typeof MATCH_MODES)[number];

interface PatientDuplicateListOptions {
  threshold: number;
  mode: DuplicateMatchMode;
  category: "oncology" | "non_oncology" | null;
  sex: string | null;
  dobProximity: boolean | null;
  hasIdentifier: boolean | null;
  hasPhone: boolean | null;
}

type PatientDuplicatePatientRow = {
  id: number;
  mrn: string | null;
  national_id: string | null;
  identifier_type: string | null;
  identifier_value: string | null;
  arabic_full_name: string;
  english_full_name: string | null;
  normalized_arabic_name: string;
  age_years: number;
  estimated_date_of_birth: string | null;
  sex: string | null;
  phone_1: string | null;
  phone_2: string | null;
  category: "oncology" | "non_oncology" | null;
};

export interface PatientDuplicateSummary {
  id: number;
  mrn: string | null;
  nationalId: string | null;
  identifierType: string | null;
  identifierValue: string | null;
  arabicFullName: string;
  englishFullName: string | null;
  ageYears: number;
  dateOfBirth: string | null;
  sex: string | null;
  phone1: string | null;
  phone2: string | null;
  category: "oncology" | "non_oncology" | null;
}

export interface PatientDuplicateBlockers {
  legacyAppointments: number;
  v2Bookings: number;
  documents: number;
  scanSessions: number;
  patientImportRows: number;
  dicomRemapJobs: number;
  webPushRows: number;
  total: number;
}

export interface PatientDuplicateCandidate {
  patientA: PatientDuplicateSummary;
  patientB: PatientDuplicateSummary;
  score: number;
  reasons: string[];
  signals: PatientDuplicateSignal[];
  conflicts: PatientDuplicateConflict[];
  canSafeDeleteA: boolean;
  canSafeDeleteB: boolean;
  blockersA: PatientDuplicateBlockers;
  blockersB: PatientDuplicateBlockers;
}

function parseBooleanFilter(value: unknown): boolean | null {
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function parseDuplicateListOptions(query?: Record<string, unknown>): PatientDuplicateListOptions {
  const threshold = Math.max(40, Math.min(100, Number(query?.threshold ?? DEFAULT_DUPLICATE_THRESHOLD) || DEFAULT_DUPLICATE_THRESHOLD));
  const mode = MATCH_MODES.includes(query?.mode as DuplicateMatchMode) ? (query?.mode as DuplicateMatchMode) : "balanced";
  const category = query?.category === "oncology" || query?.category === "non_oncology" ? query.category : null;
  const sex = typeof query?.sex === "string" && query.sex.trim() ? query.sex.trim().toLowerCase() : null;
  return {
    threshold,
    mode,
    category,
    sex,
    dobProximity: parseBooleanFilter(query?.dobProximity),
    hasIdentifier: parseBooleanFilter(query?.hasIdentifier),
    hasPhone: parseBooleanFilter(query?.hasPhone),
  };
}

function normalizePair(patientAId: number, patientBId: number): [number, number] {
  if (!Number.isInteger(patientAId) || patientAId <= 0 || !Number.isInteger(patientBId) || patientBId <= 0) {
    throw new HttpError(400, "Both patient ids are required.");
  }
  if (patientAId === patientBId) {
    throw new HttpError(400, "Choose two different patient records.");
  }
  return patientAId < patientBId ? [patientAId, patientBId] : [patientBId, patientAId];
}

function toSummary(row: PatientDuplicatePatientRow): PatientDuplicateSummary {
  return {
    id: Number(row.id),
    mrn: row.mrn,
    nationalId: row.national_id,
    identifierType: row.identifier_type,
    identifierValue: row.identifier_value,
    arabicFullName: row.arabic_full_name,
    englishFullName: row.english_full_name,
    ageYears: Number(row.age_years || 0),
    dateOfBirth: row.estimated_date_of_birth ? String(row.estimated_date_of_birth).slice(0, 10) : null,
    sex: row.sex,
    phone1: row.phone_1,
    phone2: row.phone_2,
    category: row.category,
  };
}

async function getSafeDeleteBlockers(client: PoolClient, patientId: number): Promise<PatientDuplicateBlockers> {
  const { rows } = await client.query<{
    legacy_appointments: number;
    v2_bookings: number;
    documents: number;
    scan_sessions: number;
    patient_import_rows: number;
    dicom_remap_jobs: number;
    web_push_rows: number;
  }>(
    `
      select
        (select count(*)::int from appointments where patient_id = $1) as legacy_appointments,
        (select count(*)::int from appointments_v2.bookings where patient_id = $1) as v2_bookings,
        (select count(*)::int from documents where patient_id = $1) as documents,
        (select count(*)::int from scan_sessions where patient_id = $1) as scan_sessions,
        (select count(*)::int from patient_import_staging_rows where matched_existing_patient_id = $1 or migrated_patient_id = $1) as patient_import_rows,
        (select count(*)::int from dicom_remap_jobs where rispro_patient_id = $1) as dicom_remap_jobs,
        (
          (select count(*)::int from patient_web_push_booking_subscriptions where patient_id = $1)
          + (select count(*)::int from patient_notification_events where patient_id = $1)
        ) as web_push_rows
    `,
    [patientId]
  );
  const row = rows[0]!;
  const blockers = {
    legacyAppointments: Number(row.legacy_appointments || 0),
    v2Bookings: Number(row.v2_bookings || 0),
    documents: Number(row.documents || 0),
    scanSessions: Number(row.scan_sessions || 0),
    patientImportRows: Number(row.patient_import_rows || 0),
    dicomRemapJobs: Number(row.dicom_remap_jobs || 0),
    webPushRows: Number(row.web_push_rows || 0),
    total: 0,
  };
  blockers.total =
    blockers.legacyAppointments +
    blockers.v2Bookings +
    blockers.documents +
    blockers.scanSessions +
    blockers.patientImportRows +
    blockers.dicomRemapJobs +
    blockers.webPushRows;
  return blockers;
}

async function buildCandidate(client: PoolClient, a: PatientDuplicatePatientRow, b: PatientDuplicatePatientRow, threshold: number): Promise<PatientDuplicateCandidate | null> {
  const scored = scorePatientDuplicatePair(a, b);
  if (scored.score < threshold) return null;
  const [blockersA, blockersB] = await Promise.all([
    getSafeDeleteBlockers(client, Number(a.id)),
    getSafeDeleteBlockers(client, Number(b.id)),
  ]);
  return {
    patientA: toSummary(a),
    patientB: toSummary(b),
    score: scored.score,
    reasons: scored.reasons,
    signals: scored.signals,
    conflicts: scored.conflicts,
    canSafeDeleteA: blockersA.total === 0,
    canSafeDeleteB: blockersB.total === 0,
    blockersA,
    blockersB,
  };
}

async function fetchDuplicatePatientRows(client: PoolClient, options: PatientDuplicateListOptions): Promise<Array<{ a: PatientDuplicatePatientRow; b: PatientDuplicatePatientRow }>> {
  const nameSimilarityThreshold = options.mode === "strict" ? 0.7 : options.mode === "broad" ? 0.35 : 0.5;
  const { rows } = await client.query<{ a: PatientDuplicatePatientRow; b: PatientDuplicatePatientRow }>(
    `
      with patient_base as (
        select
          p.id,
          p.mrn,
          p.national_id,
          coalesce(primary_identifier.identifier_type, p.identifier_type) as identifier_type,
          coalesce(primary_identifier.identifier_value, p.identifier_value, p.national_id) as identifier_value,
          p.arabic_full_name,
          p.english_full_name,
          p.normalized_arabic_name,
          p.age_years,
          p.estimated_date_of_birth::text,
          p.sex,
          p.phone_1,
          p.phone_2,
          p.category,
          regexp_replace(coalesce(p.phone_1, ''), '\\D', '', 'g') as normalized_phone,
          normalize_space.first_name_token,
          lower(regexp_replace(coalesce(p.english_full_name, ''), '\\s+', ' ', 'g')) as normalized_english_name
        from patients p
        left join lateral (
          select pit.code as identifier_type, pi.value as identifier_value
          from patient_identifiers pi
          join patient_identifier_types pit on pit.id = pi.identifier_type_id
          where pi.patient_id = p.id
          order by pi.is_primary desc, pi.id asc
          limit 1
        ) as primary_identifier on true
        cross join lateral (
          select split_part(coalesce(nullif(p.normalized_arabic_name, ''), p.arabic_full_name), ' ', 1) as first_name_token
        ) as normalize_space
      )
      select
        row_to_json(a.*) as a,
        row_to_json(b.*) as b
      from patient_base a
      join patient_base b on a.id < b.id
      left join patient_duplicate_dismissals d on d.patient_a_id = a.id and d.patient_b_id = b.id
      where d.id is null
        and ($2::text is null or a.category = $2::text or b.category = $2::text)
        and ($3::text is null or lower(coalesce(a.sex, '')) = $3::text or lower(coalesce(b.sex, '')) = $3::text)
        and (
          $4::boolean is null
          or ($4::boolean = true and (coalesce(a.identifier_value, a.national_id, '') <> '' or coalesce(b.identifier_value, b.national_id, '') <> ''))
          or ($4::boolean = false and coalesce(a.identifier_value, a.national_id, '') = '' and coalesce(b.identifier_value, b.national_id, '') = '')
        )
        and (
          $5::boolean is null
          or ($5::boolean = true and (a.normalized_phone <> '' or b.normalized_phone <> ''))
          or ($5::boolean = false and a.normalized_phone = '' and b.normalized_phone = '')
        )
        and (
          $6::boolean is null
          or $6::boolean = false
          or a.estimated_date_of_birth = b.estimated_date_of_birth
          or a.age_years = b.age_years
        )
        and (
          (
            a.identifier_value is not null
            and a.identifier_value <> ''
            and regexp_replace(lower(a.identifier_value), '[^[:alnum:]]', '', 'g') = regexp_replace(lower(coalesce(b.identifier_value, '')), '[^[:alnum:]]', '', 'g')
          )
          or (a.national_id is not null and a.national_id <> '' and a.national_id = b.national_id)
          or (a.normalized_phone <> '' and a.normalized_phone = b.normalized_phone)
          or similarity(a.normalized_arabic_name, b.normalized_arabic_name) >= $1
          or similarity(a.normalized_english_name, b.normalized_english_name) >= $1
          or (
            a.normalized_english_name <> ''
            and b.normalized_english_name <> ''
            and soundex(a.normalized_english_name) = soundex(b.normalized_english_name)
          )
          or (
            a.first_name_token <> ''
            and a.first_name_token = b.first_name_token
            and (
              a.estimated_date_of_birth = b.estimated_date_of_birth
              or a.age_years = b.age_years
              or lower(coalesce(a.sex, '')) = lower(coalesce(b.sex, ''))
            )
          )
        )
      order by a.id desc
      limit 500
    `,
    [
      nameSimilarityThreshold,
      options.category,
      options.sex,
      options.hasIdentifier,
      options.hasPhone,
      options.dobProximity,
    ]
  );
  return rows;
}

export async function listPatientDuplicateCandidates(query?: Record<string, unknown>): Promise<{ candidates: PatientDuplicateCandidate[]; threshold: number; mode: DuplicateMatchMode; candidateCount: number }> {
  const options = parseDuplicateListOptions(query);
  const client = await pool.connect();
  try {
    const candidateRows = await fetchDuplicatePatientRows(client, options);
    const candidates: PatientDuplicateCandidate[] = [];
    for (const row of candidateRows) {
      const candidate = await buildCandidate(client, row.a, row.b, options.threshold);
      if (candidate) candidates.push(candidate);
    }
    candidates.sort((a, b) => b.score - a.score || b.patientA.id - a.patientA.id);
    return { candidates: candidates.slice(0, MAX_DUPLICATE_CANDIDATES), threshold: options.threshold, mode: options.mode, candidateCount: candidates.length };
  } finally {
    client.release();
  }
}

async function fetchPatientDuplicateRow(client: PoolClient, patientId: number): Promise<PatientDuplicatePatientRow> {
  const { rows } = await client.query<PatientDuplicatePatientRow>(
    `
      select
        p.id,
        p.mrn,
        p.national_id,
        coalesce(primary_identifier.identifier_type, p.identifier_type) as identifier_type,
        coalesce(primary_identifier.identifier_value, p.identifier_value, p.national_id) as identifier_value,
        p.arabic_full_name,
        p.english_full_name,
        p.normalized_arabic_name,
        p.age_years,
        p.estimated_date_of_birth::text,
        p.sex,
        p.phone_1,
        p.phone_2,
        p.category
      from patients p
      left join lateral (
        select pit.code as identifier_type, pi.value as identifier_value
        from patient_identifiers pi
        join patient_identifier_types pit on pit.id = pi.identifier_type_id
        where pi.patient_id = p.id
        order by pi.is_primary desc, pi.id asc
        limit 1
      ) as primary_identifier on true
      where p.id = $1
      limit 1
    `,
    [patientId]
  );
  const row = rows[0];
  if (!row) throw new HttpError(404, "Patient not found.");
  return row;
}

export async function getPatientDuplicateDetail(patientAId: number, patientBId: number) {
  const [orderedA, orderedB] = normalizePair(patientAId, patientBId);
  const client = await pool.connect();
  try {
    const [a, b] = await Promise.all([
      fetchPatientDuplicateRow(client, orderedA),
      fetchPatientDuplicateRow(client, orderedB),
    ]);
    const candidate = await buildCandidate(client, a, b, DEFAULT_DUPLICATE_THRESHOLD);
    const scored = scorePatientDuplicatePair(a, b);
    const [summaryA, summaryB] = await Promise.all([
      getPatientDirectorySummary(orderedA),
      getPatientDirectorySummary(orderedB),
    ]);
    return {
      candidate: candidate || {
        patientA: toSummary(a),
        patientB: toSummary(b),
        score: scored.score,
        reasons: scored.reasons,
        signals: scored.signals,
        conflicts: scored.conflicts,
        canSafeDeleteA: false,
        canSafeDeleteB: false,
        blockersA: await getSafeDeleteBlockers(client, orderedA),
        blockersB: await getSafeDeleteBlockers(client, orderedB),
      },
      summaryA,
      summaryB,
    };
  } finally {
    client.release();
  }
}

export async function dismissPatientDuplicateCandidate(patientAId: number, patientBId: number, reason: unknown, dismissedByUserId: OptionalUserId) {
  const [orderedA, orderedB] = normalizePair(patientAId, patientBId);
  const cleanReason = String(reason || "").trim() || null;
  const { rows } = await pool.query(
    `
      insert into patient_duplicate_dismissals (patient_a_id, patient_b_id, reason, dismissed_by_user_id)
      values ($1, $2, $3, $4)
      on conflict (patient_a_id, patient_b_id) do update
      set reason = excluded.reason,
          dismissed_by_user_id = excluded.dismissed_by_user_id,
          updated_at = now()
      returning id, patient_a_id, patient_b_id, reason, dismissed_by_user_id, created_at, updated_at
    `,
    [orderedA, orderedB, cleanReason, dismissedByUserId]
  );

  await logAuditEntry({
    entityType: "patient_duplicate",
    entityId: orderedA,
    actionType: "dismiss",
    oldValues: null,
    newValues: { patientAId: orderedA, patientBId: orderedB, reason: cleanReason } as UnknownRecord,
    changedByUserId: dismissedByUserId,
  });

  return rows[0];
}

export async function mergePatientDuplicateCandidate(targetPatientId: UserId, sourcePatientId: UserId, confirmationText: unknown, updatedByUserId: OptionalUserId) {
  return mergePatients({ targetPatientId, sourcePatientId, confirmationText: String(confirmationText || "") }, updatedByUserId);
}

export async function searchPatientsForDuplicateResolver(query: unknown) {
  const term = String(query || "").trim();
  if (term.length < 2) return [];
  const [baseMatches, fuzzyMatches] = await Promise.all([searchPatients(term), searchPatientsForDuplicateResolverFuzzy(term)]);
  const byId = new Map<number, PatientRow>();
  for (const patient of [...baseMatches, ...fuzzyMatches]) byId.set(Number(patient.id), patient);
  return [...byId.values()].slice(0, 25);
}

async function searchPatientsForDuplicateResolverFuzzy(term: string): Promise<PatientRow[]> {
  const normalizedArabicTerm = normalizeArabicName(term);
  const normalizedEnglishTerm = term.toLowerCase().replace(/\s+/g, " ").trim();
  const normalizedIdentifierPattern = `%${normalizeIdentifierValue(term)}%`;
  const { rows } = await pool.query<PatientRow>(
    `
      select
        p.id,
        p.mrn,
        case
          when coalesce(primary_identifier.identifier_type, p.identifier_type) = 'national_id'
            then coalesce(primary_identifier.identifier_value, p.identifier_value, p.national_id)
          else null
        end as national_id,
        coalesce(primary_identifier.identifier_type, p.identifier_type) as identifier_type,
        coalesce(primary_identifier.identifier_value, p.identifier_value) as identifier_value,
        p.category,
        p.arabic_full_name,
        p.english_full_name,
        p.age_years,
        p.demographics_estimated,
        p.sex,
        p.phone_1,
        p.phone_2,
        p.address,
        p.estimated_date_of_birth
      from patients p
      left join lateral (
        select pit.code as identifier_type, pi.value as identifier_value
        from patient_identifiers pi
        join patient_identifier_types pit on pit.id = pi.identifier_type_id
        where pi.patient_id = p.id
        order by pi.is_primary desc, pi.id asc
        limit 1
      ) as primary_identifier on true
      where
        similarity(p.normalized_arabic_name, $1) >= 0.35
        or similarity(lower(regexp_replace(coalesce(p.english_full_name, ''), '\\s+', ' ', 'g')), $2) >= 0.35
        or (
          $2 <> ''
          and lower(regexp_replace(coalesce(p.english_full_name, ''), '\\s+', ' ', 'g')) <> ''
          and soundex(lower(regexp_replace(coalesce(p.english_full_name, ''), '\\s+', ' ', 'g'))) = soundex($2)
        )
        or exists (
          select 1
          from patient_identifiers pi
          where pi.patient_id = p.id and pi.normalized_value ilike $3
        )
      order by greatest(
        similarity(p.normalized_arabic_name, $1),
        similarity(lower(regexp_replace(coalesce(p.english_full_name, ''), '\\s+', ' ', 'g')), $2)
      ) desc,
      p.id desc
      limit 25
    `,
    [normalizedArabicTerm, normalizedEnglishTerm, normalizedIdentifierPattern]
  );
  return rows;
}

export async function mergePatientDuplicateGroup(
  targetPatientId: UserId,
  sourcePatientIds: unknown,
  confirmationText: unknown,
  updatedByUserId: OptionalUserId,
  targetPayload?: unknown
) {
  const cleanTargetId = Number(targetPatientId);
  const cleanSourceIds = Array.isArray(sourcePatientIds)
    ? sourcePatientIds.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0 && value !== cleanTargetId)
    : [];
  const uniqueSourceIds = [...new Set(cleanSourceIds)];

  if (!Number.isInteger(cleanTargetId) || cleanTargetId <= 0) {
    throw new HttpError(400, "targetPatientId is required.");
  }
  if (uniqueSourceIds.length === 0) {
    throw new HttpError(400, "Choose at least one source patient to merge.");
  }
  if (String(confirmationText || "").trim().toUpperCase() !== "MERGE") {
    throw new HttpError(400, "confirmationText must be MERGE.");
  }

  let patient = null;
  for (const sourcePatientId of uniqueSourceIds) {
    patient = await mergePatients({ targetPatientId: cleanTargetId, sourcePatientId, confirmationText: "MERGE" }, updatedByUserId);
  }

  if (targetPayload && typeof targetPayload === "object" && !Array.isArray(targetPayload)) {
    patient = await updatePatient(cleanTargetId, targetPayload, updatedByUserId);
  }

  return { patient, mergedSourceIds: uniqueSourceIds };
}

export async function safeDeleteDuplicatePatient(patientId: number, confirmationText: unknown, deletedByUserId: OptionalUserId): Promise<{ ok: boolean }> {
  const cleanPatientId = Number(patientId);
  if (!Number.isInteger(cleanPatientId) || cleanPatientId <= 0) throw new HttpError(400, "patientId is required.");
  if (String(confirmationText || "").trim().toUpperCase() !== "DELETE") {
    throw new HttpError(400, "confirmationText must be DELETE.");
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    const patient = await fetchPatientDuplicateRow(client, cleanPatientId);
    const blockers = await getSafeDeleteBlockers(client, cleanPatientId);
    if (blockers.total > 0) {
      throw new HttpError(409, "Patient has linked clinical history and cannot be safely deleted.");
    }

    await client.query(`delete from patient_duplicate_dismissals where patient_a_id = $1 or patient_b_id = $1`, [cleanPatientId]);
    await client.query(`delete from patient_custom_values where patient_id = $1`, [cleanPatientId]);
    await client.query(`delete from patient_identifiers where patient_id = $1`, [cleanPatientId]);
    await client.query(`delete from patients where id = $1`, [cleanPatientId]);

    await logAuditEntry(
      {
        entityType: "patient",
        entityId: cleanPatientId,
        actionType: "safe_delete_duplicate",
        oldValues: patient as unknown as UnknownRecord,
        newValues: null,
        changedByUserId: deletedByUserId,
      },
      client
    );

    await client.query("commit");
    return { ok: true };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
