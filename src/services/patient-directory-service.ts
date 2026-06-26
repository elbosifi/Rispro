import { pool } from "../db/pool.js";
import { normalizeIdentifierValue } from "../utils/identifier.js";
import { normalizeArabicName, normalizeArabicNameCompact } from "../utils/normalize.js";

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
  term: string;
  normalizedTerm: string;
  normalizedArabicCompactTerm: string;
  normalizedPattern: string;
  normalizedCompactPattern: string;
  normalizedIdentifierPattern: string;
  sex?: "male" | "female";
  ageMin?: number;
  ageMax?: number;
  category?: "oncology" | "non_oncology";
  appointmentFilter?: "has_future" | "today" | "no_future";
}): { where: string; values: unknown[] } {
  const values: unknown[] = [];
  const clauses: string[] = [];

  if (params.term) {
    const normalizedTermParam = addSqlParam(values, params.normalizedTerm);
    const normalizedPatternParam = addSqlParam(values, params.normalizedPattern);
    const compactTermParam = addSqlParam(values, params.normalizedArabicCompactTerm);
    const compactPatternParam = addSqlParam(values, params.normalizedCompactPattern);
    const identifierPatternParam = addSqlParam(values, params.normalizedIdentifierPattern);
    clauses.push(`(
      p.mrn ilike ${normalizedTermParam}
      or p.national_id ilike ${normalizedTermParam}
      or p.identifier_value ilike ${normalizedTermParam}
      or p.phone_1 ilike ${normalizedTermParam}
      or p.phone_2 ilike ${normalizedTermParam}
      or p.arabic_full_name ilike ${normalizedTermParam}
      or p.normalized_arabic_name ilike ${normalizedPatternParam}
      or (
        ${compactTermParam} <> ''
        and coalesce(p.normalized_arabic_name_compact, regexp_replace(p.normalized_arabic_name, '\\s+', '', 'g')) <> ''
        and coalesce(p.normalized_arabic_name_compact, regexp_replace(p.normalized_arabic_name, '\\s+', '', 'g')) ilike ${compactPatternParam}
      )
      or p.english_full_name ilike ${normalizedTermParam}
      or exists (
        select 1 from patient_identifiers pi
        where pi.patient_id = p.id and (pi.value ilike ${normalizedTermParam} or pi.normalized_value ilike ${identifierPatternParam})
      )
    )`);
  }

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

  const normalizedTerm = term ? `%${term}%` : "%";
  const normalizedArabicTerm = term ? normalizeArabicName(term) : "";
  const normalizedArabicCompactTerm = term ? normalizeArabicNameCompact(term) : "";
  const normalizedPattern = normalizedArabicTerm ? `%${normalizedArabicTerm}%` : "%";
  const normalizedCompactPattern = normalizedArabicCompactTerm ? `%${normalizedArabicCompactTerm}%` : "%";
  const normalizedIdentifierPattern = term ? `%${normalizeIdentifierValue(term)}%` : "%";
  const normalizedEnglishTerm = term.toLowerCase().replace(/\s+/g, " ").trim();
  const normalizedArabicPrefixPattern = `${normalizedArabicTerm}%`;
  const normalizedEnglishPrefixPattern = `${normalizedEnglishTerm}%`;
  const normalizedArabicLaterTokenPattern = `% ${normalizedArabicTerm}%`;
  const normalizedEnglishLaterTokenPattern = `% ${normalizedEnglishTerm}%`;

  const directoryWhere = buildPatientDirectoryWhere({
    term,
    normalizedTerm,
    normalizedArabicCompactTerm,
    normalizedPattern,
    normalizedCompactPattern,
    normalizedIdentifierPattern,
    sex,
    ageMin,
    ageMax,
    category,
    appointmentFilter,
  });

  const countQuery = `select count(*)::bigint as total from patients p where ${directoryWhere.where}`;

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
      orderBy = "fp.rank asc, fp.id desc";
    } else if (sortBy === "mrn") {
      orderBy = "fp.rank asc, fp.mrn asc nulls last, fp.id desc";
    } else {
      orderBy = "fp.rank asc, fp.normalized_arabic_name asc, fp.arabic_full_name asc";
    }
  }

  const queryParams = [...directoryWhere.values];
  const termParam = addSqlParam(queryParams, term);
  const rankTermParam = addSqlParam(queryParams, normalizedTerm);
  const exactArabicParam = addSqlParam(queryParams, normalizedArabicTerm);
  const compactTermParam = addSqlParam(queryParams, normalizedArabicCompactTerm);
  const exactEnglishParam = addSqlParam(queryParams, normalizedEnglishTerm);
  const arabicPrefixParam = addSqlParam(queryParams, normalizedArabicPrefixPattern);
  const englishPrefixParam = addSqlParam(queryParams, normalizedEnglishPrefixPattern);
  const arabicLaterTokenParam = addSqlParam(queryParams, normalizedArabicLaterTokenPattern);
  const englishLaterTokenParam = addSqlParam(queryParams, normalizedEnglishLaterTokenPattern);
  const pageSizeParam = addSqlParam(queryParams, pageSize);
  const offsetParam = addSqlParam(queryParams, offset);

  const query = `
    with filtered_patients as (
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
        case
          when ${termParam} = '' then 99
          when p.mrn ilike ${rankTermParam}
            or p.national_id ilike ${rankTermParam}
            or p.identifier_value ilike ${rankTermParam}
            or p.phone_1 ilike ${rankTermParam}
            or p.phone_2 ilike ${rankTermParam} then 1
          when p.normalized_arabic_name = ${exactArabicParam} then 2
          when ${compactTermParam} <> ''
            and coalesce(p.normalized_arabic_name_compact, regexp_replace(p.normalized_arabic_name, '\\s+', '', 'g')) <> ''
            and coalesce(p.normalized_arabic_name_compact, regexp_replace(p.normalized_arabic_name, '\\s+', '', 'g')) = ${compactTermParam} then 2
          when lower(regexp_replace(coalesce(p.english_full_name, ''), '\\s+', ' ', 'g')) = ${exactEnglishParam} then 2
          when split_part(p.normalized_arabic_name, ' ', 1) = ${exactArabicParam} then 3
          when split_part(lower(regexp_replace(coalesce(p.english_full_name, ''), '\\s+', ' ', 'g')), ' ', 1) = ${exactEnglishParam} then 3
          when split_part(p.normalized_arabic_name, ' ', 1) like ${arabicPrefixParam} then 4
          when split_part(lower(regexp_replace(coalesce(p.english_full_name, ''), '\\s+', ' ', 'g')), ' ', 1) like ${englishPrefixParam} then 4
          when p.normalized_arabic_name like ${arabicPrefixParam} then 6
          when lower(regexp_replace(coalesce(p.english_full_name, ''), '\\s+', ' ', 'g')) like ${englishPrefixParam} then 6
          when p.normalized_arabic_name like ${arabicLaterTokenParam} then 7
          when lower(regexp_replace(coalesce(p.english_full_name, ''), '\\s+', ' ', 'g')) like ${englishLaterTokenParam} then 7
          else 8
        end as rank
      from patients p
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
