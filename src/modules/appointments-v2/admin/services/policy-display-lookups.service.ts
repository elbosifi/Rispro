import type { PoolClient } from "pg";
import type {
  PolicySnapshotDto,
  PolicyDisplayLookupsDto,
} from "../../api/dto/admin-scheduling.dto.js";

export interface PolicyDisplayLookupIds {
  modalityIds: number[];
  examTypeIds: number[];
  userIds: number[];
}

function addNumber(target: Set<number>, value: number | null | undefined): void {
  const next = Number(value);
  if (Number.isInteger(next) && next > 0) target.add(next);
}

export function collectPolicyDisplayLookupIds(
  publishedSnapshot: PolicySnapshotDto,
  draftSnapshot: PolicySnapshotDto
): PolicyDisplayLookupIds {
  const modalityIds = new Set<number>();
  const examTypeIds = new Set<number>();
  const userIds = new Set<number>();

  for (const snapshot of [publishedSnapshot, draftSnapshot]) {
    for (const row of snapshot.categoryDailyLimits) addNumber(modalityIds, row.modalityId);
    for (const row of snapshot.modalityBlockedRules) addNumber(modalityIds, row.modalityId);
    for (const row of snapshot.examTypeRules) {
      addNumber(modalityIds, row.modalityId);
      for (const examTypeId of row.examTypeIds) addNumber(examTypeIds, examTypeId);
    }
    for (const row of snapshot.examMixQuotaRules ?? []) {
      addNumber(modalityIds, row.modalityId);
      for (const examTypeId of row.examTypeIds) addNumber(examTypeIds, examTypeId);
    }
    for (const row of snapshot.specialQuotaRules) {
      addNumber(modalityIds, row.modalityId);
      for (const examTypeId of row.examTypeIds) addNumber(examTypeIds, examTypeId);
      for (const userId of row.allowedUserIds ?? []) addNumber(userIds, userId);
    }
  }

  return {
    modalityIds: [...modalityIds].sort((a, b) => a - b),
    examTypeIds: [...examTypeIds].sort((a, b) => a - b),
    userIds: [...userIds].sort((a, b) => a - b),
  };
}

export async function loadPolicyDisplayLookups(
  client: PoolClient,
  ids: PolicyDisplayLookupIds
): Promise<PolicyDisplayLookupsDto> {
  const [modalities, examTypes, users] = await Promise.all([
    ids.modalityIds.length > 0
      ? client.query<PolicyDisplayLookupsDto["modalities"][number]>(
          `
            select
              id,
              name_en as "name",
              name_ar as "nameAr",
              name_en as "nameEn",
              code,
              is_active as "isActive"
            from modalities
            where id = any($1::bigint[])
            order by name_en asc
          `,
          [ids.modalityIds]
        ).then((result) => result.rows)
      : Promise.resolve([]),
    ids.examTypeIds.length > 0
      ? client.query<PolicyDisplayLookupsDto["examTypes"][number]>(
          `
            select
              id,
              name_en as "name",
              name_ar as "nameAr",
              name_en as "nameEn",
              code,
              modality_id as "modalityId",
              is_active as "isActive"
            from exam_types
            where id = any($1::bigint[])
            order by name_en asc
          `,
          [ids.examTypeIds]
        ).then((result) => result.rows)
      : Promise.resolve([]),
    ids.userIds.length > 0
      ? client.query<PolicyDisplayLookupsDto["users"][number]>(
          `
            select
              id,
              username,
              full_name as "fullName",
              role,
              is_active as "isActive"
            from users
            where id = any($1::bigint[])
            order by username asc
          `,
          [ids.userIds]
        ).then((result) => result.rows)
      : Promise.resolve([]),
  ]);

  return {
    modalities,
    examTypes,
    users: users.map((user) => ({
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
      isActive: user.isActive,
    })),
  };
}
