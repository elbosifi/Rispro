import { pool } from "../../db/pool.js";
import { buildWorkbookBuffer, parseWorksheet, readWorkbookFromBase64, type ParsedWorksheet } from "../../services/workbook-service.js";
import { HttpError } from "../../utils/http-error.js";

const SEQUENCE_SHEET = "MRI Sequences";
const ALIAS_SHEET = "Scanner Aliases";
const INSTRUCTIONS_SHEET = "Instructions";

const SEQUENCE_REQUIRED = ["sequence_key", "sequence_name", "plane", "weighting", "fat_suppression", "acquisition_type", "contrast_relation"];
const SEQUENCE_OPTIONAL = ["default_coverage", "default_b_values", "default_dynamic_timing", "estimated_scan_time_minutes", "notes", "active"];
const SEQUENCE_COLUMNS = [...SEQUENCE_REQUIRED, ...SEQUENCE_OPTIONAL];
const ALIAS_REQUIRED = ["sequence_key", "scanner_display_name", "vendor_sequence_name"];
const ALIAS_COLUMNS = [...ALIAS_REQUIRED, "alias_notes"];

const PLANES = new Set(["Axial", "Sagittal", "Coronal", "Oblique axial", "Oblique coronal", "3D / isotropic", "Other"]);
const WEIGHTINGS = new Set(["T1", "T2", "PD", "FLAIR", "DWI / ADC", "SWI / T2*", "Perfusion", "Dynamic contrast", "MRCP", "MRA / TOF", "Localizer", "Other"]);
const FAT_SUPPRESSIONS = new Set(["None", "Fat saturated", "Dixon", "STIR", "SPAIR / SPIR", "Other"]);
const ACQUISITION_TYPES = new Set(["2D", "3D", "Not specified"]);
const CONTRAST_RELATIONS = new Set(["Non-contrast", "Pre-contrast", "Post-contrast", "Dynamic", "Optional / depends on protocol"]);

type ImportInput = { fileContentBase64: string; fileName?: string | null };
type SequenceAction = "create_sequence" | "update_sequence" | "unchanged" | "invalid";
type AliasAction = "create_alias" | "update_alias" | "unchanged" | "invalid";

interface ParsedImport {
  sheetNames: string[];
  sequences: ParsedWorksheet;
  aliases: ParsedWorksheet;
}

interface ExistingSequence {
  id: number;
  sequenceKey: string;
  hasPersistedSequenceKey: boolean;
  name: string;
  defaultPlane: string | null;
  weighting: string | null;
  fatSuppression: string | null;
  acquisitionType: string | null;
  contrastRelation: string | null;
  defaultCoverage: string | null;
  defaultBValues: string | null;
  defaultDynamicTiming: string | null;
  estimatedScanTimeMinutes: number | null;
  notes: string | null;
  isActive: boolean;
}

interface ScannerRow {
  id: number;
  name: string;
}

interface ExistingAlias {
  id: number;
  sequenceKey: string;
  sequenceId: number;
  scannerId: number;
  scannerDisplayName: string;
  vendorSequenceName: string;
  notes: string | null;
}

interface NormalizedSequence {
  rowNumber: number;
  sequenceKey: string;
  name: string;
  defaultPlane: string;
  weighting: string;
  fatSuppression: string;
  acquisitionType: string;
  contrastRelation: string;
  defaultCoverage: string | null;
  defaultBValues: string | null;
  defaultDynamicTiming: string | null;
  estimatedScanTimeMinutes: number | null;
  notes: string | null;
  active: boolean | null;
}

interface NormalizedAlias {
  rowNumber: number;
  sequenceKey: string;
  scannerDisplayName: string;
  vendorSequenceName: string;
  notes: string | null;
}

export interface MriSequenceImportInspect {
  format: "xlsx";
  sheets: Array<{ sheetName: string; columns: string[]; requiredColumns: string[]; missingRequiredColumns: string[]; rowCount: number }>;
}

export interface MriSequenceImportPreview {
  sequenceRows: Array<{ rowNumber: number; sequenceKey: string; sequenceName: string; action: SequenceAction; errors: string[] }>;
  aliasRows: Array<{ rowNumber: number; sequenceKey: string; scannerDisplayName: string; vendorSequenceName: string; action: AliasAction; errors: string[] }>;
  canConfirm: boolean;
}

export interface MriSequenceImportSummary {
  createdSequences: number;
  updatedSequences: number;
  unchangedSequences: number;
  createdAliases: number;
  updatedAliases: number;
  unchangedAliases: number;
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function nullableText(value: unknown): string | null {
  const clean = text(value);
  return clean ? clean : null;
}

function keyOf(value: string): string {
  return value.trim().toLowerCase();
}

function suggestedSequenceKey(name: string, id: number): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  return slug ? `${slug}-${id}` : `mri-sequence-${id}`;
}

function normalizeSheetRows(sheet: ParsedWorksheet): ParsedWorksheet {
  return {
    headers: sheet.headers.map((header) => header.trim()),
    rows: sheet.rows.map((row) => ({
      rowNumber: row.rowNumber,
      values: Object.fromEntries(Object.entries(row.values).map(([key, value]) => [key.trim(), text(value)])),
    })),
  };
}

async function parseImport(input: ImportInput): Promise<ParsedImport> {
  const { XLSX, workbook, sheetNames } = await readWorkbookFromBase64(input.fileContentBase64);
  const sequences = normalizeSheetRows(parseWorksheet(XLSX, workbook.Sheets[SEQUENCE_SHEET], SEQUENCE_SHEET));
  const aliases = workbook.Sheets[ALIAS_SHEET]
    ? normalizeSheetRows(parseWorksheet(XLSX, workbook.Sheets[ALIAS_SHEET], ALIAS_SHEET))
    : { headers: [], rows: [] };
  return { sheetNames, sequences, aliases };
}

function missing(headers: string[], required: string[]): string[] {
  return required.filter((column) => !headers.includes(column));
}

function parseBoolean(value: string, fallback: boolean | null): boolean | null {
  const clean = value.trim().toLowerCase();
  if (!clean) return fallback;
  if (["true", "yes", "1"].includes(clean)) return true;
  if (["false", "no", "0"].includes(clean)) return false;
  throw new Error("active must be true/false/yes/no/1/0");
}

function parsePositiveMinutes(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error("estimated_scan_time_minutes must be blank or a positive number");
  return parsed;
}

function normalizeSequence(row: { rowNumber: number; values: Record<string, unknown> }): { sequence: NormalizedSequence; errors: string[] } {
  const values = row.values;
  const errors: string[] = [];
  const sequenceKey = text(values.sequence_key);
  const name = text(values.sequence_name);
  const defaultPlane = text(values.plane);
  const weighting = text(values.weighting);
  const fatSuppression = text(values.fat_suppression);
  const acquisitionType = text(values.acquisition_type);
  const contrastRelation = text(values.contrast_relation);
  if (!sequenceKey) errors.push("sequence_key is required");
  if (!name) errors.push("sequence_name is required");
  if (!PLANES.has(defaultPlane)) errors.push("plane is invalid");
  if (!WEIGHTINGS.has(weighting)) errors.push("weighting is invalid");
  if (!FAT_SUPPRESSIONS.has(fatSuppression)) errors.push("fat_suppression is invalid");
  if (!ACQUISITION_TYPES.has(acquisitionType)) errors.push("acquisition_type is invalid");
  if (!CONTRAST_RELATIONS.has(contrastRelation)) errors.push("contrast_relation is invalid");
  let estimatedScanTimeMinutes: number | null = null;
  let active: boolean | null = null;
  try {
    estimatedScanTimeMinutes = parsePositiveMinutes(text(values.estimated_scan_time_minutes));
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "estimated_scan_time_minutes is invalid");
  }
  try {
    active = parseBoolean(text(values.active), null);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "active is invalid");
  }
  return {
    sequence: {
      rowNumber: row.rowNumber,
      sequenceKey,
      name,
      defaultPlane,
      weighting,
      fatSuppression,
      acquisitionType,
      contrastRelation,
      defaultCoverage: nullableText(values.default_coverage),
      defaultBValues: nullableText(values.default_b_values),
      defaultDynamicTiming: nullableText(values.default_dynamic_timing),
      estimatedScanTimeMinutes,
      notes: nullableText(values.notes),
      active,
    },
    errors,
  };
}

function normalizeAlias(row: { rowNumber: number; values: Record<string, unknown> }): { alias: NormalizedAlias; errors: string[] } {
  const values = row.values;
  const errors: string[] = [];
  const alias = {
    rowNumber: row.rowNumber,
    sequenceKey: text(values.sequence_key),
    scannerDisplayName: text(values.scanner_display_name),
    vendorSequenceName: text(values.vendor_sequence_name),
    notes: nullableText(values.alias_notes),
  };
  if (!alias.sequenceKey) errors.push("sequence_key is required");
  if (!alias.scannerDisplayName) errors.push("scanner_display_name is required");
  if (!alias.vendorSequenceName) errors.push("vendor_sequence_name is required");
  return { alias, errors };
}

async function existingSequences(): Promise<Map<string, ExistingSequence>> {
  const result = await pool.query(`
    select id, sequence_key, name, default_plane, weighting, fat_suppression, acquisition_type, contrast_relation,
           default_coverage, default_b_values, default_dynamic_timing, estimated_scan_time_minutes, notes, is_active
    from mri_sequence_presets
  `);
  return new Map(result.rows.map((row: Record<string, unknown>) => {
    const id = Number(row.id);
    const name = String(row.name);
    const sequenceKey = text(row.sequence_key) || suggestedSequenceKey(name, id);
    return [keyOf(sequenceKey), {
    id,
    sequenceKey,
    hasPersistedSequenceKey: Boolean(text(row.sequence_key)),
    name: String(row.name),
    defaultPlane: nullableText(row.default_plane),
    weighting: nullableText(row.weighting),
    fatSuppression: nullableText(row.fat_suppression),
    acquisitionType: nullableText(row.acquisition_type),
    contrastRelation: nullableText(row.contrast_relation),
    defaultCoverage: nullableText(row.default_coverage),
    defaultBValues: nullableText(row.default_b_values),
    defaultDynamicTiming: nullableText(row.default_dynamic_timing),
    estimatedScanTimeMinutes: row.estimated_scan_time_minutes == null ? null : Number(row.estimated_scan_time_minutes),
    notes: nullableText(row.notes),
    isActive: Boolean(row.is_active),
  }];
  }));
}

async function scannerMap(): Promise<Map<string, ScannerRow>> {
  const result = await pool.query(`select id, name from equipment where modality = 'MRI'`);
  return new Map(result.rows.map((row: Record<string, unknown>) => [keyOf(String(row.name)), { id: Number(row.id), name: String(row.name) }]));
}

async function existingAliases(): Promise<Map<string, ExistingAlias>> {
  const result = await pool.query(`
    select alias.id, coalesce(preset.sequence_key, '') as sequence_key, alias.mri_sequence_preset_id, alias.scanner_id,
           scanner.name as scanner_display_name, alias.vendor_sequence_name, alias.notes
    from mri_sequence_scanner_aliases alias
    join mri_sequence_presets preset on preset.id = alias.mri_sequence_preset_id
    join equipment scanner on scanner.id = alias.scanner_id
    where preset.sequence_key is not null
  `);
  return new Map(result.rows.map((row: Record<string, unknown>) => [`${keyOf(String(row.sequence_key))}|${keyOf(String(row.scanner_display_name))}`, {
    id: Number(row.id),
    sequenceKey: String(row.sequence_key),
    sequenceId: Number(row.mri_sequence_preset_id),
    scannerId: Number(row.scanner_id),
    scannerDisplayName: String(row.scanner_display_name),
    vendorSequenceName: String(row.vendor_sequence_name),
    notes: nullableText(row.notes),
  }]));
}

function sequenceChanged(sequence: NormalizedSequence, existing: ExistingSequence): boolean {
  return !existing.hasPersistedSequenceKey ||
    existing.name !== sequence.name ||
    existing.defaultPlane !== sequence.defaultPlane ||
    existing.weighting !== sequence.weighting ||
    existing.fatSuppression !== sequence.fatSuppression ||
    existing.acquisitionType !== sequence.acquisitionType ||
    existing.contrastRelation !== sequence.contrastRelation ||
    existing.defaultCoverage !== sequence.defaultCoverage ||
    existing.defaultBValues !== sequence.defaultBValues ||
    existing.defaultDynamicTiming !== sequence.defaultDynamicTiming ||
    existing.estimatedScanTimeMinutes !== sequence.estimatedScanTimeMinutes ||
    existing.notes !== sequence.notes ||
    (sequence.active !== null && existing.isActive !== sequence.active);
}

function aliasChanged(alias: NormalizedAlias, existing: ExistingAlias): boolean {
  return existing.vendorSequenceName !== alias.vendorSequenceName || existing.notes !== alias.notes;
}

export async function inspectMriSequenceImport(input: ImportInput): Promise<MriSequenceImportInspect> {
  const parsed = await parseImport(input);
  const sheetMap = new Map([
    [SEQUENCE_SHEET, { worksheet: parsed.sequences, required: SEQUENCE_REQUIRED }],
    [ALIAS_SHEET, { worksheet: parsed.aliases, required: ALIAS_REQUIRED }],
  ]);
  const sheets = parsed.sheetNames.map((sheetName) => {
    const known = sheetMap.get(sheetName);
    const worksheet = known?.worksheet ?? { headers: [], rows: [] };
    return {
      sheetName,
      columns: worksheet.headers,
      requiredColumns: known?.required ?? [],
      missingRequiredColumns: known ? missing(worksheet.headers, known.required) : [],
      rowCount: worksheet.rows.length,
    };
  });
  return { format: "xlsx", sheets };
}

export async function previewMriSequenceImport(input: ImportInput): Promise<MriSequenceImportPreview> {
  const parsed = await parseImport(input);
  const requiredErrors = [
    ...missing(parsed.sequences.headers, SEQUENCE_REQUIRED).map((column) => `${SEQUENCE_SHEET} missing ${column}`),
    ...missing(parsed.aliases.headers, ALIAS_REQUIRED).map((column) => `${ALIAS_SHEET} missing ${column}`),
  ];
  const existingByKey = await existingSequences();
  const scannersByName = await scannerMap();
  const aliasesByKey = await existingAliases();
  const seenSequences = new Set<string>();
  const workbookSequenceKeys = new Set<string>();
  const normalizedSequences = parsed.sequences.rows.map((row) => normalizeSequence(row));
  for (const item of normalizedSequences) {
    if (item.sequence.sequenceKey) workbookSequenceKeys.add(keyOf(item.sequence.sequenceKey));
  }
  const seenAliases = new Set<string>();

  const sequenceRows = normalizedSequences.map(({ sequence, errors }) => {
    const normalizedKey = keyOf(sequence.sequenceKey);
    if (normalizedKey && seenSequences.has(normalizedKey)) errors.push("duplicate sequence_key in MRI Sequences");
    if (normalizedKey) seenSequences.add(normalizedKey);
    const existing = existingByKey.get(normalizedKey);
    const action: SequenceAction = errors.length || requiredErrors.length ? "invalid" : existing ? (sequenceChanged(sequence, existing) ? "update_sequence" : "unchanged") : "create_sequence";
    return { rowNumber: sequence.rowNumber, sequenceKey: sequence.sequenceKey, sequenceName: sequence.name, action, errors: [...requiredErrors, ...errors] };
  });

  const aliasRows = parsed.aliases.rows.map((row) => {
    const { alias, errors } = normalizeAlias(row);
    const normalizedSequenceKey = keyOf(alias.sequenceKey);
    const normalizedScanner = keyOf(alias.scannerDisplayName);
    const aliasKey = `${normalizedSequenceKey}|${normalizedScanner}`;
    if (aliasKey !== "|" && seenAliases.has(aliasKey)) errors.push("duplicate sequence_key + scanner_display_name in Scanner Aliases");
    if (aliasKey !== "|") seenAliases.add(aliasKey);
    if (alias.sequenceKey && !existingByKey.has(normalizedSequenceKey) && !workbookSequenceKeys.has(normalizedSequenceKey)) {
      errors.push("unknown sequence_key");
    }
    if (alias.scannerDisplayName && !scannersByName.has(normalizedScanner)) errors.push("unknown scanner_display_name");
    const existing = aliasesByKey.get(aliasKey);
    const action: AliasAction = errors.length || requiredErrors.length ? "invalid" : existing ? (aliasChanged(alias, existing) ? "update_alias" : "unchanged") : "create_alias";
    return { rowNumber: alias.rowNumber, sequenceKey: alias.sequenceKey, scannerDisplayName: alias.scannerDisplayName, vendorSequenceName: alias.vendorSequenceName, action, errors: [...requiredErrors, ...errors] };
  });

  return { sequenceRows, aliasRows, canConfirm: sequenceRows.every((row) => row.errors.length === 0) && aliasRows.every((row) => row.errors.length === 0) };
}

export async function confirmMriSequenceImport(input: ImportInput): Promise<MriSequenceImportSummary> {
  const preview = await previewMriSequenceImport(input);
  if (!preview.canConfirm) throw new HttpError(400, "MRI sequence import has validation errors.", preview);
  const parsed = await parseImport(input);
  const sequenceInputs = parsed.sequences.rows.map((row) => normalizeSequence(row).sequence);
  const aliasInputs = parsed.aliases.rows.map((row) => normalizeAlias(row).alias);
  const existingByKey = await existingSequences();
  const scannersByName = await scannerMap();
  const aliasesByKey = await existingAliases();
  const summary: MriSequenceImportSummary = { createdSequences: 0, updatedSequences: 0, unchangedSequences: 0, createdAliases: 0, updatedAliases: 0, unchangedAliases: 0 };
  const client = await pool.connect();
  try {
    await client.query("begin");
    const sequenceIds = new Map<string, number>();
    for (const sequence of sequenceInputs) {
      const normalizedKey = keyOf(sequence.sequenceKey);
      const existing = existingByKey.get(normalizedKey);
      if (!existing) {
        const inserted = await client.query(
          `
            insert into mri_sequence_presets (
              sequence_key, scanner_id, vendor, name, vendor_sequence_name, generic_family, weighting, default_plane,
              fat_suppression, acquisition_type, contrast_relation, default_coverage, default_b_values, default_dynamic_timing,
              estimated_scan_time_minutes, notes, is_active
            )
            values ($1, null, null, $2, null, $3, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            returning id
          `,
          [sequence.sequenceKey, sequence.name, sequence.weighting, sequence.defaultPlane, sequence.fatSuppression, sequence.acquisitionType, sequence.contrastRelation, sequence.defaultCoverage, sequence.defaultBValues, sequence.defaultDynamicTiming, sequence.estimatedScanTimeMinutes, sequence.notes, sequence.active ?? true]
        );
        sequenceIds.set(normalizedKey, Number(inserted.rows[0].id));
        summary.createdSequences += 1;
      } else {
        sequenceIds.set(normalizedKey, existing.id);
        if (sequenceChanged(sequence, existing)) {
          await client.query(
            `
              update mri_sequence_presets
              set sequence_key = coalesce(sequence_key, $2), name = $3, generic_family = $4, weighting = $4, default_plane = $5,
                  fat_suppression = $6, acquisition_type = $7, contrast_relation = $8, default_coverage = $9,
                  default_b_values = $10, default_dynamic_timing = $11, estimated_scan_time_minutes = $12,
                  notes = $13, is_active = coalesce($14, is_active)
              where id = $1
            `,
            [existing.id, sequence.sequenceKey, sequence.name, sequence.weighting, sequence.defaultPlane, sequence.fatSuppression, sequence.acquisitionType, sequence.contrastRelation, sequence.defaultCoverage, sequence.defaultBValues, sequence.defaultDynamicTiming, sequence.estimatedScanTimeMinutes, sequence.notes, sequence.active]
          );
          summary.updatedSequences += 1;
        } else {
          summary.unchangedSequences += 1;
        }
      }
    }
    for (const alias of aliasInputs) {
      const normalizedKey = keyOf(alias.sequenceKey);
      const scanner = scannersByName.get(keyOf(alias.scannerDisplayName))!;
      const aliasKey = `${normalizedKey}|${keyOf(alias.scannerDisplayName)}`;
      const existing = aliasesByKey.get(aliasKey);
      const sequenceId = sequenceIds.get(normalizedKey) ?? existingByKey.get(normalizedKey)?.id;
      if (!sequenceId) throw new HttpError(400, `Unknown sequence_key '${alias.sequenceKey}'.`);
      if (!existing) {
        await client.query(
          `
            insert into mri_sequence_scanner_aliases (mri_sequence_preset_id, scanner_id, vendor_sequence_name, notes)
            values ($1, $2, $3, $4)
          `,
          [sequenceId, scanner.id, alias.vendorSequenceName, alias.notes]
        );
        summary.createdAliases += 1;
      } else if (aliasChanged(alias, existing)) {
        await client.query(
          `
            update mri_sequence_scanner_aliases
            set vendor_sequence_name = $2, notes = $3
            where id = $1
          `,
          [existing.id, alias.vendorSequenceName, alias.notes]
        );
        summary.updatedAliases += 1;
      } else {
        summary.unchangedAliases += 1;
      }
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  return summary;
}

export async function mriSequenceImportTemplateXlsx(): Promise<{ buffer: Buffer; filename: string }> {
  return {
    buffer: await buildWorkbookBuffer([
      {
        name: SEQUENCE_SHEET,
        headers: SEQUENCE_COLUMNS,
        rows: [
          { sequence_key: "example-axial-t2", sequence_name: "Example axial T2", plane: "Axial", weighting: "T2", fat_suppression: "None", acquisition_type: "2D", contrast_relation: "Non-contrast", default_coverage: "Example only", default_b_values: "", default_dynamic_timing: "", estimated_scan_time_minutes: 4, notes: "Replace or delete this example", active: "true" },
          { sequence_key: "example-dwi", sequence_name: "Example DWI", plane: "Axial", weighting: "DWI / ADC", fat_suppression: "Fat saturated", acquisition_type: "2D", contrast_relation: "Non-contrast", default_coverage: "Example only", default_b_values: "0,800", default_dynamic_timing: "", estimated_scan_time_minutes: 5, notes: "Replace or delete this example", active: "true" },
        ],
      },
      {
        name: ALIAS_SHEET,
        headers: ALIAS_COLUMNS,
        rows: [
          { sequence_key: "example-axial-t2", scanner_display_name: "Example MRI scanner - replace with an existing scanner", vendor_sequence_name: "T2_TSE_AX", alias_notes: "Example only" },
          { sequence_key: "example-dwi", scanner_display_name: "Example MRI scanner - replace with an existing scanner", vendor_sequence_name: "ep2d_diff", alias_notes: "Example only" },
        ],
      },
      {
        name: INSTRUCTIONS_SHEET,
        headers: ["item", "instruction"],
        rows: [
          { item: "sequence_key", instruction: "Stable external key. Existing RISpro rows update by this key; new rows are created." },
          { item: "scanner_display_name", instruction: "Must exactly match an existing MRI scanner display name. Import does not create scanners." },
        ],
      },
    ]),
    filename: "rispro-mri-sequence-import-template.xlsx",
  };
}

export async function exportMriSequencePresetsXlsx(): Promise<{ buffer: Buffer; filename: string }> {
  const sequences = await pool.query(`
    select id, sequence_key, name, default_plane, weighting, fat_suppression, acquisition_type, contrast_relation,
           default_coverage, default_b_values, default_dynamic_timing, estimated_scan_time_minutes, notes, is_active
    from mri_sequence_presets
    order by is_active desc, name asc, id asc
  `);
  const aliases = await pool.query(`
    select coalesce(preset.sequence_key, '') as sequence_key, preset.id as sequence_id, preset.name as sequence_name,
           scanner.name as scanner_display_name, alias.vendor_sequence_name, alias.notes as alias_notes
    from mri_sequence_scanner_aliases alias
    join mri_sequence_presets preset on preset.id = alias.mri_sequence_preset_id
    join equipment scanner on scanner.id = alias.scanner_id
    order by preset.name asc, scanner.name asc
  `);
  const keyById = new Map<number, string>();
  const sequenceRows = sequences.rows.map((row: Record<string, unknown>) => {
    const sequenceKey = text(row.sequence_key) || suggestedSequenceKey(String(row.name), Number(row.id));
    keyById.set(Number(row.id), sequenceKey);
    return {
      sequence_key: sequenceKey,
      sequence_name: row.name,
      plane: row.default_plane,
      weighting: row.weighting,
      fat_suppression: row.fat_suppression,
      acquisition_type: row.acquisition_type,
      contrast_relation: row.contrast_relation,
      default_coverage: row.default_coverage,
      default_b_values: row.default_b_values,
      default_dynamic_timing: row.default_dynamic_timing,
      estimated_scan_time_minutes: row.estimated_scan_time_minutes,
      notes: row.notes,
      active: row.is_active,
    };
  });
  const aliasRows = aliases.rows.map((row: Record<string, unknown>) => ({
    sequence_key: text(row.sequence_key) || keyById.get(Number(row.sequence_id)) || suggestedSequenceKey(String(row.sequence_name), Number(row.sequence_id)),
    scanner_display_name: row.scanner_display_name,
    vendor_sequence_name: row.vendor_sequence_name,
    alias_notes: row.alias_notes,
  }));
  return {
    buffer: await buildWorkbookBuffer([
      { name: SEQUENCE_SHEET, headers: SEQUENCE_COLUMNS, rows: sequenceRows },
      { name: ALIAS_SHEET, headers: ALIAS_COLUMNS, rows: aliasRows },
    ]),
    filename: "rispro-mri-sequences.xlsx",
  };
}
