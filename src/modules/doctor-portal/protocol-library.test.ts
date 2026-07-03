import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it, mock } from "node:test";

const root = process.cwd();

describe("Protocol library schema", () => {
  it("creates system-wide protocol management tables and lookup indexes", () => {
    const migration = readFileSync(`${root}/src/db/migrations/100_protocol_management.sql`, "utf8");

    assert.match(migration, /create table if not exists protocol_anatomy_regions/i);
    assert.match(migration, /create table if not exists imaging_scanners/i);
    assert.match(migration, /ct_slice_detector_specification text/i);
    assert.match(migration, /create table if not exists ct_phase_presets/i);
    assert.match(migration, /create table if not exists mri_sequence_presets/i);
    assert.match(migration, /create table if not exists protocols/i);
    assert.match(migration, /oral_contrast_policy text/i);
    assert.match(migration, /bowel_preparation text/i);
    assert.match(migration, /preparation_notes text/i);
    assert.match(migration, /create table if not exists protocol_versions/i);
    assert.match(migration, /create table if not exists protocol_ct_phases/i);
    assert.match(migration, /create table if not exists protocol_mri_sequences/i);
    assert.match(migration, /create table if not exists appointment_protocol_assignments/i);
    assert.match(migration, /protocols_modality_idx/i);
    assert.match(migration, /protocol_versions_status_idx/i);
    assert.match(migration, /appointment_protocol_assignments_appointment_idx/i);
    assert.doesNotMatch(migration, /doctor_portal\.protocol/i);
  });

  it("adds scanner and preparation metadata through an idempotent migration", () => {
    const migration = readFileSync(`${root}/src/db/migrations/109_protocol_library_scanner_and_preparation_metadata.sql`, "utf8");

    assert.match(migration, /alter table imaging_scanners/i);
    assert.match(migration, /add column if not exists ct_slice_detector_specification text/i);
    assert.match(migration, /alter table protocols/i);
    assert.match(migration, /add column if not exists oral_contrast_policy text/i);
    assert.match(migration, /add column if not exists bowel_preparation text/i);
    assert.match(migration, /add column if not exists preparation_notes text/i);
  });
});

describe("Protocol library read repository", () => {
  it("lists protocol rows including inactive records ordered by active state and name", async () => {
    process.env.DATABASE_URL ??= "postgresql://example@example/protocol_library_test";
    process.env.JWT_SECRET ??= "protocol-library-test-secret";
    const poolModule = await import("../../db/pool.js");
    const queries: string[] = [];
    const queryMock = mock.method(poolModule.pool, "query", async (sql: string) => {
      queries.push(sql);
      return {
        rows: [
          {
            id: 1,
            name: "Brain CT",
            modality: "CT",
            anatomy_region_id: null,
            anatomy_region_name: null,
            category: null,
            indication: null,
            contrast_policy: null,
            active_version_id: null,
            is_active: true,
            created_at: "2026-06-29T10:00:00.000Z",
            updated_at: "2026-06-29T10:00:00.000Z",
          },
        ],
      };
    });

    try {
      const { listProtocols } = await import("./protocol-library-repository.js");
      const rows = await listProtocols();

      assert.equal(rows.length, 1);
      assert.equal(rows[0].name, "Brain CT");
      assert.equal(rows[0].modality, "CT");
      assert.match(queries[0], /from protocols p/i);
      assert.doesNotMatch(queries[0], /where p\.is_active = true/i);
      assert.match(queries[0], /order by p\.is_active desc, p\.name asc/i);
    } finally {
      queryMock.mock.restore();
    }
  });

  it("creates and updates reusable anatomy regions without hard delete", async () => {
    process.env.DATABASE_URL ??= "postgresql://example@example/protocol_library_test";
    process.env.JWT_SECRET ??= "protocol-library-test-secret";
    const poolModule = await import("../../db/pool.js");
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const queryMock = mock.method(poolModule.pool, "query", async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      return {
        rows: [
          {
            id: 2,
            name: "Brain",
            body_system: "Neuro",
            modality_scope: "BOTH",
            default_coverage_note: "Vertex to skull base",
            is_active: false,
            created_at: "2026-06-29T10:00:00.000Z",
            updated_at: "2026-06-29T10:00:00.000Z",
          },
        ],
      };
    });

    try {
      const { createProtocolAnatomyRegion, updateProtocolAnatomyRegion } = await import("./protocol-library-repository.js");
      const created = await createProtocolAnatomyRegion({
        name: "Brain",
        bodySystem: "Neuro",
        modalityScope: "BOTH",
        defaultCoverageNote: "Vertex to skull base",
        isActive: true,
      });
      const updated = await updateProtocolAnatomyRegion(2, { isActive: false });

      assert.equal(created.name, "Brain");
      assert.ok(updated);
      assert.equal(updated.isActive, false);
      assert.match(queries[0].sql, /insert into protocol_anatomy_regions/i);
      assert.match(queries[1].sql, /update protocol_anatomy_regions/i);
      assert.doesNotMatch(queries.map((query) => query.sql).join("\n"), /delete from/i);
    } finally {
      queryMock.mock.restore();
    }
  });

  it("creates CT phases and MRI sequences with numeric setting fields", async () => {
    process.env.DATABASE_URL ??= "postgresql://example@example/protocol_library_test";
    process.env.JWT_SECRET ??= "protocol-library-test-secret";
    const poolModule = await import("../../db/pool.js");
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const queryMock = mock.method(poolModule.pool, "query", async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      if (/ct_phase_presets/i.test(sql)) {
        return {
          rows: [{
            id: 3,
            name: "Portal venous",
            contrast_status: "POST_CONTRAST",
            timing_type: "FIXED_DELAY",
            delay_seconds: 70,
            bolus_tracking_site: null,
            trigger_hu: null,
            default_coverage: "Chest to pelvis",
            reconstruction_notes: null,
            instructions: null,
            is_active: true,
            created_at: "2026-06-29T10:00:00.000Z",
            updated_at: "2026-06-29T10:00:00.000Z",
          }],
        };
      }
      return {
        rows: [{
          id: 4,
          scanner_id: null,
          scanner_name: null,
          vendor: "GE",
          name: "DWI axial",
          vendor_sequence_name: null,
          generic_family: "DWI",
          weighting: "DWI",
          default_plane: "Axial",
          contrast_relation: null,
          default_coverage: null,
          default_b_values: "0,800",
          default_dynamic_timing: null,
          estimated_scan_time_minutes: 4,
          notes: null,
          is_active: true,
          created_at: "2026-06-29T10:00:00.000Z",
          updated_at: "2026-06-29T10:00:00.000Z",
        }],
      };
    });

    try {
      const { createCtPhasePreset, createMriSequencePreset } = await import("./protocol-library-repository.js");
      await createCtPhasePreset({
        name: "Portal venous",
        contrastStatus: "POST_CONTRAST",
        timingType: "FIXED_DELAY",
        delaySeconds: 70,
        bolusTrackingSite: null,
        triggerHu: null,
        defaultCoverage: "Chest to pelvis",
        reconstructionNotes: null,
        instructions: null,
        isActive: true,
      });
      await createMriSequencePreset({
        scannerId: null,
        vendor: "GE",
        name: "DWI axial",
        vendorSequenceName: null,
        genericFamily: "DWI",
        weighting: "DWI",
        defaultPlane: "Axial",
        contrastRelation: null,
        defaultCoverage: null,
        defaultBValues: "0,800",
        defaultDynamicTiming: null,
        estimatedScanTimeMinutes: 4,
        notes: null,
        isActive: true,
      });

      assert.match(queries[0].sql, /insert into ct_phase_presets/i);
      assert.equal(queries[0].params[3], 70);
      assert.match(queries[1].sql, /insert into mri_sequence_presets/i);
      assert.equal(queries[1].params[11], 4);
    } finally {
      queryMock.mock.restore();
    }
  });

  it("mounts read-only protocol library endpoints under the Doctor router", () => {
    const portalRouter = readFileSync(`${root}/src/modules/doctor-portal/index.ts`, "utf8");
    const routes = readFileSync(`${root}/src/modules/doctor-portal/protocol-library-routes.ts`, "utf8");

    assert.match(portalRouter, /router\.use\("\/protocol-library", doctorProtocolLibraryRouter\)/);
    assert.match(routes, /"\/anatomy-regions"/);
    assert.match(routes, /"\/scanners"/);
    assert.match(routes, /"\/ct-phase-presets"/);
    assert.match(routes, /"\/mri-sequence-presets"/);
    assert.match(routes, /"\/protocols"/);
    assert.match(routes, /router\.post\(\s*"\/anatomy-regions"/);
    assert.match(routes, /router\.patch\(\s*"\/anatomy-regions\/:id"/);
    assert.match(routes, /router\.post\(\s*"\/scanners"/);
    assert.match(routes, /router\.patch\(\s*"\/scanners\/:id"/);
    assert.match(routes, /router\.post\(\s*"\/ct-phase-presets"/);
    assert.match(routes, /router\.patch\(\s*"\/ct-phase-presets\/:id"/);
    assert.match(routes, /router\.post\(\s*"\/mri-sequence-presets"/);
    assert.match(routes, /router\.patch\(\s*"\/mri-sequence-presets\/:id"/);
    assert.match(routes, /router\.delete\(\s*"\/protocol-versions\/:versionId\/ct-phases\/:rowId"/);
    assert.match(routes, /router\.delete\(\s*"\/protocol-versions\/:versionId\/mri-sequences\/:rowId"/);
  });

  it("requires protocol library admin access for create and update routes", () => {
    const routes = readFileSync(`${root}/src/modules/doctor-portal/protocol-library-routes.ts`, "utf8");

    assert.match(routes, /requireProtocolLibraryAdminAccess/);
    assert.match(routes, /Protocol Library administration access is required/);
    assert.match(routes, /router\.post\(\s*"\/protocols"[^]*requireProtocolLibraryAdminAccess\(req\)/);
    assert.match(routes, /router\.patch\(\s*"\/protocols\/:id"[^]*requireProtocolLibraryAdminAccess\(req\)/);
    assert.match(routes, /router\.post\(\s*"\/scanners"[^]*requireProtocolLibraryAdminAccess\(req\)/);
    assert.match(routes, /router\.patch\(\s*"\/scanners\/:id"[^]*requireProtocolLibraryAdminAccess\(req\)/);
    assert.match(routes, /router\.post\(\s*"\/protocol-versions\/:versionId\/activate"[^]*requireProtocolLibraryAdminAccess\(req\)/);
  });

  it("validates protocol category and structured IV contrast policies", () => {
    const routes = readFileSync(`${root}/src/modules/doctor-portal/protocol-library-routes.ts`, "utf8");

    assert.match(routes, /General/);
    assert.match(routes, /Oncology/);
    assert.match(routes, /Non-oncology/);
    assert.match(routes, /Non-contrast/);
    assert.match(routes, /With IV contrast/);
    assert.match(routes, /Without and with IV contrast/);
    assert.match(routes, /Dynamic contrast/);
    assert.match(routes, /Conditional \/ radiologist decision/);
  });

  it("maps scanner detector and protocol preparation metadata", () => {
    const repo = readFileSync(`${root}/src/modules/doctor-portal/protocol-library-repository.ts`, "utf8");

    assert.match(repo, /ct_slice_detector_specification/);
    assert.match(repo, /ctSliceDetectorSpecification/);
    assert.match(repo, /oral_contrast_policy/);
    assert.match(repo, /bowel_preparation/);
    assert.match(repo, /preparation_notes/);
  });

  it("exposes protocol builder endpoints and guards draft-only edits", () => {
    const routes = readFileSync(`${root}/src/modules/doctor-portal/protocol-library-routes.ts`, "utf8");
    const repo = readFileSync(`${root}/src/modules/doctor-portal/protocol-library-repository.ts`, "utf8");

    assert.match(routes, /"\/protocols\/:id"/);
    assert.match(routes, /router\.post\(\s*"\/protocols"/);
    assert.match(routes, /"\/protocol-versions\/:versionId"/);
    assert.match(routes, /"\/protocol-versions\/:versionId\/activate"/);
    assert.match(routes, /"\/protocols\/:id\/draft-from-active"/);
    assert.match(routes, /"\/protocol-versions\/:versionId\/ct-phases"/);
    assert.match(routes, /"\/protocol-versions\/:versionId\/mri-sequences"/);
    assert.match(routes, /"\/protocol-versions\/:versionId\/ct-phases\/reorder"/);
    assert.match(routes, /"\/protocol-versions\/:versionId\/mri-sequences\/reorder"/);
    assert.match(repo, /createProtocolWithDraft/);
    assert.match(repo, /version_number[^]*1\.0/);
    assert.match(repo, /Protocol version is not editable/);
    assert.match(repo, /CT phase rows can only be added to CT protocol versions/);
    assert.match(repo, /MRI sequence rows can only be added to MRI protocol versions/);
    assert.match(repo, /Activation requires at least one CT phase/);
    assert.match(repo, /Activation requires at least one MRI sequence/);
    assert.match(repo, /createDraftFromActiveVersion/);
  });
});
