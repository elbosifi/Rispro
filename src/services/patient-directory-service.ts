import { pool } from "../db/pool.js";
import {
  PATIENT_SEARCH_CANDIDATE_IDS_CTE,
  PATIENT_SEARCH_MATCH_SQL,
  PATIENT_SEARCH_PHONETIC_LATERALS,
  PATIENT_SEARCH_RANK_SQL,
  PATIENT_SEARCH_SIMILARITY_SQL,
  preparePatientSearch,
} from "./patient-search-query.js";

export interface PatientDirectoryParams {
  search?: string;
  category?: "oncology" | "non_oncology";
  appointmentFilter?: "has_future" | "today" | "no_future";
  sex?: "male" | "female";
  ageMin?: number;
  ageMax?: number;
  sortBy?: "name" | "recent" | "mrn";
  page?: number;
  pageSize?: number;
}

export interface PatientDirectoryRowOutput {
  id: number;
  mrn: string | null;
  arabicFullName: string;
  englishFullName: string | null;
  sex: string | null;
  ageYears: number;
  demographicsEstimated: boolean;
  phone1: string | null;
  category: "oncology" | "non_oncology" | null;
  lastAppointment: {
    id: number;
    date: string;
    status: string;
    modalityName: string;
  } | null;
  nextAppointment: {
    id: number;
    date: string;
    status: string;
    modalityName: string;
  } | null;
  warnings: {
    missingPhone: boolean;
    missingDob: boolean;
    missingSex: boolean;
    missingName: boolean;
    noAppointment: boolean;
    possibleDuplicate: boolean;
    duplicateReasons: string[];
  };
}

export interface PatientDirectoryResult {
  patients: PatientDirectoryRowOutput[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

function addSqlParam(values: unknown[], value: unknown): string {
  values.push(value);
  return `$${values.length}`;
}

function getAppointmentFilterClause(filter?: string): string {
  if (!filter) return "";
  switch (filter) {
    case "has_future":
      return " and exists (select 1 from appointments_v2.bookings b2 where b2.patient_id = p.id and b2.booking_date >= current_date and b2.status in ('scheduled', 'arrived', 'waiting'))";
    case "today":
      return " and exists (select 1 from appointments_v2.bookings b2 where b2.patient_id = p.id and b2.booking_date = current_date and b2.status in ('scheduled', 'arrived', 'waiting'))";
    case "no_future":
      return " and not exists (select 1 from appointments_v2.bookings b2 where b2.patient_id = p.id and b2.booking_date >= current_date and b2.status in ('scheduled', 'arrived', 'waiting'))";
    default:
      return "";
  }
}

function buildPatientDirectoryWhere(params: {
  sex?: "male" | "female";
  ageMin?: number;
  ageMax?: number;
  category?: "oncology" | "non_oncology";
  appointmentFilter?: "has_future" | "today" | "no_future";
}, initialValues: unknown[] = []): { where: string; values: unknown[] } {
  const values = [...initialValues];
  const clauses: string[] = [];

  const normalizedSex = String(params.sex || "").trim().toLowerCase();
  if (normalizedSex === "male" || normalizedSex === "m") {
    clauses.push("lower(coalesce(p.sex, '')) in ('m', 'male')");
  } else if (normalizedSex === "female" || normalizedSex === "f") {
    clauses.push("lower(coalesce(p.sex, '')) in ('f', 'female')");
  }

  if (params.ageMin || params.ageMax) {
    clauses.push(`p.age_years >= ${addSqlParam(values, params.ageMin || 0)}`);
    clauses.push(`p.age_years <= ${addSqlParam(values, params.ageMax || 200)}`);
  }

  if (params.category === "oncology" || params.category === "non_oncology") {
    clauses.push(`p.category = ${addSqlParam(values, params.category)}`);
  }

  const appointmentFilterClause = getAppointmentFilterClause(params.appointmentFilter).trim();
  if (appointmentFilterClause) {
    clauses.push(appointmentFilterClause.replace(/^and\s+/i, ""));
  }

  return {
    where: clauses.length > 0 ? clauses.join("\n      and ") : "1=1",
    values,
  };
}

export async function getPatientDirectory(params: PatientDirectoryParams): Promise<PatientDirectoryResult> {
  const term = (params.search || "").trim();
  const category = params.category;
  const appointmentFilter = params.appointmentFilter;
  const sex = params.sex;
  const ageMin = params.ageMin;
  const ageMax = params.ageMax;
  const sortBy = params.sortBy || "name";
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(params.pageSize) || 25));
  const offset = (page - 1) * pageSize;
  const preparedSearch = await preparePatientSearch(term);
  const searchValues = term ? preparedSearch.queryParameters : [];

  const directoryWhere = buildPatientDirectoryWhere({
    sex,
    ageMin,
    ageMax,
    category,
    appointmentFilter,
  }, searchValues);

  const searchCtes = term ? String.raw`
    ${PATIENT_SEARCH_CANDIDATE_IDS_CTE},
    search_matched_patients as materialized (
      select
        p.*,
        ${PATIENT_SEARCH_RANK_SQL} as search_rank,
        ${PATIENT_SEARCH_SIMILARITY_SQL} as search_similarity,
        phonetic_match.matching_token_count as search_phonetic_count
      from candidate_ids candidate
      join patients p on p.id = candidate.id
      ${PATIENT_SEARCH_PHONETIC_LATERALS}
      where ${PATIENT_SEARCH_MATCH_SQL}
    )` : "";
  const patientSource = term ? "search_matched_patients p" : "patients p";

  const countQuery = `
    ${term ? `with ${searchCtes}` : ""}
    select count(*)::bigint as total
    from ${patientSource}
    where ${directoryWhere.where}
  `;

  const countResult = await pool.query<{ total: string }>(countQuery, directoryWhere.values);
  const total = Number(countResult.rows[0]?.total || 0);
  const totalPages = Math.ceil(total / pageSize);

  let orderBy = "fp.normalized_arabic_name asc, fp.arabic_full_name asc";
  if (sortBy === "recent") {
    orderBy = "fp.id desc";
  } else if (sortBy === "mrn") {
    orderBy = "fp.mrn asc nulls last, fp.id desc";
  }
  if (term) {
    if (sortBy === "recent") {
      orderBy = "fp.rank asc, fp.search_similarity desc, fp.search_phonetic_count desc, fp.id desc";
    } else if (sortBy === "mrn") {
      orderBy = "fp.rank asc, fp.search_similarity desc, fp.search_phonetic_count desc, fp.mrn asc nulls last, fp.id desc";
    } else {
      orderBy = "fp.rank asc, fp.search_similarity desc, fp.search_phonetic_count desc, fp.normalized_arabic_name asc, fp.arabic_full_name asc";
    }
  }

  const queryParams = [...directoryWhere.values];
  const pageSizeParam = addSqlParam(queryParams, pageSize);
  const offsetParam = addSqlParam(queryParams, offset);

  const query = `
    with
    ${term ? `${searchCtes},` : ""}
    filtered_patients as (
      select
        p.id,
        p.mrn,
        p.arabic_full_name,
        p.english_full_name,
        p.sex,
        p.age_years,
        p.demographics_estimated,
        p.phone_1,
        p.category,
        p.normalized_arabic_name,
        p.estimated_date_of_birth,
        ${term ? "p.search_rank" : "99"} as rank,
        ${term ? "p.search_similarity" : "0"} as search_similarity,
        ${term ? "p.search_phonetic_count" : "0"} as search_phonetic_count
      from ${patientSource}
      where ${directoryWhere.where}
    )
    select
      fp.id,
      fp.mrn,
      fp.arabic_full_name,
      fp.english_full_name,
      fp.sex,
      fp.age_years,
      fp.demographics_estimated,
      fp.phone_1,
      fp.category,
      (
        select json_build_object('id', b.id, 'date', b.booking_date::text, 'status', b.status, 'modalityName', m.name_en)
        from appointments_v2.bookings b
        join modalities m on m.id = b.modality_id
        where b.patient_id = fp.id and b.booking_date < current_date and b.status not in ('cancelled', 'voided')
        order by b.booking_date desc
        limit 1
      ) as last_appointment,
      (
        select json_build_object('id', b.id, 'date', b.booking_date::text, 'status', b.status, 'modalityName', m.name_en)
        from appointments_v2.bookings b
        join modalities m on m.id = b.modality_id
        where b.patient_id = fp.id and b.booking_date >= current_date and b.status not in ('cancelled', 'voided')
        order by b.booking_date asc
        limit 1
      ) as next_appointment,
      json_build_object(
        'missingPhone', fp.phone_1 is null or fp.phone_1 = '',
        'missingDob', fp.estimated_date_of_birth is null,
        'missingSex', fp.sex is null or fp.sex = '',
        'missingName', fp.arabic_full_name is null or fp.arabic_full_name = '',
        'noAppointment', not exists (
          select 1 from appointments_v2.bookings b2
          where b2.patient_id = fp.id and b2.status not in ('cancelled', 'voided')
        ),
        'possibleDuplicate', false,
        'duplicateReasons', array[]::text[]
      ) as warnings
    from filtered_patients fp
    order by ${orderBy}
    limit ${pageSizeParam} offset ${offsetParam}
  `;

  const { rows } = await pool.query<Record<string, unknown>>(query, queryParams);

  return {
    patients: rows.map(row => {
      const warnings = (row.warnings as {
        missingPhone?: boolean;
        missingDob?: boolean;
        missingSex?: boolean;
        missingName?: boolean;
        noAppointment?: boolean;
        possibleDuplicate?: boolean;
        duplicateReasons?: string[];
      }) || {};

      return {
        id: Number(row.id ?? 0),
        mrn: (row.mrn as string | null) ?? null,
        arabicFullName: String(row.arabic_full_name ?? ""),
        englishFullName: (row.english_full_name as string | null) ?? null,
        sex: (row.sex as string | null) ?? null,
        ageYears: Number(row.age_years ?? 0),
        demographicsEstimated: Boolean(row.demographics_estimated),
        phone1: (row.phone_1 as string | null) ?? null,
        category: row.category as "oncology" | "non_oncology" | null,
        lastAppointment: (row.last_appointment as PatientDirectoryRowOutput["lastAppointment"]) || null,
        nextAppointment: (row.next_appointment as PatientDirectoryRowOutput["nextAppointment"]) || null,
        warnings: {
          missingPhone: Boolean(warnings.missingPhone),
          missingDob: Boolean(warnings.missingDob),
          missingSex: Boolean(warnings.missingSex),
          missingName: Boolean(warnings.missingName),
          noAppointment: Boolean(warnings.noAppointment),
          possibleDuplicate: Boolean(warnings.possibleDuplicate),
          duplicateReasons: warnings.duplicateReasons || []
        }
      };
    }),
    pagination: {
      page,
      pageSize,
      total,
      totalPages
    }
  };
}
