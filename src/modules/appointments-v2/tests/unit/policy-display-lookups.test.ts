import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  collectPolicyDisplayLookupIds,
  loadPolicyDisplayLookups,
} from "../../admin/services/policy-display-lookups.service.js";
import type { PolicySnapshotDto } from "../../api/dto/admin-scheduling.dto.js";

function emptySnapshot(): PolicySnapshotDto {
  return {
    categoryDailyLimits: [],
    modalityBlockedRules: [],
    examTypeRules: [],
    specialQuotaRules: [],
    examMixQuotaRules: [],
    specialReasonCodes: [],
  };
}

describe("policy display lookups", () => {
  it("collects referenced modality, exam type, and user IDs from published and draft snapshots", () => {
    const published = emptySnapshot();
    published.categoryDailyLimits.push({ id: 1, modalityId: 10, caseCategory: "oncology", dailyLimit: 2, isActive: true });
    published.examTypeRules.push({
      id: 2,
      modalityId: 11,
      ruleType: "specific_date",
      effectMode: "hard_restriction",
      specificDate: "2026-01-01",
      startDate: null,
      endDate: null,
      weekday: null,
      alternateWeeks: false,
      recurrenceAnchorDate: null,
      title: null,
      notes: null,
      examTypeIds: [101],
      isActive: true,
    });

    const draft = emptySnapshot();
    draft.examMixQuotaRules = [{
      id: 3,
      modalityId: 12,
      title: "Mix",
      ruleType: "specific_date",
      specificDate: "2026-02-01",
      startDate: null,
      endDate: null,
      weekday: null,
      alternateWeeks: false,
      recurrenceAnchorDate: null,
      dailyLimit: 1,
      examTypeIds: [102],
      isActive: true,
    }];
    draft.specialQuotaRules.push({ id: 4, logicalKey: "00000000-0000-0000-0000-000000000004", modalityId: 12, title: null, examTypeIds: [103], dailyExtraSlots: 1, allowedUserIds: [201], isActive: true });

    const ids = collectPolicyDisplayLookupIds(published, draft);

    assert.deepEqual(ids.modalityIds, [10, 11, 12]);
    assert.deepEqual(ids.examTypeIds, [101, 102, 103]);
    assert.deepEqual(ids.userIds, [201]);
  });

  it("loads inactive referenced records without exposing sensitive user fields", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const client = {
      async query(_sql: string, _params: unknown[]) {
        queries.push({ sql: _sql, params: _params });
        if (_sql.includes("from modalities")) {
          return { rows: [{ id: 10, name: "MRI", nameAr: "MRI AR", nameEn: "MRI EN", code: "MR", isActive: false }] };
        }
        if (_sql.includes("from exam_types")) {
          return { rows: [{ id: 101, name: "Brain MRI", nameAr: "Brain MRI AR", nameEn: "Brain MRI EN", code: "BMRI", modalityId: 10, isActive: false }] };
        }
        if (_sql.includes("from users")) {
          return { rows: [{ id: 201, username: "inactive_user", fullName: "Inactive User", role: "supervisor", isActive: false, password_hash: "secret" }] };
        }
        return { rows: [] };
      },
    };

    const lookups = await loadPolicyDisplayLookups(client as never, {
      modalityIds: [10],
      examTypeIds: [101],
      userIds: [201],
    });

    assert.equal(lookups.modalities[0]?.isActive, false);
    assert.equal(lookups.examTypes[0]?.isActive, false);
    assert.equal(lookups.users[0]?.isActive, false);
    assert.deepEqual(Object.keys(lookups.users[0]!).sort(), ["fullName", "id", "isActive", "role", "username"]);
    assert.equal(queries.length, 3);
  });
});
