import { pool } from "../../db/pool.js";
import { buildWorkbookBuffer, parseWorksheet, readWorkbookFromBase64, type ParsedWorksheet } from "../../services/workbook-service.js";
import { HttpError } from "../../utils/http-error.js";

const SHEETS = ["Protocols", "CT Phases", "CT Techniques", "MRI Sequences"] as const;
const INSTRUCTIONS_SHEET = "Instructions";
const REQUIRED: Record<(typeof SHEETS)[number], string[]> = {
  "Protocols": ["protocol_key", "protocol_name", "modality"],
  "CT Phases": ["protocol_key", "order", "phase_name", "timing_type"],
  "CT Techniques": ["protocol_key", "scanner"],
  "MRI Sequences": ["protocol_key", "order", "sequence_key"],
};
const PROTOCOL_COLUMNS = [...REQUIRED.Protocols, "anatomy_region", "category", "indication", "contrast_policy", "oral_contrast_policy", "bowel_preparation", "preparation_notes", "protocol_notes"];
const CT_PHASE_COLUMNS = [...REQUIRED["CT Phases"], "delay_seconds", "bolus_tracking_site", "trigger_hu", "post_trigger_delay_seconds", "coverage", "reconstruction", "instructions", "required"];
const CT_TECHNIQUE_COLUMNS = [...REQUIRED["CT Techniques"], "kv_mode", "kvp", "tube_current_mode", "fixed_ma", "reference_mas", "exposure_control", "noise_index", "min_ma", "max_ma", "reconstruction_method", "reconstruction_strength", "reconstruction_image_definition", "slice_thickness_mm", "reconstruction_interval_mm", "kernel"];
const MRI_SEQUENCE_COLUMNS = [...REQUIRED["MRI Sequences"], "scanner", "plane", "coverage", "b_values", "timing", "notes", "required"];
const CATEGORIES = new Set(["General", "Oncology", "Non-oncology"]);
const CONTRAST_POLICIES = new Set(["Non-contrast", "With IV contrast", "Without and with IV contrast", "Dynamic contrast", "Conditional / radiologist decision"]);
const TIMING_TYPES = new Set(["NON_CONTRAST", "FIXED_DELAY_INJECTION_START", "FIXED_DELAY_INJECTION_END", "BOLUS_TRACKING", "MANUAL"]);
const KV_MODES = new Set(["AUTO", "FIXED"]);
const TUBE_CURRENT_MODES = new Set(["AUTOMATIC", "FIXED_MA", "REFERENCE_MAS"]);

type ImportInput = { fileContentBase64: string; fileName?: string | null };
type ProtocolModality = "CT" | "MRI";
type Client = { query: typeof pool.query };
type RowAction = "create" | "invalid";

export interface ProtocolImportInspect {
  format: "xlsx";
  sheets: Array<{ sheetName: string; columns: string[]; requiredColumns: string[]; missingRequiredColumns: string[]; rowCount: number }>;
  unknownSheets: string[];
}

export interface ProtocolImportPreviewRow {
  rowNumber: number;
  protocolKey: string;
  action: RowAction;
  errors: string[];
}

export interface ProtocolImportPreview {
  protocolRows: Array<Omit<ProtocolImportPreviewRow, "action"> & { protocolName: string; modality: string; action: "create_protocol" | "invalid" | "conflict_existing_protocol" }>;
  ctPhaseRows: ProtocolImportPreviewRow[];
  ctTechniqueRows: ProtocolImportPreviewRow[];
  mriSequenceRows: ProtocolImportPreviewRow[];
  summary: { protocols: number; ctPhases: number; ctTechniques: number; mriSequences: number; errors: number };
  canConfirm: boolean;
}

export interface ProtocolImportSummary {
  createdProtocols: number;
  createdCtProtocols: number;
  createdMriProtocols: number;
  createdCtPhases: number;
  createdCtTechniques: number;
  createdMriSequenceRows: number;
}

interface ParsedImport { sheetNames: string[]; worksheets: Record<(typeof SHEETS)[number], ParsedWorksheet>; }
interface Lookup { anatomy: Map<string, number[]>; scanners: Map<string, Array<{ id: number; modality: string }>>; sequences: Map<string, number[]>; existing: Map<string, number[]>; }
interface ProtocolInput { rowNumber: number; protocolKey: string; name: string; modality: ProtocolModality | null; anatomyRegion: string | null; category: string | null; indication: string | null; contrastPolicy: string | null; oralContrastPolicy: string | null; bowelPreparation: string | null; preparationNotes: string | null; protocolNotes: string | null; }
interface CtPhaseInput { rowNumber: number; protocolKey: string; order: number | null; phaseName: string; timingType: string; delaySeconds: number | null; bolusTrackingSite: string | null; triggerHu: number | null; postTriggerDelaySeconds: number | null; coverage: string | null; reconstruction: string | null; instructions: string | null; required: boolean | null; }
interface CtTechniqueInput { rowNumber: number; protocolKey: string; scanner: string; kvMode: string | null; kvp: number | null; tubeCurrentMode: string | null; fixedMa: number | null; referenceMas: number | null; exposureControl: string | null; noiseIndex: number | null; minMa: number | null; maxMa: number | null; reconstructionMethod: string | null; reconstructionStrength: string | null; reconstructionImageDefinition: string | null; sliceThicknessMm: number | null; reconstructionIntervalMm: number | null; kernel: string | null; }
interface MriSequenceInput { rowNumber: number; protocolKey: string; order: number | null; sequenceKey: string; scanner: string | null; plane: string | null; coverage: string | null; bValues: string | null; timing: string | null; notes: string | null; required: boolean | null; }

function text(value: unknown): string { return String(value ?? "").trim(); }
function nullable(value: unknown): string | null { const valueText = text(value); return valueText || null; }
function key(value: string): string { return value.trim().toLocaleLowerCase(); }
function emptySheet(): ParsedWorksheet { return { headers: [], rows: [] }; }
function missing(sheet: ParsedWorksheet, columns: string[]): string[] { return columns.filter((column) => !sheet.headers.includes(column)); }
function rowValues(sheet: ParsedWorksheet): ParsedWorksheet { return { headers: sheet.headers.map(text), rows: sheet.rows.map((row) => ({ rowNumber: row.rowNumber, values: Object.fromEntries(Object.entries(row.values).map(([name, value]) => [text(name), text(value)])) })) }; }

async function parseImport(input: ImportInput): Promise<ParsedImport> {
  if (input.fileName && !input.fileName.toLowerCase().endsWith(".xlsx")) throw new HttpError(400, "Protocol import accepts XLSX files only.");
  const { XLSX, workbook, sheetNames } = await readWorkbookFromBase64(input.fileContentBase64);
  const worksheets = Object.fromEntries(SHEETS.map((name) => [name, workbook.Sheets[name] ? rowValues(parseWorksheet(XLSX, workbook.Sheets[name], name)) : emptySheet()])) as ParsedImport["worksheets"];
  return { sheetNames, worksheets };
}

function integer(value: unknown, field: string, errors: string[], allowZero = false): number | null {
  const raw = text(value); if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || (allowZero ? parsed < 0 : parsed <= 0)) { errors.push(`${field} must be ${allowZero ? "a non-negative integer" : "a positive integer"}`); return null; }
  return parsed;
}
function number(value: unknown, field: string, errors: string[], allowZero = false): number | null {
  const raw = text(value); if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || (allowZero ? parsed < 0 : parsed <= 0)) { errors.push(`${field} must be ${allowZero ? "a non-negative number" : "a positive number"}`); return null; }
  return parsed;
}
function bool(value: unknown, field: string, errors: string[]): boolean | null {
  const raw = text(value).toLowerCase(); if (!raw) return null;
  if (["true", "yes", "1"].includes(raw)) return true;
  if (["false", "no", "0"].includes(raw)) return false;
  errors.push(`${field} must be true/false/yes/no/1/0`); return null;
}
function requiredSheetErrors(parsed: ParsedImport): string[] { return SHEETS.flatMap((name) => missing(parsed.worksheets[name], REQUIRED[name]).map((column) => `${name} missing ${column}`)); }

function protocols(sheet: ParsedWorksheet): Array<{ row: ProtocolInput; errors: string[] }> {
  return sheet.rows.map((source) => {
    const values = source.values; const errors: string[] = []; const modalityRaw = text(values.modality).toUpperCase();
    const row: ProtocolInput = { rowNumber: source.rowNumber, protocolKey: text(values.protocol_key), name: text(values.protocol_name), modality: modalityRaw === "CT" || modalityRaw === "MRI" ? modalityRaw : null, anatomyRegion: nullable(values.anatomy_region), category: nullable(values.category), indication: nullable(values.indication), contrastPolicy: nullable(values.contrast_policy), oralContrastPolicy: nullable(values.oral_contrast_policy), bowelPreparation: nullable(values.bowel_preparation), preparationNotes: nullable(values.preparation_notes), protocolNotes: nullable(values.protocol_notes) };
    if (!row.protocolKey) errors.push("protocol_key is required"); if (!row.name) errors.push("protocol_name is required"); if (!row.modality) errors.push("modality must be CT or MRI");
    if (row.category && !CATEGORIES.has(row.category)) errors.push("category is invalid"); if (row.contrastPolicy && !CONTRAST_POLICIES.has(row.contrastPolicy)) errors.push("contrast_policy is invalid");
    return { row, errors };
  });
}
function ctPhases(sheet: ParsedWorksheet): Array<{ row: CtPhaseInput; errors: string[] }> {
  return sheet.rows.map((source) => { const values = source.values; const errors: string[] = [];
    const row: CtPhaseInput = { rowNumber: source.rowNumber, protocolKey: text(values.protocol_key), order: integer(values.order, "order", errors), phaseName: text(values.phase_name), timingType: text(values.timing_type).toUpperCase(), delaySeconds: integer(values.delay_seconds, "delay_seconds", errors, true), bolusTrackingSite: nullable(values.bolus_tracking_site), triggerHu: integer(values.trigger_hu, "trigger_hu", errors, true), postTriggerDelaySeconds: integer(values.post_trigger_delay_seconds, "post_trigger_delay_seconds", errors, true), coverage: nullable(values.coverage), reconstruction: nullable(values.reconstruction), instructions: nullable(values.instructions), required: bool(values.required, "required", errors) };
    if (!row.protocolKey) errors.push("protocol_key is required"); if (!row.order) errors.push("order is required"); if (!row.phaseName) errors.push("phase_name is required"); if (!TIMING_TYPES.has(row.timingType)) errors.push("timing_type is invalid"); return { row, errors };
  });
}
function ctTechniques(sheet: ParsedWorksheet): Array<{ row: CtTechniqueInput; errors: string[] }> {
  return sheet.rows.map((source) => { const values = source.values; const errors: string[] = [];
    const row: CtTechniqueInput = { rowNumber: source.rowNumber, protocolKey: text(values.protocol_key), scanner: text(values.scanner), kvMode: nullable(values.kv_mode)?.toUpperCase() ?? null, kvp: integer(values.kvp, "kvp", errors), tubeCurrentMode: nullable(values.tube_current_mode)?.toUpperCase() ?? null, fixedMa: integer(values.fixed_ma, "fixed_ma", errors, true), referenceMas: number(values.reference_mas, "reference_mas", errors), exposureControl: nullable(values.exposure_control), noiseIndex: number(values.noise_index, "noise_index", errors), minMa: integer(values.min_ma, "min_ma", errors, true), maxMa: integer(values.max_ma, "max_ma", errors, true), reconstructionMethod: nullable(values.reconstruction_method), reconstructionStrength: nullable(values.reconstruction_strength), reconstructionImageDefinition: nullable(values.reconstruction_image_definition), sliceThicknessMm: number(values.slice_thickness_mm, "slice_thickness_mm", errors), reconstructionIntervalMm: number(values.reconstruction_interval_mm, "reconstruction_interval_mm", errors), kernel: nullable(values.kernel) };
    if (!row.protocolKey) errors.push("protocol_key is required"); if (!row.scanner) errors.push("scanner is required"); if (row.kvMode && !KV_MODES.has(row.kvMode)) errors.push("kv_mode is invalid"); if (row.tubeCurrentMode && !TUBE_CURRENT_MODES.has(row.tubeCurrentMode)) errors.push("tube_current_mode is invalid");
    if (row.kvMode === "FIXED" && !row.kvp) errors.push("kvp is required when kv_mode is FIXED"); if (row.tubeCurrentMode === "FIXED_MA" && !row.fixedMa) errors.push("fixed_ma is required when tube_current_mode is FIXED_MA"); if (row.tubeCurrentMode === "REFERENCE_MAS" && !row.referenceMas) errors.push("reference_mas is required when tube_current_mode is REFERENCE_MAS"); if (row.minMa != null && row.maxMa != null && row.minMa > row.maxMa) errors.push("min_ma cannot exceed max_ma");
    return { row, errors };
  });
}
function mriSequences(sheet: ParsedWorksheet): Array<{ row: MriSequenceInput; errors: string[] }> {
  return sheet.rows.map((source) => { const values = source.values; const errors: string[] = [];
    const row: MriSequenceInput = { rowNumber: source.rowNumber, protocolKey: text(values.protocol_key), order: integer(values.order, "order", errors), sequenceKey: text(values.sequence_key), scanner: nullable(values.scanner), plane: nullable(values.plane), coverage: nullable(values.coverage), bValues: nullable(values.b_values), timing: nullable(values.timing), notes: nullable(values.notes), required: bool(values.required, "required", errors) };
    if (!row.protocolKey) errors.push("protocol_key is required"); if (!row.order) errors.push("order is required"); if (!row.sequenceKey) errors.push("sequence_key is required"); return { row, errors };
  });
}

async function lookup(): Promise<Lookup> {
  const [anatomy, scanners, sequences, existing] = await Promise.all([
    pool.query("select id, name from protocol_anatomy_regions where is_active = true"),
    pool.query("select id, name, modality from equipment where is_active = true and equipment_type in ('CT', 'MRI')"),
    pool.query("select id, sequence_key from mri_sequence_presets where sequence_key is not null and is_active = true"),
    pool.query("select id, modality, name from protocols"),
  ]);
  const names = (rows: Array<Record<string, unknown>>, column: string): Map<string, number[]> => {
    const result = new Map<string, number[]>();
    for (const row of rows) { const normalized = key(String(row[column])); result.set(normalized, [...(result.get(normalized) ?? []), Number(row.id)]); }
    return result;
  };
  const scannerMap = new Map<string, Array<{ id: number; modality: string }>>();
  for (const row of scanners.rows as Array<Record<string, unknown>>) { const normalized = key(String(row.name)); scannerMap.set(normalized, [...(scannerMap.get(normalized) ?? []), { id: Number(row.id), modality: String(row.modality).toUpperCase() }]); }
  const existingMap = new Map<string, number[]>();
  for (const row of existing.rows as Array<Record<string, unknown>>) { const normalized = `${String(row.modality).toUpperCase()}|${key(String(row.name))}`; existingMap.set(normalized, [...(existingMap.get(normalized) ?? []), Number(row.id)]); }
  return { anatomy: names(anatomy.rows as Array<Record<string, unknown>>, "name"), scanners: scannerMap, sequences: names(sequences.rows as Array<Record<string, unknown>>, "sequence_key"), existing: existingMap };
}

function addLookupError(errors: string[], ids: number[] | undefined, label: string, value: string): number | null { if (!ids?.length) { errors.push(`${label} \"${value}\" was not found`); return null; } if (ids.length !== 1) { errors.push(`${label} \"${value}\" is ambiguous`); return null; } return ids[0]; }

async function validate(input: ImportInput): Promise<{ parsed: ParsedImport; protocolInputs: Array<{ row: ProtocolInput; errors: string[] }>; ctPhaseInputs: Array<{ row: CtPhaseInput; errors: string[] }>; ctTechniqueInputs: Array<{ row: CtTechniqueInput; errors: string[] }>; mriSequenceInputs: Array<{ row: MriSequenceInput; errors: string[] }>; lookup: Lookup }> {
  const parsed = await parseImport(input); const requiredErrors = requiredSheetErrors(parsed); const [protocolInputs, ctPhaseInputs, ctTechniqueInputs, mriSequenceInputs] = [protocols(parsed.worksheets.Protocols), ctPhases(parsed.worksheets["CT Phases"]), ctTechniques(parsed.worksheets["CT Techniques"]), mriSequences(parsed.worksheets["MRI Sequences"])];
  const data = await lookup(); const protocolByKey = new Map<string, ProtocolInput>(); const seenProtocolKeys = new Set<string>();
  for (const item of protocolInputs) { item.errors.push(...requiredErrors); const normalized = key(item.row.protocolKey); if (normalized && seenProtocolKeys.has(normalized)) item.errors.push("duplicate protocol_key in Protocols"); if (normalized) { seenProtocolKeys.add(normalized); protocolByKey.set(normalized, item.row); } if (item.row.anatomyRegion) addLookupError(item.errors, data.anatomy.get(key(item.row.anatomyRegion)), "anatomy region", item.row.anatomyRegion); if (item.row.modality && item.row.name) { const matching = data.existing.get(`${item.row.modality}|${key(item.row.name)}`) ?? []; if (matching.length) item.errors.push(matching.length === 1 ? `A ${item.row.modality} protocol named \"${item.row.name}\" already exists. Existing protocols are not overwritten by bulk import.` : `Multiple existing ${item.row.modality} protocols named \"${item.row.name}\" exist.`); } }
  const validateChild = <T extends { protocolKey: string; rowNumber: number }>(items: Array<{ row: T; errors: string[] }>, kind: "CT phase" | "CT technique" | "MRI sequence") => { const orders = new Set<string>(); for (const item of items) { item.errors.push(...requiredErrors); const protocol = protocolByKey.get(key(item.row.protocolKey)); if (!protocol) item.errors.push("protocol_key does not reference a Protocols row"); else if ((kind === "MRI sequence" ? "MRI" : "CT") !== protocol.modality) item.errors.push(`${kind} rows can only be attached to ${(kind === "MRI sequence" ? "MRI" : "CT")} protocols`); const candidate = item.row as T & { order?: number | null }; if (candidate.order) { const orderKey = `${key(item.row.protocolKey)}|${candidate.order}`; if (orders.has(orderKey)) item.errors.push(`duplicate order within protocol_key \"${item.row.protocolKey}\"`); orders.add(orderKey); } } };
  validateChild(ctPhaseInputs, "CT phase"); validateChild(ctTechniqueInputs, "CT technique"); validateChild(mriSequenceInputs, "MRI sequence");
  const seenTechniques = new Set<string>(); for (const item of ctTechniqueInputs) { if (item.row.scanner) { const scanner = data.scanners.get(key(item.row.scanner)); const id = addLookupError(item.errors, scanner?.map((row) => row.id), "scanner", item.row.scanner); if (id != null && scanner?.[0]?.modality !== "CT") item.errors.push(`scanner \"${item.row.scanner}\" must be CT`); const techniqueKey = `${key(item.row.protocolKey)}|${key(item.row.scanner)}`; if (seenTechniques.has(techniqueKey)) item.errors.push(`duplicate scanner technique for protocol_key \"${item.row.protocolKey}\"`); seenTechniques.add(techniqueKey); } }
  for (const item of mriSequenceInputs) { if (item.row.sequenceKey) addLookupError(item.errors, data.sequences.get(key(item.row.sequenceKey)), "sequence_key", item.row.sequenceKey); if (item.row.scanner) { const scanner = data.scanners.get(key(item.row.scanner)); const id = addLookupError(item.errors, scanner?.map((row) => row.id), "scanner", item.row.scanner); if (id != null && scanner?.[0]?.modality !== "MRI") item.errors.push(`scanner \"${item.row.scanner}\" must be MRI`); } }
  return { parsed, protocolInputs, ctPhaseInputs, ctTechniqueInputs, mriSequenceInputs, lookup: data };
}

export async function inspectProtocolImport(input: ImportInput): Promise<ProtocolImportInspect> {
  const parsed = await parseImport(input); return { format: "xlsx", sheets: SHEETS.map((sheetName) => ({ sheetName, columns: parsed.worksheets[sheetName].headers, requiredColumns: REQUIRED[sheetName], missingRequiredColumns: missing(parsed.worksheets[sheetName], REQUIRED[sheetName]), rowCount: parsed.worksheets[sheetName].rows.length })), unknownSheets: parsed.sheetNames.filter((name) => !SHEETS.includes(name as (typeof SHEETS)[number]) && name !== INSTRUCTIONS_SHEET) };
}

export async function previewProtocolImport(input: ImportInput): Promise<ProtocolImportPreview> {
  const result = await validate(input); const protocolRows = result.protocolInputs.map(({ row, errors }) => ({ rowNumber: row.rowNumber, protocolKey: row.protocolKey, protocolName: row.name, modality: row.modality ?? "", action: (errors.length ? (errors.some((error) => /already exists|Multiple existing/.test(error)) ? "conflict_existing_protocol" : "invalid") : "create_protocol") as "create_protocol" | "invalid" | "conflict_existing_protocol", errors }));
  const detail = <T extends { rowNumber: number; protocolKey: string }>(items: Array<{ row: T; errors: string[] }>) => items.map(({ row, errors }) => ({ rowNumber: row.rowNumber, protocolKey: row.protocolKey, action: (errors.length ? "invalid" : "create") as RowAction, errors }));
  const ctPhaseRows = detail(result.ctPhaseInputs); const ctTechniqueRows = detail(result.ctTechniqueInputs); const mriSequenceRows = detail(result.mriSequenceInputs); const globalErrors = requiredSheetErrors(result.parsed); const errors = [...protocolRows, ...ctPhaseRows, ...ctTechniqueRows, ...mriSequenceRows].reduce((total, row) => total + row.errors.length, 0) + (protocolRows.length || ctPhaseRows.length || ctTechniqueRows.length || mriSequenceRows.length ? 0 : globalErrors.length);
  return { protocolRows, ctPhaseRows, ctTechniqueRows, mriSequenceRows, summary: { protocols: protocolRows.length, ctPhases: ctPhaseRows.length, ctTechniques: ctTechniqueRows.length, mriSequences: mriSequenceRows.length, errors }, canConfirm: errors === 0 && globalErrors.length === 0 };
}

export async function confirmProtocolImport(input: ImportInput, actorUserId: number | null): Promise<ProtocolImportSummary> {
  const preview = await previewProtocolImport(input); if (!preview.canConfirm) throw new HttpError(400, "Protocol import has validation errors.", preview);
  const validated = await validate(input); const client = await pool.connect(); const summary: ProtocolImportSummary = { createdProtocols: 0, createdCtProtocols: 0, createdMriProtocols: 0, createdCtPhases: 0, createdCtTechniques: 0, createdMriSequenceRows: 0 };
  try {
    await client.query("begin"); const versions = new Map<string, number>();
    for (const { row } of validated.protocolInputs) {
      const anatomyId = row.anatomyRegion ? validated.lookup.anatomy.get(key(row.anatomyRegion))![0] : null;
      const inserted = await client.query("insert into protocols (name, modality, anatomy_region_id, category, indication, contrast_policy, oral_contrast_policy, bowel_preparation, preparation_notes, is_active) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,true) returning id", [row.name, row.modality, anatomyId, row.category, row.indication, row.contrastPolicy, row.oralContrastPolicy, row.bowelPreparation, row.preparationNotes]);
      const version = await client.query("insert into protocol_versions (protocol_id, version_number, status, change_summary, protocol_notes, created_by) values ($1,'1.0','DRAFT','Initial protocol version',$2,$3) returning id", [Number(inserted.rows[0].id), row.protocolNotes, actorUserId]);
      versions.set(key(row.protocolKey), Number(version.rows[0].id)); summary.createdProtocols += 1; if (row.modality === "CT") summary.createdCtProtocols += 1; else summary.createdMriProtocols += 1;
    }
    for (const { row } of validated.ctPhaseInputs) { await client.query("insert into protocol_ct_phases (protocol_version_id, order_index, ct_phase_preset_id, custom_phase_name, timing_override, timing_type, delay_seconds, bolus_tracking_site, trigger_hu, post_trigger_delay_seconds, coverage_override, reconstruction_override, instructions_override, is_required) values ($1,$2,null,$3,null,$4,$5,$6,$7,$8,$9,$10,$11,$12)", [versions.get(key(row.protocolKey)), row.order, row.phaseName, row.timingType, row.delaySeconds, row.bolusTrackingSite, row.triggerHu, row.postTriggerDelaySeconds, row.coverage, row.reconstruction, row.instructions, row.required ?? true]); summary.createdCtPhases += 1; }
    for (const { row } of validated.ctTechniqueInputs) { const scannerId = validated.lookup.scanners.get(key(row.scanner))![0].id; await client.query("insert into protocol_ct_techniques (protocol_version_id, scanner_id, kv_mode, kvp, tube_current_mode, fixed_ma, reference_mas, exposure_control, noise_index, min_ma, max_ma, reconstruction_method, reconstruction_strength, reconstruction_image_definition, slice_thickness_mm, reconstruction_interval_mm, kernel) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)", [versions.get(key(row.protocolKey)), scannerId, row.kvMode, row.kvp, row.tubeCurrentMode, row.fixedMa, row.referenceMas, row.exposureControl, row.noiseIndex, row.minMa, row.maxMa, row.reconstructionMethod, row.reconstructionStrength, row.reconstructionImageDefinition, row.sliceThicknessMm, row.reconstructionIntervalMm, row.kernel]); summary.createdCtTechniques += 1; }
    for (const { row } of validated.mriSequenceInputs) { const scannerId = row.scanner ? validated.lookup.scanners.get(key(row.scanner))![0].id : null; const presetId = validated.lookup.sequences.get(key(row.sequenceKey))![0]; await client.query("insert into protocol_mri_sequences (protocol_version_id, scanner_id, order_index, mri_sequence_preset_id, plane_override, coverage_override, b_values_override, timing_override, notes_override, is_required) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [versions.get(key(row.protocolKey)), scannerId, row.order, presetId, row.plane, row.coverage, row.bValues, row.timing, row.notes, row.required ?? true]); summary.createdMriSequenceRows += 1; }
    await client.query("commit"); return summary;
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
}

export async function protocolImportTemplateXlsx(): Promise<{ buffer: Buffer; filename: string }> {
  const lookups = await lookup(); const scannerRows = [...lookups.scanners.entries()].flatMap(([name, rows]) => rows.map((row) => ({ item: row.modality === "CT" ? "Active CT scanner" : "Active MRI scanner", value: name, detail: "Use this scanner name exactly; database IDs are never entered." })));
  const anatomyRows = [...lookups.anatomy.keys()].map((name) => ({ item: "Active anatomy region", value: name, detail: "Optional Protocols.anatomy_region lookup." }));
  const sequenceRows = [...lookups.sequences.entries()].map(([sequenceKey]) => ({ item: "Active MRI sequence_key", value: sequenceKey, detail: "Use this key in MRI Sequences; presets are not created by this import." }));
  return { buffer: await buildWorkbookBuffer([
    { name: "Protocols", headers: PROTOCOL_COLUMNS, rows: [{ protocol_key: "ct_liver_triphasic", protocol_name: "Example CT Liver Triphasic", modality: "CT", anatomy_region: "Replace with an active anatomy region", category: "General", contrast_policy: "With IV contrast", protocol_notes: "Example only - replace or remove" }, { protocol_key: "mri_brain_routine", protocol_name: "Example MRI Brain Routine", modality: "MRI", anatomy_region: "Replace with an active anatomy region", category: "General", contrast_policy: "Non-contrast", protocol_notes: "Example only - replace or remove" }] },
    { name: "CT Phases", headers: CT_PHASE_COLUMNS, rows: [{ protocol_key: "ct_liver_triphasic", order: 1, phase_name: "Non-contrast", timing_type: "NON_CONTRAST", coverage: "Liver" }, { protocol_key: "ct_liver_triphasic", order: 2, phase_name: "Portal venous", timing_type: "FIXED_DELAY_INJECTION_START", delay_seconds: 70, coverage: "Liver" }] },
    { name: "CT Techniques", headers: CT_TECHNIQUE_COLUMNS, rows: [{ protocol_key: "ct_liver_triphasic", scanner: "Replace with an active CT scanner", kv_mode: "AUTO", tube_current_mode: "AUTOMATIC", slice_thickness_mm: 1, reconstruction_interval_mm: 1, kernel: "Standard" }] },
    { name: "MRI Sequences", headers: MRI_SEQUENCE_COLUMNS, rows: [{ protocol_key: "mri_brain_routine", order: 1, sequence_key: "Replace with an existing MRI sequence_key", plane: "Axial", coverage: "Brain" }] },
    { name: INSTRUCTIONS_SHEET, headers: ["item", "value", "detail"], rows: [
      { item: "Purpose", value: "Full CT/MRI protocol import", detail: "Imports protocol metadata and associated CT phases, CT scanner techniques, or MRI preset composition." },
      { item: "protocol_key", value: "Workbook-local join key", detail: "Required, unique case-insensitively, trimmed. It is never a database ID." },
      { item: "Draft safety", value: "DRAFT only", detail: "Imported protocols require radiologist review and explicit activation before clinical use." },
      { item: "Existing protocols", value: "Never overwritten", detail: "A same-modality, same-name match prevents confirmation." },
      { item: "CT / MRI sheets", value: "Modality-specific", detail: "CT Phases and CT Techniques only reference CT protocols; MRI Sequences only references MRI protocols. Empty detail sheets are valid." },
      { item: "Protocols required", value: REQUIRED.Protocols.join(", "), detail: `Optional: ${PROTOCOL_COLUMNS.slice(3).join(", ")}. modality: CT or MRI. category: General, Oncology, Non-oncology.` },
      { item: "CT Phases required", value: REQUIRED["CT Phases"].join(", "), detail: `Optional: ${CT_PHASE_COLUMNS.slice(4).join(", ")}. timing_type: ${[...TIMING_TYPES].join(", ")}.` },
      { item: "CT Techniques required", value: REQUIRED["CT Techniques"].join(", "), detail: `Optional: ${CT_TECHNIQUE_COLUMNS.slice(2).join(", ")}. kv_mode: AUTO/FIXED; tube_current_mode: AUTOMATIC/FIXED_MA/REFERENCE_MAS.` },
      { item: "MRI Sequences required", value: REQUIRED["MRI Sequences"].join(", "), detail: `Optional: ${MRI_SEQUENCE_COLUMNS.slice(3).join(", ")}. sequence_key must already exist.` },
      ...anatomyRows, ...scannerRows, ...sequenceRows,
    ] },
  ]), filename: "rispro-protocol-import-template.xlsx" };
}
