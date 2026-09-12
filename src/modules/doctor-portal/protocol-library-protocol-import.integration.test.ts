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
      assert.deepEqual(summary, { createdProtocols: 2, createdCtProtocols: 1, createdMriProtocols: 1, createdCtPhases: 2, createdCtTechniques: 1, createdMriSequenceRows: 2 });
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
});
