import test from "node:test";
import assert from "node:assert/strict";
import { pool } from "../db/pool.js";
import { getPatientDirectorySummary } from "./patient-service.js";

type QueryResult = { rows: unknown[] };

test("patient directory summary composes patient details and appointments without a live database", async () => {
  const poolWithQuery = pool as unknown as {
    query: (sql: unknown, params?: unknown[]) => Promise<QueryResult>;
  };
  const originalQuery = poolWithQuery.query;

  poolWithQuery.query = async (sql: unknown, params?: unknown[]) => {
    const normalizedSql = String(sql).replace(/\s+/g, " ").toLowerCase();

    if (normalizedSql.includes("from patients p") && normalizedSql.includes("primary_identifier") && normalizedSql.includes("identifiers")) {
      return {
        rows: [
          {
            id: 17,
            mrn: "MRN-17",
            national_id: "NAT-17",
            identifier_type: "national_id",
            identifier_value: "NAT-17",
            category: "oncology",
            arabic_full_name: "مريض مثال",
            english_full_name: "Sample Patient",
            age_years: 31,
            demographics_estimated: false,
            sex: "F",
            phone_1: "0911111111",
            phone_2: null,
            address: "Tripoli",
            estimated_date_of_birth: "1995-01-01"
          }
        ]
      };
    }

    if (normalizedSql.includes("booking_date < current_date") && normalizedSql.includes("exam_type_name")) {
      return {
        rows: [
          {
            id: 101,
            date: "2026-04-20",
            status: "completed",
            modality_name: "CT",
            exam_type_name: "Head"
          }
        ]
      };
    }

    if (normalizedSql.includes("booking_date >= current_date") && normalizedSql.includes("exam_type_name")) {
      return {
        rows: [
          {
            id: 102,
            date: "2026-04-30",
            status: "scheduled",
            modality_name: "MRI",
            exam_type_name: "Brain"
          }
        ]
      };
    }

    if (normalizedSql.includes("order by b.booking_date desc, b.id desc") && normalizedSql.includes("limit 5")) {
      return {
        rows: [
          {
            id: 103,
            date: "2026-04-28",
            status: "completed",
            modality_name: "US",
            exam_type_name: "Abdomen"
          }
        ]
      };
    }

    if (normalizedSql.includes("select exists") && normalizedSql.includes("p2.phone_1 = $2")) {
      assert.deepEqual(params, [17, "0911111111", "NAT-17"]);
      return { rows: [{ is_dupe: true }] };
    }

    throw new Error(`Unexpected query: ${normalizedSql}`);
  };

  try {
    const summary = await getPatientDirectorySummary(17);

    assert.deepEqual(summary.demographics, {
      id: 17,
      mrn: "MRN-17",
      arabicFullName: "مريض مثال",
      englishFullName: "Sample Patient",
      sex: "F",
      ageYears: 31,
      demographicsEstimated: false,
      dateOfBirth: "1995-01-01"
    });
    assert.deepEqual(summary.identifiers, {
      nationalId: "NAT-17",
      identifierType: "national_id",
      identifierValue: "NAT-17"
    });
    assert.deepEqual(summary.contact, {
      phone1: "0911111111",
      phone2: null,
      address: "Tripoli"
    });
    assert.equal(summary.category, "oncology");
    assert.equal(summary.warnings.missingPhone, false);
    assert.equal(summary.warnings.missingDob, false);
    assert.equal(summary.warnings.missingSex, false);
    assert.equal(summary.warnings.missingName, false);
    assert.equal(summary.warnings.incompleteData, false);
    assert.equal(summary.warnings.possibleDuplicate, true);
    assert.deepEqual(summary.warnings.duplicateReasons, ["phone_or_id_match"]);
    assert.deepEqual(summary.lastAppointment, {
      id: 101,
      date: "2026-04-20",
      status: "completed",
      modalityName: "CT",
      examTypeName: "Head"
    });
    assert.deepEqual(summary.nextAppointment, {
      id: 102,
      date: "2026-04-30",
      status: "scheduled",
      modalityName: "MRI",
      examTypeName: "Brain"
    });
    assert.deepEqual(summary.recentAppointments, [
      {
        id: 103,
        date: "2026-04-28",
        status: "completed",
        modalityName: "US",
        examTypeName: "Abdomen"
      }
    ]);
  } finally {
    poolWithQuery.query = originalQuery;
  }
});
