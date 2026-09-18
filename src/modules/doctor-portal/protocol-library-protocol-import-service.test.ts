import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { buildWorkbookBuffer } from "../../services/workbook-service.js";
import { readWorkbookFromBase64 } from "../../services/workbook-service.js";
import type { ProtocolVersionDetail } from "./protocol-library-repository.js";

process.env.DATABASE_URL ??= "postgresql://example@example/protocol_library_protocol_import_test";
process.env.JWT_SECRET ??= "protocol-library-protocol-import-test-secret";

async function workbook(sheets: Array<{ name: string; headers: string[]; rows: Array<Record<string, unknown>> }>): Promise<string> {
  return (await buildWorkbookBuffer(sheets)).toString("base64");
}

const protocolHeaders = ["protocol_key", "protocol_name", "modality", "anatomy_region", "category", "contrast_policy"];
const ctPhaseHeaders = ["protocol_key", "order", "phase_name", "timing_type", "coverage"];
const ctTechniqueHeaders = ["protocol_key", "scanner", "kv_mode", "tube_current_mode"];
const mriHeaders = ["protocol_key", "order", "sequence_key", "scanner"];

const syncMetadataHeaders = ["key", "value"];
const manifestHeaders = ["rispro_protocol_id", "protocol_key", "source_version_id", "protocol_updated_at"];

function syncSheets(protocolRows: Array<Record<string, unknown>>, manifestRows: Array<Record<string, unknown>>, scope = "ALL_PROTOCOLS", childSheets: Array<{ name: string; headers: string[]; rows: Array<Record<string, unknown>> }> = []): Array<{ name: string; headers: string[]; rows: Array<Record<string, unknown>> }> {
  return [
    { name: "Protocols", headers: [...protocolHeaders, "rispro_protocol_id", "rispro_source_version_id", "rispro_protocol_updated_at", "is_active", "protocol_notes"], rows: protocolRows },
    { name: "CT Phases", headers: ctPhaseHeaders, rows: childSheets.find((sheet) => sheet.name === "CT Phases")?.rows ?? [] },
    { name: "CT Techniques", headers: ctTechniqueHeaders, rows: childSheets.find((sheet) => sheet.name === "CT Techniques")?.rows ?? [] },
    { name: "MRI Sequences", headers: mriHeaders, rows: childSheets.find((sheet) => sheet.name === "MRI Sequences")?.rows ?? [] },
    { name: "RISpro Metadata", headers: syncMetadataHeaders, rows: [{ key: "format_version", value: "2" }, { key: "workbook_type", value: "protocol_library" }, { key: "scope", value: scope }, { key: "exported_at", value: "2026-09-18T10:00:00.000Z" }] },
    { name: "RISpro Manifest", headers: manifestHeaders, rows: manifestRows },
  ];
}

function existingProtocolLookupMock() {
  return async (sql: string) => {
    if (/from\s+protocols\s+p/i.test(sql)) return { rows: [{ id: 42, name: "CT Brain", modality: "CT", anatomy_region_id: 1, anatomy_region_name: "Brain", category: "General", indication: null, contrast_policy: "Non-contrast", oral_contrast_policy: null, bowel_preparation: null, preparation_notes: null, active_version_id: 7, active_version_number: "1.0", active_version_status: "ACTIVE", latest_draft_version_id: null, latest_draft_version_number: null, is_active: true, created_at: "2026-09-18T08:00:00.000Z", updated_at: "2026-09-18T10:00:00.000Z" }] };
    if (/protocol_anatomy_regions/i.test(sql)) return { rows: [{ id: 1, name: "Brain" }] };
    if (/from equipment/i.test(sql)) return { rows: [{ id: 11, name: "CT One", modality: "CT" }, { id: 12, name: "MRI One", modality: "MRI" }] };
    if (/from mri_sequence_presets/i.test(sql)) return { rows: [{ id: 21, sequence_key: "t1_ax" }] };
    if (/from protocol_versions/i.test(sql)) return { rows: [{ id: 7, protocol_id: 42, version_number: "1.0", status: "ACTIVE", change_summary: "Approved", protocol_notes: null, created_by: null, approved_by: null, approved_at: null, retired_at: null, created_at: "2026-09-18T09:00:00.000Z", updated_at: "2026-09-18T09:00:00.000Z" }] };
    if (/from protocol_ct_phases/i.test(sql) || /from protocol_ct_techniques/i.test(sql) || /from protocol_mri_sequences/i.test(sql)) return { rows: [] };
    return { rows: [] };
  };
}

function lookupMock() {
  return async (sql: string) => {
    if (/protocol_anatomy_regions/i.test(sql)) return { rows: [{ id: 1, name: "Brain" }] };
    if (/from equipment/i.test(sql)) return { rows: [{ id: 11, name: "CT One", modality: "CT" }, { id: 12, name: "MRI One", modality: "MRI" }] };
    if (/from mri_sequence_presets/i.test(sql)) return { rows: [{ id: 21, sequence_key: "t1_ax" }, { id: 22, sequence_key: "t2_ax" }] };
    if (/from protocols/i.test(sql)) return { rows: [] };
    return { rows: [] };
  };
}

describe("full protocol XLSX import", () => {
  it("exports canonical protocol rows with deterministic workbook keys and preserved order", async () => {
    const detail = {
      protocol: { id: 42, name: "CT Brain Routine", modality: "CT", anatomyRegionName: "Brain", category: "General", indication: "Headache", contrastPolicy: "Non-contrast", oralContrastPolicy: null, bowelPreparation: null, preparationNotes: null, isActive: true, updatedAt: "2026-09-18T10:00:00.000Z" },
      version: { id: 7, versionNumber: "1.0", protocolNotes: "Exported notes" },
      ctPhases: [{ orderIndex: 1, customPhaseName: "Non-contrast", ctPhasePresetName: null, timingType: "NON_CONTRAST", presetTimingType: null, delaySeconds: null, presetDelaySeconds: null, bolusTrackingSite: null, presetBolusTrackingSite: null, triggerHu: null, presetTriggerHu: null, postTriggerDelaySeconds: null, coverageOverride: "Brain", presetDefaultCoverage: null, reconstructionOverride: "Routine", presetReconstructionNotes: null, instructionsOverride: "Keep still", presetInstructions: null, isRequired: true }],
      ctTechniques: [{ scannerName: "CT One", kvMode: "AUTO", kvp: null, tubeCurrentMode: "AUTOMATIC", fixedMa: null, referenceMas: null, exposureControl: "AEC", noiseIndex: null, minMa: null, maxMa: null, reconstructionMethod: null, reconstructionStrength: null, reconstructionImageDefinition: null, sliceThicknessMm: 1, reconstructionIntervalMm: 1, kernel: "Standard" }],
      mriSequences: [],
    } as unknown as ProtocolVersionDetail;
    const { buildProtocolExportWorkbook } = await import("./protocol-library-protocol-import-service.js");
    const exported = await buildProtocolExportWorkbook([detail], "rispro-protocols.xlsx");
    const { XLSX, workbook } = await readWorkbookFromBase64(exported.buffer.toString("base64"));
    const protocols = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets.Protocols);
    const phases = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets["CT Phases"]);
    const techniques = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets["CT Techniques"]);
    assert.deepEqual(workbook.SheetNames, ["Protocols", "CT Phases", "CT Techniques", "MRI Sequences", "RISpro Metadata", "RISpro Manifest", "Instructions"]);
    assert.equal(protocols[0]?.rispro_protocol_id, 42);
    assert.equal(protocols[0]?.rispro_source_version_id, 7);
    assert.equal(protocols[0]?.is_active, true);
    assert.equal(protocols[0]?.protocol_key, "ct-ct-brain-routine-42");
    assert.equal(phases[0]?.protocol_key, protocols[0]?.protocol_key);
    assert.equal(phases[0]?.order, 1);
    assert.equal(techniques[0]?.scanner, "CT One");
  });

  it("exports a valid empty canonical workbook when the protocol library is empty", async () => {
    const poolModule = await import("../../db/pool.js");
    const queryMock = mock.method(poolModule.pool, "query", async () => ({ rows: [] }));
    try {
      const { exportAllProtocolsXlsx } = await import("./protocol-library-protocol-import-service.js");
      const exported = await exportAllProtocolsXlsx();
      const { XLSX, workbook: parsed } = await readWorkbookFromBase64(exported.buffer.toString("base64"));
      assert.equal(exported.filename, "rispro-protocols.xlsx");
      assert.deepEqual(parsed.SheetNames, ["Protocols", "CT Phases", "CT Techniques", "MRI Sequences", "RISpro Metadata", "RISpro Manifest", "Instructions"]);
      assert.equal(XLSX.utils.sheet_to_json(parsed.Sheets.Protocols).length, 0);
    } finally { queryMock.mock.restore(); }
  });

  it("inspects the prescribed sheets and previews a mixed CT/MRI workbook", async () => {
    const poolModule = await import("../../db/pool.js");
    const queryMock = mock.method(poolModule.pool, "query", lookupMock());
    const fileContentBase64 = await workbook([
      { name: "Protocols", headers: protocolHeaders, rows: [{ protocol_key: "ct_liver", protocol_name: "CT Liver", modality: "ct", anatomy_region: "Brain", category: "General", contrast_policy: "With IV contrast" }, { protocol_key: "mri_brain", protocol_name: "MRI Brain", modality: "MRI", anatomy_region: "Brain" }] },
      { name: "CT Phases", headers: ctPhaseHeaders, rows: [{ protocol_key: "ct_liver", order: 1, phase_name: "Portal venous", timing_type: "FIXED_DELAY_INJECTION_START", coverage: "Liver" }] },
      { name: "CT Techniques", headers: ctTechniqueHeaders, rows: [{ protocol_key: "ct_liver", scanner: "ct one", kv_mode: "AUTO", tube_current_mode: "AUTOMATIC" }] },
      { name: "MRI Sequences", headers: mriHeaders, rows: [{ protocol_key: "mri_brain", order: 1, sequence_key: "T1_AX", scanner: "MRI One" }, { protocol_key: "mri_brain", order: 2, sequence_key: "t2_ax" }] },
      { name: "Notes", headers: ["note"], rows: [{ note: "ignored" }] },
    ]);
    try {
      const service = await import("./protocol-library-protocol-import-service.js");
      const inspect = await service.inspectProtocolImport({ fileContentBase64, fileName: "protocols.xlsx" });
      const preview = await service.previewProtocolImport({ fileContentBase64, fileName: "protocols.xlsx" });
      assert.deepEqual(inspect.sheets.map((sheet) => sheet.sheetName), ["Protocols", "CT Phases", "CT Techniques", "MRI Sequences"]);
      assert.deepEqual(inspect.unknownSheets, ["Notes"]);
      assert.equal(preview.canConfirm, true);
      assert.equal(preview.protocolRows[0].modality, "CT");
      assert.equal(preview.summary.mriSequences, 2);
    } finally { queryMock.mock.restore(); }
  });

  it("reports cross-sheet, order, lookup, and modality errors without skipping rows", async () => {
    const poolModule = await import("../../db/pool.js");
    const queryMock = mock.method(poolModule.pool, "query", lookupMock());
    const fileContentBase64 = await workbook([
      { name: "Protocols", headers: protocolHeaders, rows: [{ protocol_key: "mri_brain", protocol_name: "MRI Brain", modality: "MRI", anatomy_region: "Missing" }, { protocol_key: "MRI_BRAIN", protocol_name: "MRI Duplicate", modality: "MRI" }] },
      { name: "CT Phases", headers: ctPhaseHeaders, rows: [{ protocol_key: "mri_brain", order: 1, phase_name: "Wrong", timing_type: "MANUAL" }, { protocol_key: "missing", order: 1, phase_name: "Unknown", timing_type: "MANUAL" }] },
      { name: "CT Techniques", headers: ctTechniqueHeaders, rows: [{ protocol_key: "mri_brain", scanner: "MRI One" }] },
      { name: "MRI Sequences", headers: mriHeaders, rows: [{ protocol_key: "mri_brain", order: 1, sequence_key: "unknown" }, { protocol_key: "mri_brain", order: 1, sequence_key: "t1_ax" }] },
    ]);
    try {
      const { previewProtocolImport } = await import("./protocol-library-protocol-import-service.js");
      const preview = await previewProtocolImport({ fileContentBase64, fileName: "invalid.xlsx" });
      assert.equal(preview.canConfirm, false);
      assert.ok(preview.protocolRows[0].errors.some((error) => /anatomy region/i.test(error)));
      assert.ok(preview.protocolRows[1].errors.some((error) => /duplicate protocol_key/i.test(error)));
      assert.ok(preview.ctPhaseRows.every((row) => row.action === "invalid"));
      assert.ok(preview.ctTechniqueRows[0].errors.some((error) => /CT protocols|must be CT/i.test(error)));
      assert.ok(preview.mriSequenceRows[0].errors.some((error) => /unknown/i.test(error)));
      assert.ok(preview.mriSequenceRows[1].errors.some((error) => /duplicate order/i.test(error)));
    } finally { queryMock.mock.restore(); }
  });

  it("marks an existing same-modality/name protocol as a non-overwritable conflict", async () => {
    const poolModule = await import("../../db/pool.js");
    const queryMock = mock.method(poolModule.pool, "query", async (sql: string) => /from protocols/i.test(sql) ? { rows: [{ id: 9, modality: "CT", name: "CT Liver" }] } : lookupMock()(sql));
    const fileContentBase64 = await workbook([
      { name: "Protocols", headers: protocolHeaders, rows: [{ protocol_key: "ct_liver", protocol_name: "CT Liver", modality: "CT" }] },
      { name: "CT Phases", headers: ctPhaseHeaders, rows: [] }, { name: "CT Techniques", headers: ctTechniqueHeaders, rows: [] }, { name: "MRI Sequences", headers: mriHeaders, rows: [] },
    ]);
    try {
      const { previewProtocolImport } = await import("./protocol-library-protocol-import-service.js");
      const preview = await previewProtocolImport({ fileContentBase64, fileName: "conflict.xlsx" });
      assert.equal(preview.canConfirm, false);
      assert.equal(preview.protocolRows[0].action, "conflict_existing_protocol");
    } finally { queryMock.mock.restore(); }
  });

  it("plans create, update, unchanged, identity, modality, and stale actions from synchronization metadata", async () => {
    const poolModule = await import("../../db/pool.js");
    const queryMock = mock.method(poolModule.pool, "query", existingProtocolLookupMock());
    const base = { protocol_key: "ct_brain", protocol_name: "CT Brain", modality: "CT", anatomy_region: "Brain", category: "General", contrast_policy: "Non-contrast", rispro_protocol_id: 42, rispro_source_version_id: 7, rispro_protocol_updated_at: "2026-09-18T10:00:00.000Z", is_active: true };
    try {
      const service = await import("./protocol-library-protocol-import-service.js");
      const newProtocol = await service.previewProtocolImport({ fileContentBase64: await workbook(syncSheets([{ protocol_key: "ct_new", protocol_name: "CT New", modality: "CT", anatomy_region: "Brain", category: "General", contrast_policy: "Non-contrast" }], [], "TEMPLATE")) });
      assert.equal(newProtocol.protocolRows[0]?.action, "create_protocol");
      const unchanged = await service.previewProtocolImport({ fileContentBase64: await workbook(syncSheets([base], [{ rispro_protocol_id: 42, protocol_key: "ct_brain", source_version_id: 7, protocol_updated_at: "2026-09-18T10:00:00.000Z" }])) });
      assert.equal(unchanged.protocolRows[0]?.action, "unchanged", JSON.stringify(unchanged.protocolRows[0]));
      const staleTimestampNoOp = await service.previewProtocolImport({ fileContentBase64: await workbook(syncSheets([{ ...base, rispro_protocol_updated_at: "2026-09-18T09:00:00.000Z" }], [{ rispro_protocol_id: 42, protocol_key: "ct_brain", source_version_id: 7, protocol_updated_at: "2026-09-18T09:00:00.000Z" }])) });
      assert.equal(staleTimestampNoOp.protocolRows[0]?.action, "unchanged");
      const renamed = await service.previewProtocolImport({ fileContentBase64: await workbook(syncSheets([{ ...base, protocol_name: "CT Brain Renamed" }], [{ rispro_protocol_id: 42, protocol_key: "ct_brain", source_version_id: 7, protocol_updated_at: "2026-09-18T10:00:00.000Z" }])) });
      assert.equal(renamed.protocolRows[0]?.action, "update_protocol");
      const staleTimestamp = await service.previewProtocolImport({ fileContentBase64: await workbook(syncSheets([{ ...base, protocol_name: "CT Brain Changed", rispro_protocol_updated_at: "2026-09-18T09:00:00.000Z" }], [{ rispro_protocol_id: 42, protocol_key: "ct_brain", source_version_id: 7, protocol_updated_at: "2026-09-18T09:00:00.000Z" }])) });
      assert.equal(staleTimestamp.protocolRows[0]?.action, "stale_conflict");
      const staleVersion = await service.previewProtocolImport({ fileContentBase64: await workbook(syncSheets([{ ...base, protocol_name: "CT Brain Changed", rispro_source_version_id: 6 }], [{ rispro_protocol_id: 42, protocol_key: "ct_brain", source_version_id: 6, protocol_updated_at: "2026-09-18T10:00:00.000Z" }])) });
      assert.equal(staleVersion.protocolRows[0]?.action, "stale_conflict");
      const invalidId = await service.previewProtocolImport({ fileContentBase64: await workbook(syncSheets([{ ...base, rispro_protocol_id: 999 }], [{ rispro_protocol_id: 999, protocol_key: "ct_brain", source_version_id: 7, protocol_updated_at: "2026-09-18T10:00:00.000Z" }])) });
      assert.equal(invalidId.protocolRows[0]?.action, "invalid");
      const mismatch = await service.previewProtocolImport({ fileContentBase64: await workbook(syncSheets([{ ...base, modality: "MRI" }], [{ rispro_protocol_id: 42, protocol_key: "ct_brain", source_version_id: 7, protocol_updated_at: "2026-09-18T10:00:00.000Z" }])) });
      assert.equal(mismatch.protocolRows[0]?.action, "invalid");
    } finally { queryMock.mock.restore(); }
  });

  it("keeps blank IDs create-only, detects authoritative deactivation, and ignores leftover removed children", async () => {
    const poolModule = await import("../../db/pool.js");
    const queryMock = mock.method(poolModule.pool, "query", existingProtocolLookupMock());
    try {
      const service = await import("./protocol-library-protocol-import-service.js");
      const blankId = await service.previewProtocolImport({ fileContentBase64: await workbook(syncSheets([{ protocol_key: "ct_brain_new", protocol_name: "CT Brain", modality: "CT", anatomy_region: "Brain", category: "General", contrast_policy: "Non-contrast" }], [])) });
      assert.equal(blankId.protocolRows[0]?.action, "conflict_existing_protocol");
      const removed = await service.previewProtocolImport({ fileContentBase64: await workbook(syncSheets([], [{ rispro_protocol_id: 42, protocol_key: "ct_brain", source_version_id: 7, protocol_updated_at: "2026-09-18T10:00:00.000Z" }], "ALL_PROTOCOLS", [{ name: "MRI Sequences", headers: mriHeaders, rows: [{ protocol_key: "ct_brain", order: 1, sequence_key: "t1_ax" }] }])) });
      assert.equal(removed.summary.deactivateProtocols, 1);
      assert.equal(removed.mriSequenceRows[0]?.action, "ignored");
      const single = await service.previewProtocolImport({ fileContentBase64: await workbook(syncSheets([], [{ rispro_protocol_id: 42, protocol_key: "ct_brain", source_version_id: 7, protocol_updated_at: "2026-09-18T10:00:00.000Z" }], "SINGLE_PROTOCOL")) });
      assert.equal(single.summary.deactivateProtocols, 0);
      assert.equal(single.authoritativeSync, false);
      const legacy = await service.previewProtocolImport({ fileContentBase64: await workbook([{ name: "Protocols", headers: protocolHeaders, rows: [] }, { name: "CT Phases", headers: ctPhaseHeaders, rows: [] }, { name: "CT Techniques", headers: ctTechniqueHeaders, rows: [] }, { name: "MRI Sequences", headers: mriHeaders, rows: [] }]) });
      assert.equal(legacy.legacy, true);
      assert.equal(legacy.authoritativeSync, false);
      assert.equal(legacy.summary.deactivateProtocols, 0);
    } finally { queryMock.mock.restore(); }
  });

  it("refuses confirmation when authoritative deactivation is not explicitly approved", async () => {
    const poolModule = await import("../../db/pool.js");
    const queryMock = mock.method(poolModule.pool, "query", existingProtocolLookupMock());
    const connectMock = mock.method(poolModule.pool, "connect", async () => { throw new Error("connect should not be called"); });
    try {
      const { confirmProtocolImport } = await import("./protocol-library-protocol-import-service.js");
      const fileContentBase64 = await workbook(syncSheets([], [{ rispro_protocol_id: 42, protocol_key: "ct_brain", source_version_id: 7, protocol_updated_at: "2026-09-18T10:00:00.000Z" }]));
      await assert.rejects(confirmProtocolImport({ fileContentBase64 }, null), /Explicit confirmation is required/);
    } finally { queryMock.mock.restore(); connectMock.mock.restore(); }
  });

  it("creates draft protocol/version and rolls back the complete workbook when a write fails", async () => {
    const poolModule = await import("../../db/pool.js");
    const queryMock = mock.method(poolModule.pool, "query", lookupMock());
    const calls: string[] = [];
    const connectMock = mock.method(poolModule.pool, "connect", async () => ({ query: async (sql: string) => { calls.push(sql); if (/insert into protocols/i.test(sql)) return { rows: [{ id: 30 }] }; if (/insert into protocol_versions/i.test(sql)) return { rows: [{ id: 31 }] }; if (/insert into protocol_ct_phases/i.test(sql)) throw new Error("forced write failure"); return { rows: [] }; }, release: () => undefined }));
    const fileContentBase64 = await workbook([
      { name: "Protocols", headers: protocolHeaders, rows: [{ protocol_key: "ct_liver", protocol_name: "CT Liver", modality: "CT" }] },
      { name: "CT Phases", headers: ctPhaseHeaders, rows: [{ protocol_key: "ct_liver", order: 1, phase_name: "Portal", timing_type: "MANUAL" }] }, { name: "CT Techniques", headers: ctTechniqueHeaders, rows: [] }, { name: "MRI Sequences", headers: mriHeaders, rows: [] },
    ]);
    try {
      const { confirmProtocolImport } = await import("./protocol-library-protocol-import-service.js");
      await assert.rejects(confirmProtocolImport({ fileContentBase64, fileName: "rollback.xlsx" }, 5), /forced write failure/);
      assert.match(calls[0], /^begin$/i);
      assert.ok(calls.some((sql) => /insert into protocol_versions/i.test(sql) && /'DRAFT'/i.test(sql)));
      assert.match(calls.at(-1)!, /^rollback$/i);
    } finally { queryMock.mock.restore(); connectMock.mock.restore(); }
  });
});
