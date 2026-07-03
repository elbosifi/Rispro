import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { buildWorkbookBuffer } from "../../services/workbook-service.js";

process.env.DATABASE_URL ??= "postgresql://example@example/protocol_library_mri_import_test";
process.env.JWT_SECRET ??= "protocol-library-mri-import-test-secret";

function base64(buffer: Buffer): string {
  return buffer.toString("base64");
}

async function workbook(rowsBySheet: Array<{ name: string; rows: Array<Record<string, unknown>>; headers?: string[] }>) {
  return base64(await buildWorkbookBuffer(rowsBySheet));
}

describe("MRI sequence preset XLSX import/export", () => {
  it("template XLSX has MRI Sequences and Scanner Aliases sheets", async () => {
    const { mriSequenceImportTemplateXlsx, inspectMriSequenceImport } = await import("./protocol-library-mri-sequence-import-export-service.js");

    const template = await mriSequenceImportTemplateXlsx();
    const inspect = await inspectMriSequenceImport({ fileContentBase64: base64(template.buffer), fileName: template.filename });

    assert.deepEqual(inspect.sheets.map((sheet) => sheet.sheetName), ["MRI Sequences", "Scanner Aliases", "Instructions"]);
    assert.equal(inspect.sheets[0].missingRequiredColumns.length, 0);
    assert.equal(inspect.sheets[1].missingRequiredColumns.length, 0);
  });

  it("export current XLSX includes sequences and aliases", async () => {
    const poolModule = await import("../../db/pool.js");
    const queryMock = mock.method(poolModule.pool, "query", async (sql: string) => {
      if (/from mri_sequence_presets/i.test(sql)) {
        return { rows: [{ id: 7, sequence_key: null, name: "Axial T2", default_plane: "Axial", weighting: "T2", fat_suppression: "None", acquisition_type: "2D", contrast_relation: "Non-contrast", default_coverage: "Brain", default_b_values: null, default_dynamic_timing: null, estimated_scan_time_minutes: 4, notes: "Routine", is_active: false }] };
      }
      return { rows: [{ sequence_key: null, sequence_id: 7, sequence_name: "Axial T2", scanner_display_name: "Example MRI", vendor_sequence_name: "T2 AX", alias_notes: "Alias" }] };
    });

    try {
      const { exportMriSequencePresetsXlsx, inspectMriSequenceImport } = await import("./protocol-library-mri-sequence-import-export-service.js");
      const exported = await exportMriSequencePresetsXlsx();
      const inspect = await inspectMriSequenceImport({ fileContentBase64: base64(exported.buffer), fileName: exported.filename });

      assert.equal(exported.filename, "rispro-mri-sequences.xlsx");
      assert.equal(inspect.sheets[0].rowCount, 1);
      assert.equal(inspect.sheets[1].rowCount, 1);
    } finally {
      queryMock.mock.restore();
    }
  });

  it("inspect detects missing required columns", async () => {
    const fileContentBase64 = await workbook([{ name: "MRI Sequences", headers: ["sequence_key", "sequence_name"], rows: [{ sequence_key: "dwi", sequence_name: "DWI" }] }]);
    const { inspectMriSequenceImport } = await import("./protocol-library-mri-sequence-import-export-service.js");

    const inspect = await inspectMriSequenceImport({ fileContentBase64, fileName: "bad.xlsx" });

    assert.ok(inspect.sheets[0].missingRequiredColumns.includes("plane"));
    assert.ok(inspect.sheets[0].missingRequiredColumns.includes("contrast_relation"));
  });

  it("preview validates dropdowns, duplicates, scanners, and same-workbook sequence aliases", async () => {
    const poolModule = await import("../../db/pool.js");
    const queryMock = mock.method(poolModule.pool, "query", async (sql: string) => {
      if (/from mri_sequence_presets/i.test(sql)) return { rows: [] };
      if (/from imaging_scanners/i.test(sql)) return { rows: [{ id: 2, name: "MRI A" }] };
      if (/from mri_sequence_scanner_aliases/i.test(sql)) return { rows: [] };
      return { rows: [] };
    });
    const fileContentBase64 = await workbook([
      {
        name: "MRI Sequences",
        headers: ["sequence_key", "sequence_name", "plane", "weighting", "fat_suppression", "acquisition_type", "contrast_relation"],
        rows: [
          { sequence_key: "dwi", sequence_name: "DWI", plane: "Axial", weighting: "DWI / ADC", fat_suppression: "None", acquisition_type: "2D", contrast_relation: "Non-contrast" },
          { sequence_key: "dwi", sequence_name: "DWI duplicate", plane: "Bad", weighting: "T2", fat_suppression: "None", acquisition_type: "2D", contrast_relation: "Non-contrast" },
        ],
      },
      {
        name: "Scanner Aliases",
        headers: ["sequence_key", "scanner_display_name", "vendor_sequence_name", "alias_notes"],
        rows: [
          { sequence_key: "dwi", scanner_display_name: "MRI A", vendor_sequence_name: "ep2d_diff", alias_notes: "" },
          { sequence_key: "dwi", scanner_display_name: "Unknown MRI", vendor_sequence_name: "bad", alias_notes: "" },
        ],
      },
    ]);

    try {
      const { previewMriSequenceImport } = await import("./protocol-library-mri-sequence-import-export-service.js");
      const preview = await previewMriSequenceImport({ fileContentBase64, fileName: "preview.xlsx" });

      assert.equal(preview.canConfirm, false);
      assert.equal(preview.sequenceRows[0].action, "create_sequence");
      assert.equal(preview.aliasRows[0].action, "create_alias");
      assert.ok(preview.sequenceRows[1].errors.some((error) => /duplicate sequence_key/i.test(error)));
      assert.ok(preview.sequenceRows[1].errors.some((error) => /plane/i.test(error)));
      assert.ok(preview.aliasRows[1].errors.some((error) => /unknown scanner_display_name/i.test(error)));
    } finally {
      queryMock.mock.restore();
    }
  });

  it("confirm creates and updates sequences and aliases transactionally", async () => {
    const poolModule = await import("../../db/pool.js");
    const queryMock = mock.method(poolModule.pool, "query", async (sql: string) => {
      if (/from mri_sequence_presets/i.test(sql)) return { rows: [{ id: 9, sequence_key: "existing", name: "Old", is_active: false }] };
      if (/from imaging_scanners/i.test(sql)) return { rows: [{ id: 2, name: "MRI A" }] };
      if (/from mri_sequence_scanner_aliases/i.test(sql)) return { rows: [{ id: 4, sequence_key: "existing", mri_sequence_preset_id: 9, scanner_id: 2, scanner_display_name: "MRI A", vendor_sequence_name: "old" }] };
      return { rows: [] };
    });
    const clientQueries: string[] = [];
    const connectMock = mock.method(poolModule.pool, "connect", async () => ({
      query: async (sql: string) => {
        clientQueries.push(sql);
        if (/insert into mri_sequence_presets/i.test(sql)) return { rows: [{ id: 10 }] };
        return { rows: [] };
      },
      release: () => undefined,
    }));
    const fileContentBase64 = await workbook([
      {
        name: "MRI Sequences",
        headers: ["sequence_key", "sequence_name", "plane", "weighting", "fat_suppression", "acquisition_type", "contrast_relation"],
        rows: [
          { sequence_key: "new-dwi", sequence_name: "New DWI", plane: "Axial", weighting: "DWI / ADC", fat_suppression: "None", acquisition_type: "2D", contrast_relation: "Non-contrast" },
          { sequence_key: "existing", sequence_name: "Updated", plane: "Sagittal", weighting: "T1", fat_suppression: "Dixon", acquisition_type: "3D", contrast_relation: "Post-contrast" },
        ],
      },
      {
        name: "Scanner Aliases",
        headers: ["sequence_key", "scanner_display_name", "vendor_sequence_name", "alias_notes"],
        rows: [
          { sequence_key: "new-dwi", scanner_display_name: "MRI A", vendor_sequence_name: "new_vendor", alias_notes: "" },
          { sequence_key: "existing", scanner_display_name: "MRI A", vendor_sequence_name: "updated_vendor", alias_notes: "" },
        ],
      },
    ]);

    try {
      const { confirmMriSequenceImport } = await import("./protocol-library-mri-sequence-import-export-service.js");
      const summary = await confirmMriSequenceImport({ fileContentBase64, fileName: "confirm.xlsx" });

      assert.deepEqual(summary, { createdSequences: 1, updatedSequences: 1, unchangedSequences: 0, createdAliases: 1, updatedAliases: 1, unchangedAliases: 0 });
      assert.match(clientQueries.join("\n"), /^begin/i);
      assert.match(clientQueries.join("\n"), /insert into mri_sequence_presets/i);
      assert.match(clientQueries.join("\n"), /update mri_sequence_presets/i);
      assert.match(clientQueries.join("\n"), /insert into mri_sequence_scanner_aliases/i);
      assert.match(clientQueries.join("\n"), /update mri_sequence_scanner_aliases/i);
      assert.match(clientQueries.join("\n"), /commit/i);
    } finally {
      queryMock.mock.restore();
      connectMock.mock.restore();
    }
  });

  it("confirm persists an exported suggested sequence_key for an existing legacy row", async () => {
    const poolModule = await import("../../db/pool.js");
    const queryMock = mock.method(poolModule.pool, "query", async (sql: string) => {
      if (/from mri_sequence_presets/i.test(sql)) {
        return { rows: [{ id: 7, sequence_key: null, name: "Axial T2", default_plane: "Axial", weighting: "T2", fat_suppression: "None", acquisition_type: "2D", contrast_relation: "Non-contrast", default_coverage: null, default_b_values: null, default_dynamic_timing: null, estimated_scan_time_minutes: 4, notes: null, is_active: true }] };
      }
      if (/from imaging_scanners/i.test(sql)) return { rows: [] };
      if (/from mri_sequence_scanner_aliases/i.test(sql)) return { rows: [] };
      return { rows: [] };
    });
    const clientQueries: Array<{ sql: string; params: unknown[] }> = [];
    const connectMock = mock.method(poolModule.pool, "connect", async () => ({
      query: async (sql: string, params?: unknown[]) => {
        clientQueries.push({ sql, params: params ?? [] });
        return { rows: [] };
      },
      release: () => undefined,
    }));
    const fileContentBase64 = await workbook([
      {
        name: "MRI Sequences",
        headers: ["sequence_key", "sequence_name", "plane", "weighting", "fat_suppression", "acquisition_type", "contrast_relation", "estimated_scan_time_minutes"],
        rows: [{ sequence_key: "axial-t2-7", sequence_name: "Axial T2", plane: "Axial", weighting: "T2", fat_suppression: "None", acquisition_type: "2D", contrast_relation: "Non-contrast", estimated_scan_time_minutes: 4 }],
      },
      { name: "Scanner Aliases", headers: ["sequence_key", "scanner_display_name", "vendor_sequence_name"], rows: [] },
    ]);

    try {
      const { confirmMriSequenceImport } = await import("./protocol-library-mri-sequence-import-export-service.js");
      const summary = await confirmMriSequenceImport({ fileContentBase64, fileName: "legacy.xlsx" });

      assert.equal(summary.updatedSequences, 1);
      const update = clientQueries.find((query) => /update mri_sequence_presets/i.test(query.sql));
      assert.equal(update?.params[0], 7);
      assert.equal(update?.params[1], "axial-t2-7");
    } finally {
      queryMock.mock.restore();
      connectMock.mock.restore();
    }
  });
});
