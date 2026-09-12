import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { buildWorkbookBuffer } from "../../services/workbook-service.js";

process.env.DATABASE_URL ??= "postgresql://example@example/protocol_library_protocol_import_test";
process.env.JWT_SECRET ??= "protocol-library-protocol-import-test-secret";

async function workbook(sheets: Array<{ name: string; headers: string[]; rows: Array<Record<string, unknown>> }>): Promise<string> {
  return (await buildWorkbookBuffer(sheets)).toString("base64");
}

const protocolHeaders = ["protocol_key", "protocol_name", "modality", "anatomy_region", "category", "contrast_policy"];
const ctPhaseHeaders = ["protocol_key", "order", "phase_name", "timing_type", "coverage"];
const ctTechniqueHeaders = ["protocol_key", "scanner", "kv_mode", "tube_current_mode"];
const mriHeaders = ["protocol_key", "order", "sequence_key", "scanner"];

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
