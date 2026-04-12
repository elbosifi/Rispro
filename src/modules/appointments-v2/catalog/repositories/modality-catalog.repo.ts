/**
 * Appointments V2 — Modality catalog repository.
 *
 * Queries the legacy modalities table (read-only, V2 does not own this table).
 */

import type { PoolClient } from "pg";

export interface ModalityRow {
  id: number;
  name: string;
  nameAr: string;
  nameEn: string;
  code: string;
  dailyCapacity: number;
  isActive: boolean;
}

const FIND_BY_ID_SQL = `
  select id, name_ar as "nameAr", name_en as "nameEn", name_en as "name", code, daily_capacity as "dailyCapacity", is_active as "isActive"
  from modalities
  where id = $1
`;

const LIST_ACTIVE_SQL = `
  select id, name_ar as "nameAr", name_en as "nameEn", name_en as "name", code, daily_capacity as "dailyCapacity", is_active as "isActive"
  from modalities
  where is_active = true
  order by name_en
`;

export async function findModalityById(
  client: PoolClient,
  modalityId: number
): Promise<ModalityRow | null> {
  const result = await client.query<ModalityRow>(FIND_BY_ID_SQL, [modalityId]);
  return result.rows[0] ?? null;
}

export async function listActiveModalities(
  client: PoolClient
): Promise<ModalityRow[]> {
  const result = await client.query<ModalityRow>(LIST_ACTIVE_SQL);
  return result.rows;
}
