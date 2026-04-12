/**
 * Appointments V2 — Catalog repository tests.
 *
 * Tests the modality and exam type catalog repositories that query
 * the legacy modalities and exam_types tables (read-only access).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// Modality catalog repository
// ---------------------------------------------------------------------------

describe("Modality catalog repository", () => {
  const modRepoPath = join(
    process.cwd(),
    "src/modules/appointments-v2/catalog/repositories/modality-catalog.repo.ts"
  );
  const modSource = readFileSync(modRepoPath, "utf-8");

  describe("findModalityById", () => {
    it("exports findModalityById function", async () => {
      const { findModalityById } = await import(
        "../../catalog/repositories/modality-catalog.repo.js"
      );
      assert.strictEqual(typeof findModalityById, "function");
    });

    it("queries modalities table", () => {
      assert.ok(modSource.includes("from modalities"), "Should query modalities table");
    });

    it("aliases columns correctly (nameAr, nameEn, dailyCapacity, isActive)", () => {
      assert.ok(modSource.includes('name_ar as "nameAr"'), "Should alias name_ar to nameAr");
      assert.ok(modSource.includes('name_en as "nameEn"'), "Should alias name_en to nameEn");
      assert.ok(
        modSource.includes('daily_capacity as "dailyCapacity"'),
        "Should alias daily_capacity to dailyCapacity"
      );
      assert.ok(
        modSource.includes('is_active as "isActive"'),
        "Should alias is_active to isActive"
      );
    });

    it("filters by id = $1", () => {
      assert.ok(modSource.includes("where id = $1"), "Should filter by id = $1");
    });

    it("passes modalityId parameter", () => {
      assert.ok(
        modSource.includes("modalityId") && modSource.includes("[modalityId]"),
        "Should pass modalityId parameter"
      );
    });
  });

  describe("listActiveModalities", () => {
    it("exports listActiveModalities function", async () => {
      const { listActiveModalities } = await import(
        "../../catalog/repositories/modality-catalog.repo.js"
      );
      assert.strictEqual(typeof listActiveModalities, "function");
    });

    it("queries modalities table", () => {
      assert.ok(
        modSource.includes("LIST_ACTIVE_SQL"),
        "Should use LIST_ACTIVE_SQL query"
      );
    });

    it("filters by is_active = true", () => {
      assert.ok(
        modSource.includes("is_active = true"),
        "Should filter by is_active = true"
      );
    });

    it("orders by name_en", () => {
      assert.ok(
        modSource.includes("order by name_en") || modSource.includes("ORDER BY name_en"),
        "Should order by name_en"
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Exam type catalog repository
// ---------------------------------------------------------------------------

describe("Exam type catalog repository", () => {
  const examRepoPath = join(
    process.cwd(),
    "src/modules/appointments-v2/catalog/repositories/exam-type-catalog.repo.ts"
  );
  const examSource = readFileSync(examRepoPath, "utf-8");

  describe("findExamTypeById", () => {
    it("exports findExamTypeById function", async () => {
      const { findExamTypeById } = await import(
        "../../catalog/repositories/exam-type-catalog.repo.js"
      );
      assert.strictEqual(typeof findExamTypeById, "function");
    });

    it("queries exam_types table", () => {
      assert.ok(
        examSource.includes("from exam_types"),
        "Should query exam_types table"
      );
    });

    it("aliases columns correctly (nameAr, nameEn, modalityId, isActive)", () => {
      assert.ok(examSource.includes('name_ar as "nameAr"'), "Should alias name_ar to nameAr");
      assert.ok(examSource.includes('name_en as "nameEn"'), "Should alias name_en to nameEn");
      assert.ok(
        examSource.includes('modality_id as "modalityId"'),
        "Should alias modality_id to modalityId"
      );
      assert.ok(
        examSource.includes('is_active as "isActive"'),
        "Should alias is_active to isActive"
      );
    });

    it("filters by id = $1", () => {
      assert.ok(
        examSource.includes("where id = $1"),
        "Should filter by id = $1"
      );
    });

    it("passes examTypeId parameter", () => {
      assert.ok(
        examSource.includes("examTypeId") && examSource.includes("[examTypeId]"),
        "Should pass examTypeId parameter"
      );
    });
  });

  describe("listExamTypesForModality", () => {
    it("exports listExamTypesForModality function", async () => {
      const { listExamTypesForModality } = await import(
        "../../catalog/repositories/exam-type-catalog.repo.js"
      );
      assert.strictEqual(typeof listExamTypesForModality, "function");
    });

    it("queries exam_types table", () => {
      assert.ok(
        examSource.includes("from exam_types"),
        "Should query exam_types table"
      );
    });

    it("filters by modality_id = $1 and is_active = true", () => {
      assert.ok(
        examSource.includes("modality_id = $1"),
        "Should filter by modality_id = $1"
      );
      assert.ok(
        examSource.includes("is_active = true"),
        "Should filter by is_active = true"
      );
    });

    it("orders by name_en", () => {
      assert.ok(
        examSource.includes("order by name_en") || examSource.includes("ORDER BY name_en"),
        "Should order by name_en"
      );
    });

    it("passes modalityId parameter", () => {
      assert.ok(
        examSource.includes("[modalityId]"),
        "Should pass modalityId parameter"
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Type interface verification
// ---------------------------------------------------------------------------

describe("Catalog repository — type interfaces", () => {
  it("ModalityRow includes all expected fields", async () => {
    const { readFileSync: fsReadFileSync } = await import("fs");
    const { join: pathJoin } = await import("path");
    const repoPath = pathJoin(
      process.cwd(),
      "src/modules/appointments-v2/catalog/repositories/modality-catalog.repo.ts"
    );
    const source = fsReadFileSync(repoPath, "utf-8");

    assert.ok(source.includes("interface ModalityRow"), "Should define ModalityRow interface");
    assert.ok(source.includes("id: number"), "Should have id field");
    assert.ok(source.includes("nameAr:"), "Should have nameAr field");
    assert.ok(source.includes("nameEn:"), "Should have nameEn field");
    assert.ok(source.includes("dailyCapacity:"), "Should have dailyCapacity field");
    assert.ok(source.includes("isActive:"), "Should have isActive field");
  });
});
