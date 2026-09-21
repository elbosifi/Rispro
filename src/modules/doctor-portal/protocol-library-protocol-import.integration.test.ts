import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { pool } from "../../db/pool.js";
import { buildWorkbookBuffer, readWorkbookFromBase64 } from "../../services/workbook-service.js";
import { confirmProtocolImport, exportAllProtocolsXlsx, exportProtocolVersionXlsx, exportProtocolXlsx, previewProtocolImport } from "./protocol-library-protocol-import-service.js";

async function workbook(sheets: Array<{ name: string; headers: string[]; rows: Array<Record<string, unknown>> }>): Promise<string> {
  return (await buildWorkbookBuffer(sheets)).toString("base64");
}

async function exportedRows(buffer: Buffer, sheetName: string): Promise<Array<Record<string, unknown>>> {
  const { XLSX, workbook: parsed } = await readWorkbookFromBase64(buffer.toString("base64"));
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(parsed.Sheets[sheetName]);
}

async function exportedSheet(buffer: Buffer, sheetName: string): Promise<{ headers: string[]; rows: Array<Record<string, unknown>> }> {
  const { XLSX, workbook: parsed } = await readWorkbookFromBase64(buffer.toString("base64"));
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(parsed.Sheets[sheetName], { header: 1, defval: "" });
  const headers = (matrix[0] ?? []).map((value) => String(value));
  return { headers, rows: matrix.slice(1).filter((row) => row.some((value) => String(value ?? "").trim())).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]))) };
}

describe("full protocol workbook import database integration", () => {
  it("persists mixed CT/MRI drafts, details, orders, and scanner/preset references", async () => {
    const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
    const anatomyName = `Protocol Import Anatomy ${suffix}`;
    const ctScannerName = `Protocol Import CT ${suffix}`;
    const mriScannerName = `Protocol Import MRI ${suffix}`;
    const ctProtocolName = `Protocol Import CT ${suffix}`;
    const mriProtocolName = `Protocol Import MRI ${suffix}`;
    const sequenceOne = `protocol-import-t1-${suffix}`;
    const sequenceTwo = `protocol-import-t2-${suffix}`;
    try {
      await pool.query("insert into protocol_anatomy_regions (name, modality_scope, is_active) values ($1, 'BOTH', true)", [anatomyName]);
      await pool.query("insert into equipment (name, equipment_type, modality, is_active) values ($1, 'CT', 'CT', true), ($2, 'MRI', 'MRI', true)", [ctScannerName, mriScannerName]);
      const presets = await pool.query<{ id: number; sequence_key: string }>("insert into mri_sequence_presets (sequence_key, name, is_active) values ($1, 'Import T1', true), ($2, 'Import T2', true) returning id, sequence_key", [sequenceOne, sequenceTwo]);
      const fileContentBase64 = await workbook([
        { name: "Protocols", headers: ["protocol_key", "protocol_name", "modality", "anatomy_region", "category", "contrast_policy", "protocol_notes"], rows: [{ protocol_key: "ct_case", protocol_name: ctProtocolName, modality: "CT", anatomy_region: anatomyName, category: "General", contrast_policy: "With IV contrast", protocol_notes: "CT import note" }, { protocol_key: "mri_case", protocol_name: mriProtocolName, modality: "MRI", anatomy_region: anatomyName, category: "General", contrast_policy: "Non-contrast", protocol_notes: "MRI import note" }] },
        { name: "CT Phases", headers: ["protocol_key", "order", "phase_name", "timing_type", "delay_seconds", "coverage", "required"], rows: [{ protocol_key: "ct_case", order: 1, phase_name: "Non-contrast", timing_type: "NON_CONTRAST", coverage: "Liver", required: "yes" }, { protocol_key: "ct_case", order: 2, phase_name: "Portal venous", timing_type: "FIXED_DELAY_INJECTION_START", delay_seconds: 70, coverage: "Liver", required: "true" }] },
        { name: "CT Techniques", headers: ["protocol_key", "scanner", "kv_mode", "tube_current_mode", "slice_thickness_mm"], rows: [{ protocol_key: "ct_case", scanner: ctScannerName, kv_mode: "AUTO", tube_current_mode: "AUTOMATIC", slice_thickness_mm: 1 }] },
        { name: "MRI Sequences", headers: ["protocol_key", "order", "sequence_key", "scanner", "plane", "required"], rows: [{ protocol_key: "mri_case", order: 1, sequence_key: sequenceOne, scanner: mriScannerName, plane: "Axial", required: "true" }, { protocol_key: "mri_case", order: 2, sequence_key: sequenceTwo, plane: "Sagittal", required: "no" }] },
      ]);
      const summary = await confirmProtocolImport({ fileContentBase64, fileName: "protocol-import.xlsx" }, null);
      assert.deepEqual(summary, { createdProtocols: 2, updatedProtocols: 0, unchangedProtocols: 0, deactivatedProtocols: 0, alreadyInactiveProtocols: 0, createdCtProtocols: 1, createdMriProtocols: 1, createdCtPhases: 2, updatedCtPhases: 0, removedCtPhases: 0, createdCtTechniques: 1, updatedCtTechniques: 0, removedCtTechniques: 0, createdMriSequenceRows: 2, updatedMriSequenceRows: 0, removedMriSequenceRows: 0 });
      const versions = await pool.query<{ protocol_id: number; version_id: number; name: string; modality: string; active_version_id: number | null; status: string; version_number: string }>("select p.id as protocol_id, v.id as version_id, p.name, p.modality, p.active_version_id, v.status, v.version_number from protocols p join protocol_versions v on v.protocol_id = p.id where p.name = any($1::text[]) order by p.name", [[ctProtocolName, mriProtocolName]]);
      assert.equal(versions.rows.length, 2);
      assert.ok(versions.rows.every((row) => row.active_version_id === null && row.status === "DRAFT" && row.version_number === "1.0"));
      const ctRows = await pool.query<{ order_index: number; scanner_name: string | null }>("select phase.order_index, technique_scanner.name as scanner_name from protocol_ct_phases phase join protocol_versions version on version.id = phase.protocol_version_id join protocols p on p.id = version.protocol_id left join protocol_ct_techniques technique on technique.protocol_version_id = version.id left join equipment technique_scanner on technique_scanner.id = technique.scanner_id where p.name = $1 order by phase.order_index", [ctProtocolName]);
      assert.deepEqual(ctRows.rows.map((row) => row.order_index), [1, 2]);
      assert.ok(ctRows.rows.every((row) => row.scanner_name === ctScannerName));
      const mriRows = await pool.query<{ order_index: number; sequence_key: string; scanner_name: string | null }>("select row.order_index, preset.sequence_key, scanner.name as scanner_name from protocol_mri_sequences row join protocol_versions version on version.id = row.protocol_version_id join protocols p on p.id = version.protocol_id join mri_sequence_presets preset on preset.id = row.mri_sequence_preset_id left join equipment scanner on scanner.id = row.scanner_id where p.name = $1 order by row.order_index", [mriProtocolName]);
      assert.deepEqual(mriRows.rows.map((row) => row.sequence_key), [sequenceOne, sequenceTwo]);
      assert.equal(mriRows.rows[0]?.scanner_name, mriScannerName);
      assert.equal(mriRows.rows[1]?.scanner_name, null);
      const exportedAll = await exportAllProtocolsXlsx();
      assert.equal(exportedAll.filename, "rispro-protocols.xlsx");
      const exportedProtocols = await exportedRows(exportedAll.buffer, "Protocols");
      const exportedCtPhases = await exportedRows(exportedAll.buffer, "CT Phases");
      const exportedCtTechniques = await exportedRows(exportedAll.buffer, "CT Techniques");
      const exportedMriSequences = await exportedRows(exportedAll.buffer, "MRI Sequences");
      assert.equal(exportedProtocols.length, 2);
      assert.deepEqual(exportedCtPhases.map((row) => row.order), [1, 2]);
      assert.equal(exportedCtTechniques[0]?.scanner, ctScannerName);
      assert.deepEqual(exportedMriSequences.map((row) => row.sequence_key), [sequenceOne, sequenceTwo]);
      assert.equal(exportedCtPhases[0]?.protocol_key, exportedCtTechniques[0]?.protocol_key);
      assert.equal(exportedMriSequences[0]?.protocol_key, exportedMriSequences[1]?.protocol_key);
      const ctVersion = versions.rows.find((row) => row.name === ctProtocolName)!;
      const mriVersion = versions.rows.find((row) => row.name === mriProtocolName)!;
      const ctProtocolId = Number(ctVersion.protocol_id);
      const singleCt = await exportProtocolXlsx(ctProtocolId);
      assert.ok(singleCt);
      assert.equal((await exportedRows(singleCt.buffer, "Protocols")).length, 1);
      assert.equal((await exportedRows(singleCt.buffer, "MRI Sequences")).length, 0);
      const activeVersion = await pool.query<{ id: number }>("insert into protocol_versions (protocol_id, version_number, status, change_summary) values ($1, '2.0', 'ACTIVE', 'Export test active version') returning id", [ctProtocolId]);
      await pool.query("update protocols set active_version_id = $2 where id = $1", [ctProtocolId, activeVersion.rows[0]!.id]);
      const exportedAfterActive = await exportAllProtocolsXlsx();
      assert.equal((await exportedRows(exportedAfterActive.buffer, "CT Phases")).length, 2, "export all keeps the latest draft instead of combining or replacing it with the active version");
      const explicitActive = await exportProtocolVersionXlsx(activeVersion.rows[0]!.id);
      assert.ok(explicitActive);
      assert.match(explicitActive.filename, /-v2\.0\.xlsx$/);
      assert.equal((await exportedRows(explicitActive.buffer, "CT Phases")).length, 0, "explicit version export must not substitute the latest draft");
      assert.equal((await exportedRows(exportedAll.buffer, "MRI Sequences")).length, 2);
      assert.ok(mriVersion.version_id > 0);
      const invalid = await previewProtocolImport({ fileContentBase64: await workbook([{ name: "Protocols", headers: ["protocol_key", "protocol_name", "modality"], rows: [{ protocol_key: "bad", protocol_name: `Protocol Import Invalid ${suffix}`, modality: "CT" }] }, { name: "CT Phases", headers: ["protocol_key", "order", "phase_name", "timing_type"], rows: [{ protocol_key: "missing", order: 1, phase_name: "No", timing_type: "MANUAL" }] }, { name: "CT Techniques", headers: ["protocol_key", "scanner"], rows: [] }, { name: "MRI Sequences", headers: ["protocol_key", "order", "sequence_key"], rows: [] }]), fileName: "invalid.xlsx" });
      assert.equal(invalid.canConfirm, false);
    } finally {
      await pool.query("delete from protocols where name = any($1::text[])", [[ctProtocolName, mriProtocolName]]);
      await pool.query("delete from mri_sequence_presets where sequence_key = any($1::text[])", [[sequenceOne, sequenceTwo]]);
      await pool.query("delete from equipment where name = any($1::text[])", [[ctScannerName, mriScannerName]]);
      await pool.query("delete from protocol_anatomy_regions where name = $1", [anatomyName]);
    }
  });

  it("round-trips an authoritative export through update, deactivation, child replacement, and create semantics", async () => {
    const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
    const anatomyName = `Protocol Roundtrip Anatomy ${suffix}`;
    const ctScannerName = `Protocol Roundtrip CT ${suffix}`;
    const mriScannerName = `Protocol Roundtrip MRI ${suffix}`;
    const ctProtocolName = `Protocol Roundtrip CT ${suffix}`;
    const mriProtocolName = `Protocol Roundtrip MRI ${suffix}`;
    const newProtocolName = `Protocol Roundtrip New ${suffix}`;
    const sequenceKey = `protocol-roundtrip-t1-${suffix}`;
    let ctProtocolId = 0;
    let mriProtocolId = 0;
    let ctActiveVersionId = 0;
    let mriActiveVersionId = 0;
    try {
      const anatomy = await pool.query<{ id: number }>("insert into protocol_anatomy_regions (name, modality_scope, is_active) values ($1, 'BOTH', true) returning id", [anatomyName]);
      const scanners = await pool.query<{ id: number; name: string }>("insert into equipment (name, equipment_type, modality, is_active) values ($1, 'CT', 'CT', true), ($2, 'MRI', 'MRI', true) returning id, name", [ctScannerName, mriScannerName]);
      const ctScannerId = scanners.rows.find((row) => row.name === ctScannerName)!.id;
      const mriScannerId = scanners.rows.find((row) => row.name === mriScannerName)!.id;
      const preset = await pool.query<{ id: number }>("insert into mri_sequence_presets (sequence_key, name, is_active) values ($1, 'Roundtrip T1', true) returning id", [sequenceKey]);
      const ctProtocol = await pool.query<{ id: number }>("insert into protocols (name, modality, anatomy_region_id, category, contrast_policy, is_active) values ($1, 'CT', $2, 'General', 'Non-contrast', true) returning id", [ctProtocolName, anatomy.rows[0]!.id]);
      const mriProtocol = await pool.query<{ id: number }>("insert into protocols (name, modality, anatomy_region_id, category, contrast_policy, is_active) values ($1, 'MRI', $2, 'General', 'Non-contrast', true) returning id", [mriProtocolName, anatomy.rows[0]!.id]);
      ctProtocolId = Number(ctProtocol.rows[0]!.id);
      mriProtocolId = Number(mriProtocol.rows[0]!.id);
      const ctVersion = await pool.query<{ id: number }>("insert into protocol_versions (protocol_id, version_number, status, change_summary, protocol_notes) values ($1, '1.0', 'ACTIVE', 'Roundtrip active CT', 'CT active notes') returning id", [ctProtocolId]);
      const mriVersion = await pool.query<{ id: number }>("insert into protocol_versions (protocol_id, version_number, status, change_summary, protocol_notes) values ($1, '1.0', 'ACTIVE', 'Roundtrip active MRI', 'MRI active notes') returning id", [mriProtocolId]);
      ctActiveVersionId = ctVersion.rows[0]!.id;
      mriActiveVersionId = mriVersion.rows[0]!.id;
      await pool.query("update protocols set active_version_id = $2 where id = $1", [ctProtocolId, ctActiveVersionId]);
      await pool.query("update protocols set active_version_id = $2 where id = $1", [mriProtocolId, mriActiveVersionId]);
      await pool.query("insert into protocol_ct_phases (protocol_version_id, order_index, custom_phase_name, timing_type, coverage_override, is_required) values ($1, 1, 'Initial phase', 'NON_CONTRAST', 'Brain', true), ($1, 2, 'Removed phase', 'MANUAL', 'Brain', false)", [ctActiveVersionId]);
      await pool.query("insert into protocol_ct_techniques (protocol_version_id, scanner_id, kv_mode, tube_current_mode, slice_thickness_mm, reconstruction_interval_mm) values ($1, $2, 'AUTO', 'AUTOMATIC', 1, 1)", [ctActiveVersionId, ctScannerId]);
      await pool.query("insert into protocol_mri_sequences (protocol_version_id, scanner_id, order_index, mri_sequence_preset_id, plane_override, is_required) values ($1, $2, 1, $3, 'Axial', true)", [mriActiveVersionId, mriScannerId, preset.rows[0]!.id]);

      const exported = await exportAllProtocolsXlsx();
      const protocols = await exportedSheet(exported.buffer, "Protocols");
      const phases = await exportedSheet(exported.buffer, "CT Phases");
      const techniques = await exportedSheet(exported.buffer, "CT Techniques");
      const sequences = await exportedSheet(exported.buffer, "MRI Sequences");
      const metadata = await exportedSheet(exported.buffer, "RISpro Metadata");
      const manifest = await exportedSheet(exported.buffer, "RISpro Manifest");
      const instructions = await exportedSheet(exported.buffer, "Instructions");
      const ctRow = protocols.rows.find((row) => Number(row.rispro_protocol_id) === ctProtocolId)!;
      const modifiedProtocols = protocols.rows.filter((row) => Number(row.rispro_protocol_id) !== mriProtocolId).map((row) => Number(row.rispro_protocol_id) === ctProtocolId ? { ...row, protocol_name: `${ctProtocolName} Renamed`, contrast_policy: "With IV contrast" } : row);
      modifiedProtocols.push({ protocol_key: "new_roundtrip", protocol_name: newProtocolName, modality: "CT", is_active: true, anatomy_region: anatomyName, category: "General", contrast_policy: "Non-contrast", protocol_notes: "New draft notes" });
      const modifiedPhases = phases.rows.filter((row) => !(row.protocol_key === ctRow.protocol_key && Number(row.order) === 2)).map((row) => row.protocol_key === ctRow.protocol_key && Number(row.order) === 1 ? { ...row, phase_name: "Changed phase" } : row);
      const modifiedTechniques = techniques.rows.map((row) => row.protocol_key === ctRow.protocol_key ? { ...row, kv_mode: "FIXED", kvp: 120 } : row);
      const modified = await workbook([
        { name: "Protocols", headers: protocols.headers, rows: modifiedProtocols },
        { name: "CT Phases", headers: phases.headers, rows: modifiedPhases },
        { name: "CT Techniques", headers: techniques.headers, rows: modifiedTechniques },
        { name: "MRI Sequences", headers: sequences.headers, rows: sequences.rows },
        { name: "RISpro Metadata", headers: metadata.headers, rows: metadata.rows },
        { name: "RISpro Manifest", headers: manifest.headers, rows: manifest.rows },
        { name: "Instructions", headers: instructions.headers, rows: instructions.rows },
      ]);
      const preview = await previewProtocolImport({ fileContentBase64: modified, fileName: "roundtrip.xlsx" });
      assert.equal(preview.summary.createProtocols, 1);
      assert.equal(preview.summary.updateProtocols, 1);
      assert.equal(preview.summary.deactivateProtocols, 1);
      assert.equal(preview.summary.errors, 0);
      assert.equal(preview.mriSequenceRows.every((row) => row.action === "ignored"), true);
      const summary = await confirmProtocolImport({ fileContentBase64: modified, fileName: "roundtrip.xlsx", confirmMissingProtocolDeactivation: true }, null);
      assert.equal(summary.createdProtocols, 1);
      assert.equal(summary.updatedProtocols, 1);
      assert.equal(summary.deactivatedProtocols, 1);
      const ctState = await pool.query<{ id: number; name: string; active_version_id: number | null; draft_id: number | null; draft_status: string | null }>("select p.id, p.name, p.active_version_id, dv.id as draft_id, dv.status as draft_status from protocols p left join lateral (select id, status from protocol_versions where protocol_id = p.id and status = 'DRAFT' order by id desc limit 1) dv on true where p.id = $1", [ctProtocolId]);
      assert.equal(ctState.rows[0]!.name, `${ctProtocolName} Renamed`);
      assert.equal(ctState.rows[0]!.active_version_id, ctActiveVersionId);
      assert.ok(ctState.rows[0]!.draft_id);
      assert.equal(ctState.rows[0]!.draft_status, "DRAFT");
      const draftPhases = await pool.query<{ order_index: number; custom_phase_name: string }>("select order_index, custom_phase_name from protocol_ct_phases where protocol_version_id = $1 order by order_index", [ctState.rows[0]!.draft_id]);
      assert.deepEqual(draftPhases.rows, [{ order_index: 1, custom_phase_name: "Changed phase" }]);
      const activePhase = await pool.query<{ order_index: number; custom_phase_name: string }>("select order_index, custom_phase_name from protocol_ct_phases where protocol_version_id = $1 order by order_index", [ctActiveVersionId]);
      assert.deepEqual(activePhase.rows.map((row) => row.order_index), [1, 2]);
      const mriState = await pool.query<{ is_active: boolean; active_version_id: number | null; version_count: number }>("select p.is_active, p.active_version_id, count(v.id)::int as version_count from protocols p left join protocol_versions v on v.protocol_id = p.id where p.id = $1 group by p.id", [mriProtocolId]);
      assert.equal(mriState.rows[0]!.is_active, false);
      assert.equal(mriState.rows[0]!.active_version_id, mriActiveVersionId);
      assert.equal(mriState.rows[0]!.version_count, 1);
      const newState = await pool.query<{ id: number; active_version_id: number | null; status: string }>("select p.id, p.active_version_id, v.status from protocols p join protocol_versions v on v.protocol_id = p.id where p.name = $1", [newProtocolName]);
      assert.equal(newState.rows.length, 1);
      assert.equal(newState.rows[0]!.active_version_id, null);
      assert.equal(newState.rows[0]!.status, "DRAFT");

      const reexported = await exportAllProtocolsXlsx();
      const unchangedPreview = await previewProtocolImport({ fileContentBase64: reexported.buffer.toString("base64"), fileName: reexported.filename });
      assert.equal(unchangedPreview.summary.createProtocols, 0);
      assert.equal(unchangedPreview.summary.updateProtocols, 0);
      assert.equal(unchangedPreview.summary.deactivateProtocols, 0);
      assert.equal(unchangedPreview.summary.errors, 0);
      const unchangedSummary = await confirmProtocolImport({ fileContentBase64: reexported.buffer.toString("base64"), fileName: reexported.filename, confirmMissingProtocolDeactivation: false }, null);
      assert.equal(unchangedSummary.createdProtocols, 0);
      assert.equal(unchangedSummary.updatedProtocols, 0);
      assert.equal(unchangedSummary.unchangedProtocols, 3);
      const versionCount = await pool.query<{ count: number }>("select count(*)::int as count from protocol_versions where protocol_id = any($1::int[])", [[ctProtocolId, mriProtocolId, newState.rows[0]!.id]]);
      assert.equal(versionCount.rows[0]!.count, 4);

      const failureProtocols = await exportedSheet(reexported.buffer, "Protocols");
      const failurePhases = await exportedSheet(reexported.buffer, "CT Phases");
      const failureTechniques = await exportedSheet(reexported.buffer, "CT Techniques");
      const failureSequences = await exportedSheet(reexported.buffer, "MRI Sequences");
      const failureMetadata = await exportedSheet(reexported.buffer, "RISpro Metadata");
      const failureManifest = await exportedSheet(reexported.buffer, "RISpro Manifest");
      const failureInstructions = await exportedSheet(reexported.buffer, "Instructions");
      const failureCtKey = failureProtocols.rows.find((row) => Number(row.rispro_protocol_id) === ctProtocolId)!.protocol_key;
      const failureWorkbook = await workbook([
        { name: "Protocols", headers: failureProtocols.headers, rows: failureProtocols.rows },
        { name: "CT Phases", headers: failurePhases.headers, rows: failurePhases.rows.map((row) => row.protocol_key === failureCtKey && Number(row.order) === 1 ? { ...row, phase_name: "Force rollback" } : row) },
        { name: "CT Techniques", headers: failureTechniques.headers, rows: failureTechniques.rows },
        { name: "MRI Sequences", headers: failureSequences.headers, rows: failureSequences.rows },
        { name: "RISpro Metadata", headers: failureMetadata.headers, rows: failureMetadata.rows },
        { name: "RISpro Manifest", headers: failureManifest.headers, rows: failureManifest.rows },
        { name: "Instructions", headers: failureInstructions.headers, rows: failureInstructions.rows },
      ]);
      const failurePreview = await previewProtocolImport({ fileContentBase64: failureWorkbook, fileName: "roundtrip-failure.xlsx" });
      assert.equal(failurePreview.canConfirm, true);
      const failureFunction = `protocol_import_failure_${suffix}`;
      const failureTrigger = `protocol_import_failure_trigger_${suffix}`;
      try {
        await pool.query(`create function ${failureFunction}() returns trigger language plpgsql as $$ begin if NEW.custom_phase_name = 'Force rollback' then raise exception 'forced integration failure'; end if; return NEW; end $$`);
        await pool.query(`create trigger ${failureTrigger} before insert on protocol_ct_phases for each row execute function ${failureFunction}()`);
        await assert.rejects(confirmProtocolImport({ fileContentBase64: failureWorkbook, fileName: "roundtrip-failure.xlsx" }, null), /forced integration failure/);
      } finally {
        await pool.query(`drop trigger if exists ${failureTrigger} on protocol_ct_phases`);
        await pool.query(`drop function if exists ${failureFunction}()`);
      }
      const afterFailure = await pool.query<{ custom_phase_name: string }>("select custom_phase_name from protocol_ct_phases where protocol_version_id = $1 and order_index = 1", [ctState.rows[0]!.draft_id]);
      assert.equal(afterFailure.rows[0]!.custom_phase_name, "Changed phase");
    } finally {
      await pool.query("delete from protocols where id = any($1::int[])", [[ctProtocolId, mriProtocolId].filter((id) => id > 0)]);
      await pool.query("delete from protocols where name = $1", [newProtocolName]);
      await pool.query("delete from mri_sequence_presets where sequence_key = $1", [sequenceKey]);
      await pool.query("delete from equipment where name = any($1::text[])", [[ctScannerName, mriScannerName]]);
      await pool.query("delete from protocol_anatomy_regions where name = $1", [anatomyName]);
    }
  });
});
