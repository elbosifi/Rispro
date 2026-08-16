import os from "node:os";
import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import { normalizeArabicName, normalizeArabicNameCompact } from "../utils/normalize.js";
import { HttpError } from "../utils/http-error.js";
import {
  createAuthoritativeOrthancClient,
  type OrthancChangesPage,
  type OrthancStudiesIndexPage,
  type OrthancStudyDetails,
} from "./authoritative-orthanc-service.js";
import { buildPatientNameSearchSql, preparePatientSearch } from "./patient-search-query.js";

const SYNC_LOCK_KEY = 712364092;
const DEFAULT_SYNC_INTERVAL_MS = 60_000;
const FULL_RECONCILIATION_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const HISTORICAL_PACS_INDEX_FRESHNESS_MS = 5 * 60 * 1000;
const STUDY_BATCH_SIZE = 50;
const FULL_STUDY_PAGE_SIZE = 1000;
const CHANGE_BATCH_SIZE = 500;

type Queryable = Pick<PoolClient, "query"> | typeof pool;
type MatchClassification = "exact" | "strong_demographic" | "possible" | "ambiguous";
type MatchReason =
  | "exact_patient_id"
  | "exact_normalized_name"
  | "fuzzy_english_name"
  | "arabic_normalized_name"
  | "double_metaphone"
  | "soundex"
  | "exact_dob"
  | "age_within_5_years"
  | "compatible_sex"
  | "dob_mismatch"
  | "sex_mismatch"
  | "multiple_competing_identities";

export interface HistoricalPacsStudy {
  orthancStudyId: string;
  studyInstanceUid: string | null;
  accessionNumber: string | null;
  patientId: string | null;
  patientName: string | null;
  patientBirthDate: string | null;
  patientSex: string | null;
  studyDate: string | null;
  studyDescription: string | null;
  modalitiesInStudy: string[];
  seriesCount: number;
  instanceCount: number;
}

export interface HistoricalPacsCandidate {
  historicalPatientId: string;
  patientName: string | null;
  patientBirthDate: string | null;
  patientSex: string | null;
  classification: MatchClassification;
  reasons: MatchReason[];
  authoritative: boolean;
  matchRank: number;
  nameSimilarity: number;
  phoneticMatchCount: number;
  studyCount: number;
  studies: HistoricalPacsStudy[];
}

export type HistoricalPacsIndexStatus = "ready" | "stale" | "unavailable" | "uninitialized";

export interface HistoricalPacsDiscoveryResult {
  exactStudies: OrthancStudyDetails[];
  candidates: HistoricalPacsCandidate[];
  indexStatus: HistoricalPacsIndexStatus;
  lastSuccessAt: string | null;
  knownPatientIds: string[];
}

interface IndexedStudyRow {
  orthanc_study_id: string;
  study_instance_uid: string | null;
  accession_number: string | null;
  patient_id: string | null;
  patient_name_raw: string | null;
  patient_birth_date: string | null;
  patient_sex: string | null;
  study_date: string | null;
  study_description: string | null;
  modalities_in_study: string[];
  series_count: number;
  instance_count: number;
}

interface PatientIdentityProfile {
  id: number;
  arabicName: string;
  englishName: string;
  birthDate: string | null;
  birthDateReliable: boolean;
  sex: string | null;
  identifiers: string[];
}

interface NameMatchRow {
  patient_id: string;
  patient_name_raw: string | null;
  patient_birth_date: string | null;
  patient_sex: string | null;
  match_rank: number;
  name_similarity: number;
  phonetic_match_count: number;
  soundex_match_count: number;
  matched_arabic?: boolean;
}

interface HistoricalPacsSyncClient {
  listStudiesForIndexPage(since: number, limit?: number): Promise<OrthancStudiesIndexPage>;
  getStudyForIndex(id: string): Promise<OrthancStudyDetails | null>;
  getChanges(since: number, limit?: number): Promise<OrthancChangesPage>;
}

interface HistoricalPacsPatientLookupClient {
  listStudiesByPatientId(patientId: string): Promise<OrthancStudyDetails[]>;
}

const clean = (value: unknown): string => String(value ?? "").trim();
const unique = (values: Array<string | null | undefined>): string[] => [...new Set(values.map(clean).filter(Boolean))];

export function dicomPatientNameVariants(value: string | null | undefined): string[] {
  const variants: string[] = [];
  for (const representation of clean(value).split("=").map((part) => part.trim()).filter(Boolean)) {
    const components = representation.split("^").map((part) => part.trim()).filter(Boolean);
    if (!components.length) continue;
    variants.push(components.join(" "));
    if (components.length > 1) variants.push([...components.slice(1), components[0]!].join(" "));
  }
  return unique(variants);
}

function indexedNames(patientName: string | null): Record<string, string> {
  const variants = dicomPatientNameVariants(patientName);
  const latinIndex = variants.findIndex((variant) => /[A-Za-z]/.test(variant));
  const primaryIndex = latinIndex >= 0 ? latinIndex : 0;
  const primary = variants[primaryIndex] || "";
  const reordered = variants[primaryIndex + 1] || primary;
  const arabicIndex = variants.findIndex((variant) => /[\u0600-\u06ff]/.test(variant));
  const arabicPrimary = variants[arabicIndex >= 0 ? arabicIndex : primaryIndex] || primary;
  const arabicReordered = variants[(arabicIndex >= 0 ? arabicIndex : primaryIndex) + 1] || arabicPrimary;
  return {
    normalizedNamePrimary: primary.toLowerCase().replace(/\s+/g, " ").trim(),
    normalizedNameReordered: reordered.toLowerCase().replace(/\s+/g, " ").trim(),
    normalizedArabicNamePrimary: normalizeArabicName(arabicPrimary),
    normalizedArabicNameReordered: normalizeArabicName(arabicReordered),
    normalizedArabicCompactPrimary: normalizeArabicNameCompact(arabicPrimary),
    normalizedArabicCompactReordered: normalizeArabicNameCompact(arabicReordered),
  };
}

function mapStudy(row: IndexedStudyRow): HistoricalPacsStudy {
  return {
    orthancStudyId: row.orthanc_study_id,
    studyInstanceUid: row.study_instance_uid,
    accessionNumber: row.accession_number,
    patientId: row.patient_id,
    patientName: row.patient_name_raw,
    patientBirthDate: row.patient_birth_date,
    patientSex: row.patient_sex,
    studyDate: row.study_date,
    studyDescription: row.study_description,
    modalitiesInStudy: row.modalities_in_study || [],
    seriesCount: Number(row.series_count) || 0,
    instanceCount: Number(row.instance_count) || 0,
  };
}

function toOrthancStudy(study: HistoricalPacsStudy): OrthancStudyDetails {
  return { ...study };
}

export async function upsertHistoricalPacsStudies(studies: OrthancStudyDetails[], db: Queryable = pool, synchronizedAt: string | null = null): Promise<number> {
  if (!studies.length) return 0;
  const rows = studies.map((study) => ({
    orthancStudyId: study.orthancStudyId,
    studyInstanceUid: study.studyInstanceUid,
    accessionNumber: study.accessionNumber,
    patientId: study.patientId,
    patientNameRaw: study.patientName,
    patientBirthDate: study.patientBirthDate,
    patientSex: study.patientSex,
    studyDate: study.studyDate,
    studyDescription: study.studyDescription,
    modalitiesInStudy: study.modalitiesInStudy,
    seriesCount: study.seriesCount,
    instanceCount: study.instanceCount,
    ...indexedNames(study.patientName),
  }));
  const result = await db.query(
    `
      insert into historical_pacs_studies (
        orthanc_study_id, study_instance_uid, accession_number, patient_id,
        patient_name_raw, patient_birth_date, patient_sex, study_date,
        study_description, modalities_in_study, series_count, instance_count,
        normalized_name_primary, normalized_name_reordered,
        normalized_arabic_name_primary, normalized_arabic_name_reordered,
        normalized_arabic_compact_primary, normalized_arabic_compact_reordered,
        synchronized_at
      )
      select
        x."orthancStudyId", x."studyInstanceUid", x."accessionNumber", x."patientId",
        x."patientNameRaw", x."patientBirthDate", x."patientSex", x."studyDate",
        x."studyDescription", x."modalitiesInStudy", x."seriesCount", x."instanceCount",
        x."normalizedNamePrimary", x."normalizedNameReordered",
        x."normalizedArabicNamePrimary", x."normalizedArabicNameReordered",
        x."normalizedArabicCompactPrimary", x."normalizedArabicCompactReordered", coalesce($2::timestamptz, clock_timestamp())
      from jsonb_to_recordset($1::jsonb) as x(
        "orthancStudyId" text, "studyInstanceUid" text, "accessionNumber" text, "patientId" text,
        "patientNameRaw" text, "patientBirthDate" text, "patientSex" text, "studyDate" text,
        "studyDescription" text, "modalitiesInStudy" text[], "seriesCount" integer, "instanceCount" integer,
        "normalizedNamePrimary" text, "normalizedNameReordered" text,
        "normalizedArabicNamePrimary" text, "normalizedArabicNameReordered" text,
        "normalizedArabicCompactPrimary" text, "normalizedArabicCompactReordered" text
      )
      on conflict (orthanc_study_id) do update set
        study_instance_uid = excluded.study_instance_uid,
        accession_number = excluded.accession_number,
        patient_id = excluded.patient_id,
        patient_name_raw = excluded.patient_name_raw,
        patient_birth_date = excluded.patient_birth_date,
        patient_sex = excluded.patient_sex,
        study_date = excluded.study_date,
        study_description = excluded.study_description,
        modalities_in_study = excluded.modalities_in_study,
        series_count = excluded.series_count,
        instance_count = excluded.instance_count,
        normalized_name_primary = excluded.normalized_name_primary,
        normalized_name_reordered = excluded.normalized_name_reordered,
        normalized_arabic_name_primary = excluded.normalized_arabic_name_primary,
        normalized_arabic_name_reordered = excluded.normalized_arabic_name_reordered,
        normalized_arabic_compact_primary = excluded.normalized_arabic_compact_primary,
        normalized_arabic_compact_reordered = excluded.normalized_arabic_compact_reordered,
        synchronized_at = coalesce($2::timestamptz, clock_timestamp())
    `,
    [JSON.stringify(rows), synchronizedAt],
  );
  return result.rowCount || 0;
}

async function loadPatientProfile(patientId: number): Promise<PatientIdentityProfile> {
  const result = await pool.query<{
    id: number; arabic_full_name: string | null; english_full_name: string | null;
    estimated_date_of_birth: string | null; demographics_estimated: boolean; sex: string | null;
    mrn: string | null; national_id: string | null; identifier_value: string | null; identifiers: string[] | null;
  }>(
    `
      select p.id, p.arabic_full_name, p.english_full_name, p.estimated_date_of_birth::text,
        p.demographics_estimated, p.sex, p.mrn, p.national_id, p.identifier_value,
        coalesce(array_agg(pi.value) filter (where nullif(trim(pi.value), '') is not null), array[]::text[]) identifiers
      from patients p
      left join patient_identifiers pi on pi.patient_id = p.id
      where p.id = $1
      group by p.id
    `,
    [patientId],
  );
  const row = result.rows[0];
  if (!row) throw new HttpError(404, "Patient not found.");
  return {
    id: Number(row.id),
    arabicName: clean(row.arabic_full_name),
    englishName: clean(row.english_full_name),
    birthDate: row.estimated_date_of_birth,
    birthDateReliable: Boolean(row.estimated_date_of_birth) && !row.demographics_estimated,
    sex: row.sex,
    identifiers: unique([row.mrn, row.national_id, row.identifier_value, ...(row.identifiers || [])]),
  };
}

const historicalPatientNameSearch = buildPatientNameSearchSql({
  rawArabic: "n.arabic_name",
  arabic: "n.arabic_name",
  arabicCompact: "n.arabic_compact",
  english: "case when $6 <> '' then n.english_name else null end",
});

const HISTORICAL_NAME_SEARCH_SQL = String.raw`
  with patient_search_trgm_config as materialized (
    select set_config('pg_trgm.strict_word_similarity_threshold', $22::text, true),
      $1::text original_term, $2::text raw_pattern, $4::text normalized_identifier_pattern
  ), candidate_studies as materialized (
    select s.*
    from patient_search_trgm_config
    cross join historical_pacs_studies s
    where nullif(trim(s.patient_id), '') is not null
      and not (s.patient_id = any($23::text[]))
      and (
        ($6 <> '' and (s.normalized_name_primary ilike $17 or s.normalized_name_reordered ilike $17))
        or s.normalized_arabic_name_primary ilike $3 or s.normalized_arabic_name_reordered ilike $3
        or ($13 <> '' and (s.normalized_arabic_compact_primary ilike $14 or s.normalized_arabic_compact_reordered ilike $14))
        or ($11 <> '' and (s.normalized_name_primary ~* $11 or s.normalized_name_reordered ~* $11))
        or ($12 <> '' and (s.normalized_arabic_name_primary ~* $12 or s.normalized_arabic_name_reordered ~* $12))
        or ($5 <> '' and (
          (s.normalized_arabic_name_primary % $5 and similarity(s.normalized_arabic_name_primary, $5) >= $15)
          or (s.normalized_arabic_name_reordered % $5 and similarity(s.normalized_arabic_name_reordered, $5) >= $15)
        ))
        or ($13 <> '' and (
          (s.normalized_arabic_compact_primary % $13 and similarity(s.normalized_arabic_compact_primary, $13) >= $15)
          or (s.normalized_arabic_compact_reordered % $13 and similarity(s.normalized_arabic_compact_reordered, $13) >= $15)
        ))
        or ($6 <> '' and (
          (s.normalized_name_primary % $6 and similarity(s.normalized_name_primary, $6) >= $16)
          or (s.normalized_name_reordered % $6 and similarity(s.normalized_name_reordered, $6) >= $16)
          or patient_english_name_dmetaphone_tokens(s.normalized_name_primary) && patient_english_name_dmetaphone_tokens($6)
          or patient_english_name_dmetaphone_tokens(s.normalized_name_reordered) && patient_english_name_dmetaphone_tokens($6)
        ))
        or ($18::boolean and ($6 <<% s.normalized_name_primary or $6 <<% s.normalized_name_reordered))
        or ($20::boolean and ($5 <<% s.normalized_arabic_name_primary or $5 <<% s.normalized_arabic_name_reordered))
      )
  ), name_rows as materialized (
    select s.*, names.english_name, names.arabic_name, names.arabic_compact
    from candidate_studies s
    cross join lateral (values
      (s.normalized_name_primary, s.normalized_arabic_name_primary, s.normalized_arabic_compact_primary),
      (s.normalized_name_reordered, s.normalized_arabic_name_reordered, s.normalized_arabic_compact_reordered)
    ) names(english_name, arabic_name, arabic_compact)
  ), scored as (
    select n.*,
      ${historicalPatientNameSearch.rankSql} match_rank,
      ${historicalPatientNameSearch.similaritySql} name_similarity,
      phonetic_match.matching_token_count phonetic_match_count,
      case when $6 <> '' then (
        select count(*)::int
        from unnest(regexp_split_to_array(trim(n.english_name), E'\\s+')) candidate_token
        where candidate_token <> ''
          and soundex(candidate_token) in (
            select soundex(search_token)
            from unnest(regexp_split_to_array(trim($6), E'\\s+')) search_token
            where search_token <> ''
          )
      ) else 0 end soundex_match_count
    from name_rows n
    ${historicalPatientNameSearch.phoneticLaterals}
    where ${historicalPatientNameSearch.matchSql}
  )
  select distinct on (patient_id)
    patient_id, patient_name_raw, patient_birth_date, patient_sex,
    match_rank::int, name_similarity::real, phonetic_match_count::int, soundex_match_count::int
  from scored
  order by patient_id, match_rank, name_similarity desc, phonetic_match_count desc, soundex_match_count desc
`;

async function searchNameMatches(term: string, excludedIds: string[]): Promise<NameMatchRow[]> {
  if (!term.trim()) return [];
  const prepared = await preparePatientSearch(term);
  const result = await pool.query<NameMatchRow>(HISTORICAL_NAME_SEARCH_SQL, [...prepared.queryParameters, excludedIds]);
  const matchedArabic = /[\u0600-\u06ff]/.test(term);
  return result.rows.map((row) => ({ ...row, matched_arabic: matchedArabic }));
}

function normalizedDicomDate(value: string | null | undefined): string | null {
  const raw = clean(value).replace(/-/g, "");
  if (!/^\d{8}$/.test(raw)) return null;
  const year = Number(raw.slice(0, 4));
  const month = Number(raw.slice(4, 6));
  const day = Number(raw.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : null;
}

function normalizedSex(value: string | null | undefined): "M" | "F" | null {
  const raw = clean(value).toUpperCase();
  if (["M", "MALE"].includes(raw)) return "M";
  if (["F", "FEMALE"].includes(raw)) return "F";
  return null;
}

function matchReasons(row: NameMatchRow): MatchReason[] {
  const reasons: MatchReason[] = row.matched_arabic
    ? ["arabic_normalized_name"]
    : row.match_rank <= 3
      ? ["arabic_normalized_name"]
      : row.match_rank === 4 || row.match_rank === 7
        ? ["exact_normalized_name"]
        : row.match_rank === 10
          ? ["double_metaphone"]
          : [row.match_rank === 8 ? "arabic_normalized_name" : "fuzzy_english_name"];
  if (!row.matched_arabic && Number(row.soundex_match_count) > 0) reasons.push("soundex");
  return reasons;
}

function birthDatesWithinFiveYears(left: string | null, right: string | null): boolean {
  if (!left || !right || left === right) return false;
  const leftTime = Date.parse(`${left}T00:00:00Z`);
  const rightTime = Date.parse(`${right}T00:00:00Z`);
  return Number.isFinite(leftTime) && Number.isFinite(rightTime) && Math.abs(leftTime - rightTime) <= 5 * 365.25 * 24 * 60 * 60 * 1000;
}

async function loadStudiesForPatientIds(patientIds: string[]): Promise<Map<string, HistoricalPacsStudy[]>> {
  const grouped = new Map<string, HistoricalPacsStudy[]>();
  if (!patientIds.length) return grouped;
  const result = await pool.query<IndexedStudyRow>(
    `select orthanc_study_id,study_instance_uid,accession_number,patient_id,patient_name_raw,patient_birth_date,patient_sex,study_date,study_description,modalities_in_study,series_count,instance_count
     from historical_pacs_studies where patient_id = any($1::text[])
     order by patient_id, study_date desc nulls last, orthanc_study_id`,
    [patientIds],
  );
  for (const row of result.rows) {
    if (!row.patient_id) continue;
    const studies = grouped.get(row.patient_id) || [];
    studies.push(mapStudy(row));
    grouped.set(row.patient_id, studies);
  }
  return grouped;
}

async function loadStudiesForStudyInstanceUids(studyInstanceUids: string[]): Promise<HistoricalPacsStudy[]> {
  const uids = unique(studyInstanceUids);
  if (!uids.length) return [];
  const result = await pool.query<IndexedStudyRow>(
    `select orthanc_study_id,study_instance_uid,accession_number,patient_id,patient_name_raw,patient_birth_date,patient_sex,study_date,study_description,modalities_in_study,series_count,instance_count
     from historical_pacs_studies where study_instance_uid = any($1::text[])
     order by study_date desc nulls last, orthanc_study_id`,
    [uids],
  );
  return result.rows.map(mapStudy);
}

async function exactCandidates(profile: PatientIdentityProfile): Promise<HistoricalPacsCandidate[]> {
  if (!profile.identifiers.length) return [];
  const studiesById = await loadStudiesForPatientIds(profile.identifiers);
  return [...studiesById.entries()].map(([patientId, studies]) => ({
    historicalPatientId: patientId,
    patientName: studies[0]?.patientName || null,
    patientBirthDate: studies[0]?.patientBirthDate || null,
    patientSex: studies[0]?.patientSex || null,
    classification: "exact",
    reasons: ["exact_patient_id"],
    authoritative: true,
    matchRank: 1,
    nameSimilarity: 1,
    phoneticMatchCount: 0,
    studyCount: studies.length,
    studies,
  }));
}

async function fuzzyCandidates(profile: PatientIdentityProfile): Promise<HistoricalPacsCandidate[]> {
  const matches = [...await searchNameMatches(profile.englishName, profile.identifiers), ...await searchNameMatches(profile.arabicName, profile.identifiers)];
  const strongest = new Map<string, NameMatchRow>();
  for (const match of matches) {
    const current = strongest.get(match.patient_id);
    if (!current || match.match_rank < current.match_rank || (match.match_rank === current.match_rank && (Number(match.name_similarity) > Number(current.name_similarity) || (Number(match.name_similarity) === Number(current.name_similarity) && (match.phonetic_match_count > current.phonetic_match_count || (match.phonetic_match_count === current.phonetic_match_count && match.soundex_match_count > current.soundex_match_count)))))) strongest.set(match.patient_id, match);
  }
  const ordered = [...strongest.values()].sort((a, b) => a.match_rank - b.match_rank || Number(b.name_similarity) - Number(a.name_similarity) || b.phonetic_match_count - a.phonetic_match_count || b.soundex_match_count - a.soundex_match_count);
  const eligible = ordered.filter((row) => {
    const pacsSex = normalizedSex(row.patient_sex);
    const risproSex = normalizedSex(profile.sex);
    if (pacsSex && risproSex && pacsSex !== risproSex) return false;
    return true;
  }).slice(0, 20);
  const studiesById = await loadStudiesForPatientIds(eligible.map((row) => row.patient_id));
  const candidates: HistoricalPacsCandidate[] = [];
  for (const row of eligible) {
    const studies = studiesById.get(row.patient_id) || [];
    if (!studies.length) continue;
    const pacsDob = normalizedDicomDate(row.patient_birth_date);
    const risproDob = normalizedDicomDate(profile.birthDate);
    const pacsSex = normalizedSex(row.patient_sex);
    const risproSex = normalizedSex(profile.sex);
    const reasons = matchReasons(row);
    const exactDob = Boolean(profile.birthDateReliable && pacsDob && risproDob && pacsDob === risproDob);
    const ageWithinFiveYears = Boolean(profile.birthDateReliable && birthDatesWithinFiveYears(pacsDob, risproDob));
    const compatibleSex = Boolean(pacsSex && risproSex && pacsSex === risproSex);
    if (exactDob) reasons.push("exact_dob");
    if (ageWithinFiveYears) reasons.push("age_within_5_years");
    if (compatibleSex) reasons.push("compatible_sex");
    const veryStrongName = row.match_rank <= 4 || (row.match_rank <= 9 && Number(row.name_similarity) >= 0.75);
    candidates.push({
      historicalPatientId: row.patient_id,
      patientName: row.patient_name_raw,
      patientBirthDate: row.patient_birth_date,
      patientSex: row.patient_sex,
      classification: veryStrongName && exactDob ? "strong_demographic" : "possible",
      reasons,
      authoritative: false,
      matchRank: row.match_rank,
      nameSimilarity: Number(row.name_similarity),
      phoneticMatchCount: Number(row.phonetic_match_count),
      studyCount: studies.length,
      studies,
    });
  }
  const first = candidates[0];
  const second = candidates[1];
  if (first && second && first.classification !== "strong_demographic" && second.matchRank === first.matchRank && Math.abs(second.nameSimilarity - first.nameSimilarity) <= 0.05) {
    for (const candidate of candidates.filter((item) => item.classification !== "strong_demographic" && item.matchRank === first.matchRank && Math.abs(item.nameSimilarity - first.nameSimilarity) <= 0.05)) {
      candidate.classification = "ambiguous";
      candidate.reasons.push("multiple_competing_identities");
    }
  }
  return candidates;
}

export interface HistoricalPacsIndexState { status: HistoricalPacsIndexStatus; lastSuccessAt: string | null }

export async function getHistoricalPacsIndexState(): Promise<HistoricalPacsIndexState> {
  const result = await pool.query<{ last_full_sync_at: string | null; last_success_at: string | null; last_error: string | null; study_count: number; is_fresh: boolean }>(
    `select state.last_full_sync_at::text,state.last_success_at::text,state.last_error,
       state.last_success_at >= clock_timestamp() - ($1::bigint * interval '1 millisecond') is_fresh,
       (select count(*)::int from historical_pacs_studies) study_count
     from historical_pacs_sync_state state where singleton_key=true`,
    [HISTORICAL_PACS_INDEX_FRESHNESS_MS],
  );
  const row = result.rows[0];
  if (!row?.last_full_sync_at) return { status: row?.last_error && Number(row.study_count) === 0 ? "unavailable" : "uninitialized", lastSuccessAt: row?.last_success_at ?? null };
  if (row.last_error) return { status: Number(row.study_count) === 0 ? "unavailable" : "stale", lastSuccessAt: row.last_success_at };
  return { status: row.is_fresh ? "ready" : "stale", lastSuccessAt: row.last_success_at };
}

export async function getHistoricalPacsIndexStatus(): Promise<HistoricalPacsIndexStatus> { return (await getHistoricalPacsIndexState()).status; }

export async function discoverHistoricalPacsForPatient(patientId: number, studyInstanceUids: string[] = []): Promise<HistoricalPacsDiscoveryResult> {
  const profile = await loadPatientProfile(patientId);
  const [exact, uidStudies, fuzzy, indexState] = await Promise.all([exactCandidates(profile), loadStudiesForStudyInstanceUids(studyInstanceUids), fuzzyCandidates(profile), getHistoricalPacsIndexState()]);
  const reconciliationStudies = new Map<string, OrthancStudyDetails>();
  for (const study of [...exact.flatMap((candidate) => candidate.studies), ...uidStudies]) reconciliationStudies.set(study.orthancStudyId, toOrthancStudy(study));
  return {
    exactStudies: [...reconciliationStudies.values()],
    candidates: fuzzy,
    indexStatus: indexState.status,
    lastSuccessAt: indexState.lastSuccessAt,
    knownPatientIds: profile.identifiers,
  };
}

export async function lookupHistoricalPacsByPatientId(patientId: string, lookupClient?: HistoricalPacsPatientLookupClient): Promise<HistoricalPacsCandidate[]> {
  const exactPatientId = clean(patientId);
  if (!exactPatientId) throw new HttpError(400, "Old PACS Patient ID is required.");
  if (exactPatientId.length > 256) throw new HttpError(400, "Old PACS Patient ID is too long.");
  const client = lookupClient ?? await createAuthoritativeOrthancClient();
  const studies = (await client.listStudiesByPatientId(exactPatientId)).filter((study) => clean(study.patientId) === exactPatientId);
  if (!studies.length) return [];
  return [{
    historicalPatientId: exactPatientId,
    patientName: studies[0]?.patientName || null,
    patientBirthDate: studies[0]?.patientBirthDate || null,
    patientSex: studies[0]?.patientSex || null,
    classification: "exact",
    reasons: ["exact_patient_id"],
    authoritative: false,
    matchRank: 1,
    nameSimilarity: 1,
    phoneticMatchCount: 0,
    studyCount: studies.length,
    studies,
  }];
}

async function recordSyncFailure(error: unknown, db: Queryable = pool): Promise<void> {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
  await db.query(`update historical_pacs_sync_state set last_attempt_at=now(),last_error=$1,updated_at=now() where singleton_key=true`, [message]);
}

async function readChangesTail(client: HistoricalPacsSyncClient): Promise<number> {
  let since = 0;
  for (;;) {
    const page = await client.getChanges(since, 1000);
    if (!page.done && page.lastSequence <= since) throw new Error("Authoritative Orthanc changes cursor did not advance.");
    since = page.lastSequence;
    if (page.done) return since;
  }
}

export async function reconcileHistoricalPacsIndex(client: HistoricalPacsSyncClient, db: Queryable = pool): Promise<{ indexed: number; removed: number; lastSequence: number }> {
  const marker = await db.query<{ reconciliation_marker: string }>(`select clock_timestamp()::text reconciliation_marker`);
  const reconciliationMarker = marker.rows[0]?.reconciliation_marker;
  if (!reconciliationMarker) throw new Error("Could not establish the historical PACS reconciliation marker.");
  const state = await db.query<{ last_change_sequence: string | null }>(`select last_change_sequence::text from historical_pacs_sync_state where singleton_key=true`);
  const baselineSequence = state.rows[0]?.last_change_sequence == null ? await readChangesTail(client) : Number(state.rows[0].last_change_sequence);
  let indexed = 0;
  let since = 0;
  for (;;) {
    const page = await client.listStudiesForIndexPage(since, FULL_STUDY_PAGE_SIZE);
    indexed += await upsertHistoricalPacsStudies(page.studies, db, reconciliationMarker);
    if (page.resourceCount < FULL_STUDY_PAGE_SIZE) break;
    if (page.resourceCount <= 0) throw new Error("Authoritative Orthanc study inventory cursor did not advance.");
    since += page.resourceCount;
  }
  const removed = await db.query(`delete from historical_pacs_studies where synchronized_at < $1::timestamptz`, [reconciliationMarker]);
  const catchup = await drainChanges(client, baselineSequence, db);
  await db.query(
    `update historical_pacs_sync_state set last_change_sequence=$1,last_full_sync_at=now(),last_success_at=now(),last_attempt_at=now(),last_error=null,updated_at=now() where singleton_key=true`,
    [catchup.lastSequence],
  );
  return { indexed: indexed + catchup.upserted, removed: (removed.rowCount || 0) + catchup.removed, lastSequence: catchup.lastSequence };
}

async function applyChangePage(client: HistoricalPacsSyncClient, page: OrthancChangesPage, db: Queryable): Promise<{ upserted: number; removed: number }> {
  const latestStudyChanges = new Map<string, "upsert" | "delete">();
  for (const change of page.changes) {
    if (!change.resourceId) continue;
    if (change.changeType === "Deleted" && change.resourceType === "Study") latestStudyChanges.set(change.resourceId, "delete");
    else if (["NewStudy", "StableStudy"].includes(change.changeType)) latestStudyChanges.set(change.resourceId, "upsert");
  }
  let upserted = 0;
  let removed = 0;
  const deletedIds = [...latestStudyChanges].filter(([, operation]) => operation === "delete").map(([id]) => id);
  if (deletedIds.length) {
    const result = await db.query(`delete from historical_pacs_studies where orthanc_study_id=any($1::text[])`, [deletedIds]);
    removed = result.rowCount || 0;
  }
  const upsertIds = [...latestStudyChanges].filter(([, operation]) => operation === "upsert").map(([id]) => id);
  for (let offset = 0; offset < upsertIds.length; offset += STUDY_BATCH_SIZE) {
    const details = (await Promise.all(upsertIds.slice(offset, offset + STUDY_BATCH_SIZE).map((id) => client.getStudyForIndex(id)))).filter((study): study is OrthancStudyDetails => study !== null);
    upserted += await upsertHistoricalPacsStudies(details, db);
  }
  return { upserted, removed };
}

async function drainChanges(client: HistoricalPacsSyncClient, since: number, db: Queryable): Promise<{ upserted: number; removed: number; lastSequence: number }> {
  let cursor = since;
  let upserted = 0;
  let removed = 0;
  for (;;) {
    const page = await client.getChanges(cursor, CHANGE_BATCH_SIZE);
    if (!page.done && page.lastSequence <= cursor) throw new Error("Authoritative Orthanc changes cursor did not advance.");
    const applied = await applyChangePage(client, page, db);
    upserted += applied.upserted;
    removed += applied.removed;
    cursor = page.lastSequence;
    if (page.done) return { upserted, removed, lastSequence: cursor };
  }
}

async function applyChanges(client: HistoricalPacsSyncClient, since: number, db: Queryable): Promise<{ upserted: number; removed: number; lastSequence: number }> {
  const result = await drainChanges(client, since, db);
  await db.query(`update historical_pacs_sync_state set last_change_sequence=$1,last_success_at=now(),last_attempt_at=now(),last_error=null,updated_at=now() where singleton_key=true`, [result.lastSequence]);
  return result;
}

export async function runHistoricalPacsSyncCycle(clientFactory: () => Promise<HistoricalPacsSyncClient> = createAuthoritativeOrthancClient): Promise<{ lockAcquired: boolean; mode: "full" | "incremental" | "failed"; indexed: number; removed: number }> {
  const db = await pool.connect();
  try {
    const lock = await db.query<{ acquired: boolean }>(`select pg_try_advisory_lock($1) acquired`, [SYNC_LOCK_KEY]);
    if (!lock.rows[0]?.acquired) return { lockAcquired: false, mode: "incremental", indexed: 0, removed: 0 };
    try {
      const state = await db.query<{ last_change_sequence: string | null; last_full_sync_at: string | null }>(`select last_change_sequence::text,last_full_sync_at::text from historical_pacs_sync_state where singleton_key=true`);
      const lastFull = state.rows[0]?.last_full_sync_at ? new Date(state.rows[0].last_full_sync_at).getTime() : 0;
      const client = await clientFactory();
      if (!lastFull || Date.now() - lastFull >= FULL_RECONCILIATION_INTERVAL_MS) {
        const result = await reconcileHistoricalPacsIndex(client, db);
        return { lockAcquired: true, mode: "full", indexed: result.indexed, removed: result.removed };
      }
      const result = await applyChanges(client, Number(state.rows[0]?.last_change_sequence || 0), db);
      return { lockAcquired: true, mode: "incremental", indexed: result.upserted, removed: result.removed };
    } catch (error) {
      await recordSyncFailure(error, db);
      return { lockAcquired: true, mode: "failed", indexed: 0, removed: 0 };
    } finally {
      await db.query(`select pg_advisory_unlock($1)`, [SYNC_LOCK_KEY]).catch(() => null);
    }
  } finally {
    db.release();
  }
}

export interface HistoricalPacsSyncWorker { stop(): Promise<void>; }
let syncRunning = false;
let syncStopped = false;
let syncInterval: NodeJS.Timeout | null = null;

export async function startHistoricalPacsSyncWorker(options: { intervalMs?: number } = {}): Promise<HistoricalPacsSyncWorker> {
  const intervalMs = Math.max(30_000, options.intervalMs ?? DEFAULT_SYNC_INTERVAL_MS);
  syncStopped = false;
  const tick = async () => {
    if (syncRunning || syncStopped) return;
    syncRunning = true;
    try {
      const result = await runHistoricalPacsSyncCycle();
      console.info(JSON.stringify({ type: "historical_pacs_sync_tick", worker: `${os.hostname()}:${process.pid}`, ...result }));
    } finally {
      syncRunning = false;
    }
  };
  void tick().catch((error) => console.warn(JSON.stringify({ type: "historical_pacs_sync_tick_failed", error: error instanceof Error ? error.message : String(error) })));
  syncInterval = setInterval(() => { void tick().catch((error) => console.warn(JSON.stringify({ type: "historical_pacs_sync_tick_failed", error: error instanceof Error ? error.message : String(error) }))); }, intervalMs);
  syncInterval.unref();
  return { async stop() { syncStopped = true; if (syncInterval) { clearInterval(syncInterval); syncInterval = null; } while (syncRunning) await new Promise((resolve) => setTimeout(resolve, 50)); } };
}
