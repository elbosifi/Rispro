/**
 * Appointments V2 — Exam type catalog repository.
 *
 * Queries the legacy exam_types table (read-only, V2 does not own this table).
 */

import type { PoolClient } from "pg";

export interface ExamTypeRow {
  id: number;
  name: string;
  nameAr: string;
  nameEn: string;
  modalityId: number | null;
  isActive: boolean;
}

const FIND_BY_ID_SQL = `
  select id, name_ar as "nameAr", name_en as "nameEn", name_en as "name", modality_id as "modalityId", is_active as "isActive"
  from exam_types
  where id = $1
`;

const LIST_FOR_MODALITY_SQL = `
  select id, name_ar as "nameAr", name_en as "nameEn", name_en as "name", modality_id as "modalityId", is_active as "isActive"
  from exam_types
  where modality_id = $1
    and is_active = true
  order by name_en
`;

export async function findExamTypeById(
  client: PoolClient,
  examTypeId: number
): Promise<ExamTypeRow | null> {
  const result = await client.query<ExamTypeRow>(FIND_BY_ID_SQL, [examTypeId]);
  return result.rows[0] ?? null;
}

export async function listExamTypesForModality(
  client: PoolClient,
  modalityId: number
): Promise<ExamTypeRow[]> {
  const result = await client.query<ExamTypeRow>(LIST_FOR_MODALITY_SQL, [modalityId]);
  return result.rows;
}
