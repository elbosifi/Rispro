import { pool } from "../../../db/pool.js";

const EDITORIAL_CATALOG_LIMIT = 100;

export async function listTeachingSources(search?: string) {
  const query = search?.trim().slice(0, 200) || null;
  const result = await pool.query<{
    id: string | number; source_type: string; title: string | null; organization: string | null; authors: string[];
    edition: string | null; year: number | null; chapter: string | null; page: string | null; exam_name: string | null;
    exam_sitting: string | null; exam_paper: string | null; question_number: string | null; url: string | null;
    doi: string | null; notes: string | null; metadata: Record<string, unknown>;
  }>(
    `select id, source_type, title, organization, authors, edition, year, chapter, page, exam_name, exam_sitting,
       exam_paper, question_number, url, doi, notes, metadata_json as metadata
     from teaching.sources
     where $1::text is null or title ilike '%' || $1 || '%' or organization ilike '%' || $1 || '%'
       or array_to_string(authors, ' ') ilike '%' || $1 || '%'
     order by title nulls last, source_type, id limit $2`,
    [query, EDITORIAL_CATALOG_LIMIT],
  );
  return result.rows.map((row) => ({
    id: Number(row.id), sourceType: row.source_type, title: row.title, organization: row.organization,
    authors: row.authors, edition: row.edition, year: row.year, chapter: row.chapter, page: row.page,
    examName: row.exam_name, examSitting: row.exam_sitting, examPaper: row.exam_paper,
    questionNumber: row.question_number, url: row.url, doi: row.doi, notes: row.notes, metadata: row.metadata,
  }));
}

export async function listTeachingReferences(search?: string) {
  const query = search?.trim().slice(0, 200) || null;
  const result = await pool.query<{
    id: string | number; reference_type: string; title: string; organization: string | null; authors: string[];
    year: number | null; edition: string | null; url: string | null; doi: string | null;
    citation_text: string | null; notes: string | null;
  }>(
    `select id, reference_type, title, organization, authors, year, edition, url, doi, citation_text, notes
     from teaching."references"
     where $1::text is null or title ilike '%' || $1 || '%' or organization ilike '%' || $1 || '%'
       or array_to_string(authors, ' ') ilike '%' || $1 || '%'
     order by title, id limit $2`,
    [query, EDITORIAL_CATALOG_LIMIT],
  );
  return result.rows.map((row) => ({
    id: Number(row.id), referenceType: row.reference_type, title: row.title, organization: row.organization,
    authors: row.authors, year: row.year, edition: row.edition, url: row.url, doi: row.doi,
    citationText: row.citation_text, notes: row.notes,
  }));
}

export async function listTeachingCases(search?: string) {
  const query = search?.trim().slice(0, 200) || null;
  const result = await pool.query<{
    id: string | number; external_id: string; specialty_code: string; title: string | null; clinical_history: string | null;
  }>(
    `select case_row.id, case_row.external_id, specialty.code as specialty_code, case_row.title, case_row.clinical_history
     from teaching.cases case_row join teaching.specialties specialty on specialty.id = case_row.specialty_id
     where $1::text is null or case_row.external_id ilike '%' || $1 || '%' or case_row.title ilike '%' || $1 || '%'
     order by case_row.updated_at desc, case_row.id desc limit $2`,
    [query, EDITORIAL_CATALOG_LIMIT],
  );
  return result.rows.map((row) => ({
    id: Number(row.id), externalId: row.external_id, specialtyCode: row.specialty_code,
    title: row.title, clinicalHistory: row.clinical_history,
  }));
}

export async function listTeachingAssets(search?: string) {
  const query = search?.trim().slice(0, 200) || null;
  const result = await pool.query<{
    id: string | number; mime_type: string; original_filename: string; alt_text: string; size_bytes: string | number;
  }>(
    `select id, mime_type, original_filename, alt_text, size_bytes from teaching.assets
     where $1::text is null or original_filename ilike '%' || $1 || '%' or alt_text ilike '%' || $1 || '%'
     order by created_at desc, id desc limit $2`,
    [query, EDITORIAL_CATALOG_LIMIT],
  );
  return result.rows.map((row) => ({
    id: Number(row.id), mimeType: row.mime_type, originalFilename: row.original_filename,
    altText: row.alt_text, sizeBytes: Number(row.size_bytes),
  }));
}
