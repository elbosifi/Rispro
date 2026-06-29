import { pool } from "../../db/pool.js";
import { HttpError } from "../../utils/http-error.js";

export interface ProtocolAnatomyRegionRow {
  id: number;
  name: string;
  bodySystem: string | null;
  modalityScope: "CT" | "MRI" | "BOTH";
  defaultCoverageNote: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ImagingScannerRow {
  id: number;
  name: string;
  modality: "CT" | "MRI";
  vendor: string | null;
  model: string | null;
  fieldStrength: string | null;
  location: string | null;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CtPhasePresetRow {
  id: number;
  name: string;
  contrastStatus: "NON_CONTRAST" | "POST_CONTRAST" | "DELAYED" | "OTHER";
  timingType: "NONE" | "FIXED_DELAY" | "BOLUS_TRACKING" | "MANUAL";
  delaySeconds: number | null;
  bolusTrackingSite: string | null;
  triggerHu: number | null;
  defaultCoverage: string | null;
  reconstructionNotes: string | null;
  instructions: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MriSequencePresetRow {
  id: number;
  scannerId: number | null;
  scannerName: string | null;
  vendor: string | null;
  name: string;
  vendorSequenceName: string | null;
  genericFamily: string | null;
  weighting: string | null;
  defaultPlane: string | null;
  contrastRelation: string | null;
  defaultCoverage: string | null;
  defaultBValues: string | null;
  defaultDynamicTiming: string | null;
  estimatedScanTimeMinutes: number | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProtocolLibraryProtocolRow {
  id: number;
  name: string;
  modality: "CT" | "MRI";
  anatomyRegionId: number | null;
  anatomyRegionName: string | null;
  category: string | null;
  indication: string | null;
  contrastPolicy: string | null;
  activeVersionId: number | null;
  activeVersionNumber: string | null;
  activeVersionStatus: ProtocolVersionStatus | null;
  latestDraftVersionId: number | null;
  latestDraftVersionNumber: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

type RawRecord = Record<string, unknown>;
type DbClient = { query: typeof pool.query };
export type ProtocolVersionStatus = "DRAFT" | "ACTIVE" | "RETIRED";

export interface ProtocolInput {
  name: string;
  modality: "CT" | "MRI";
  anatomyRegionId: number | null;
  category: string | null;
  indication: string | null;
  contrastPolicy: string | null;
  changeSummary: string | null;
}

export interface ProtocolUpdateInput {
  name?: string;
  anatomyRegionId?: number | null;
  category?: string | null;
  indication?: string | null;
  contrastPolicy?: string | null;
  isActive?: boolean;
}

export interface ProtocolVersionRow {
  id: number;
  protocolId: number;
  versionNumber: string;
  status: ProtocolVersionStatus;
  changeSummary: string | null;
  createdBy: number | null;
  approvedBy: number | null;
  approvedAt: string | null;
  retiredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProtocolCtPhaseRow {
  id: number;
  protocolVersionId: number;
  orderIndex: number;
  ctPhasePresetId: number | null;
  ctPhasePresetName: string | null;
  customPhaseName: string | null;
  timingOverride: string | null;
  coverageOverride: string | null;
  reconstructionOverride: string | null;
  instructionsOverride: string | null;
  isRequired: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProtocolMriSequenceRow {
  id: number;
  protocolVersionId: number;
  scannerId: number | null;
  scannerName: string | null;
  orderIndex: number;
  mriSequencePresetId: number | null;
  mriSequencePresetName: string | null;
  planeOverride: string | null;
  coverageOverride: string | null;
  bValuesOverride: string | null;
  timingOverride: string | null;
  notesOverride: string | null;
  isRequired: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProtocolVersionDetail {
  protocol: ProtocolLibraryProtocolRow;
  version: ProtocolVersionRow;
  ctPhases: ProtocolCtPhaseRow[];
  mriSequences: ProtocolMriSequenceRow[];
}

export interface ProtocolCtPhaseInput {
  ctPhasePresetId: number | null;
  customPhaseName: string | null;
  timingOverride: string | null;
  coverageOverride: string | null;
  reconstructionOverride: string | null;
  instructionsOverride: string | null;
  isRequired: boolean;
}

export interface ProtocolMriSequenceInput {
  scannerId: number | null;
  mriSequencePresetId: number | null;
  planeOverride: string | null;
  coverageOverride: string | null;
  bValuesOverride: string | null;
  timingOverride: string | null;
  notesOverride: string | null;
  isRequired: boolean;
}

export interface ProtocolAnatomyRegionInput {
  name: string;
  bodySystem: string | null;
  modalityScope: ProtocolAnatomyRegionRow["modalityScope"];
  defaultCoverageNote: string | null;
  isActive: boolean;
}

export interface ImagingScannerInput {
  name: string;
  modality: ImagingScannerRow["modality"];
  vendor: string | null;
  model: string | null;
  fieldStrength: string | null;
  location: string | null;
  notes: string | null;
  isActive: boolean;
}

export interface CtPhasePresetInput {
  name: string;
  contrastStatus: CtPhasePresetRow["contrastStatus"];
  timingType: CtPhasePresetRow["timingType"];
  delaySeconds: number | null;
  bolusTrackingSite: string | null;
  triggerHu: number | null;
  defaultCoverage: string | null;
  reconstructionNotes: string | null;
  instructions: string | null;
  isActive: boolean;
}

export interface MriSequencePresetInput {
  scannerId: number | null;
  vendor: string | null;
  name: string;
  vendorSequenceName: string | null;
  genericFamily: string | null;
  weighting: string | null;
  defaultPlane: string | null;
  contrastRelation: string | null;
  defaultCoverage: string | null;
  defaultBValues: string | null;
  defaultDynamicTiming: string | null;
  estimatedScanTimeMinutes: number | null;
  notes: string | null;
  isActive: boolean;
}

function numberOrNull(value: unknown): number | null {
  return value == null ? null : Number(value);
}

function stringOrNull(value: unknown): string | null {
  return value == null ? null : String(value);
}

function mapAnatomyRegion(row: RawRecord): ProtocolAnatomyRegionRow {
  return {
    id: Number(row.id),
    name: String(row.name),
    bodySystem: stringOrNull(row.body_system),
    modalityScope: String(row.modality_scope) as ProtocolAnatomyRegionRow["modalityScope"],
    defaultCoverageNote: stringOrNull(row.default_coverage_note),
    isActive: Boolean(row.is_active),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapScanner(row: RawRecord): ImagingScannerRow {
  return {
    id: Number(row.id),
    name: String(row.name),
    modality: String(row.modality) as ImagingScannerRow["modality"],
    vendor: stringOrNull(row.vendor),
    model: stringOrNull(row.model),
    fieldStrength: stringOrNull(row.field_strength),
    location: stringOrNull(row.location),
    isActive: Boolean(row.is_active),
    notes: stringOrNull(row.notes),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapCtPhasePreset(row: RawRecord): CtPhasePresetRow {
  return {
    id: Number(row.id),
    name: String(row.name),
    contrastStatus: String(row.contrast_status) as CtPhasePresetRow["contrastStatus"],
    timingType: String(row.timing_type) as CtPhasePresetRow["timingType"],
    delaySeconds: numberOrNull(row.delay_seconds),
    bolusTrackingSite: stringOrNull(row.bolus_tracking_site),
    triggerHu: numberOrNull(row.trigger_hu),
    defaultCoverage: stringOrNull(row.default_coverage),
    reconstructionNotes: stringOrNull(row.reconstruction_notes),
    instructions: stringOrNull(row.instructions),
    isActive: Boolean(row.is_active),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapMriSequencePreset(row: RawRecord): MriSequencePresetRow {
  return {
    id: Number(row.id),
    scannerId: numberOrNull(row.scanner_id),
    scannerName: stringOrNull(row.scanner_name),
    vendor: stringOrNull(row.vendor),
    name: String(row.name),
    vendorSequenceName: stringOrNull(row.vendor_sequence_name),
    genericFamily: stringOrNull(row.generic_family),
    weighting: stringOrNull(row.weighting),
    defaultPlane: stringOrNull(row.default_plane),
    contrastRelation: stringOrNull(row.contrast_relation),
    defaultCoverage: stringOrNull(row.default_coverage),
    defaultBValues: stringOrNull(row.default_b_values),
    defaultDynamicTiming: stringOrNull(row.default_dynamic_timing),
    estimatedScanTimeMinutes: numberOrNull(row.estimated_scan_time_minutes),
    notes: stringOrNull(row.notes),
    isActive: Boolean(row.is_active),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapProtocol(row: RawRecord): ProtocolLibraryProtocolRow {
  return {
    id: Number(row.id),
    name: String(row.name),
    modality: String(row.modality) as ProtocolLibraryProtocolRow["modality"],
    anatomyRegionId: numberOrNull(row.anatomy_region_id),
    anatomyRegionName: stringOrNull(row.anatomy_region_name),
    category: stringOrNull(row.category),
    indication: stringOrNull(row.indication),
    contrastPolicy: stringOrNull(row.contrast_policy),
    activeVersionId: numberOrNull(row.active_version_id),
    activeVersionNumber: stringOrNull(row.active_version_number),
    activeVersionStatus: row.active_version_status == null ? null : String(row.active_version_status) as ProtocolVersionStatus,
    latestDraftVersionId: numberOrNull(row.latest_draft_version_id),
    latestDraftVersionNumber: stringOrNull(row.latest_draft_version_number),
    isActive: Boolean(row.is_active),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapVersion(row: RawRecord): ProtocolVersionRow {
  return {
    id: Number(row.id),
    protocolId: Number(row.protocol_id),
    versionNumber: String(row.version_number),
    status: String(row.status) as ProtocolVersionStatus,
    changeSummary: stringOrNull(row.change_summary),
    createdBy: numberOrNull(row.created_by),
    approvedBy: numberOrNull(row.approved_by),
    approvedAt: stringOrNull(row.approved_at),
    retiredAt: stringOrNull(row.retired_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapProtocolCtPhase(row: RawRecord): ProtocolCtPhaseRow {
  return {
    id: Number(row.id),
    protocolVersionId: Number(row.protocol_version_id),
    orderIndex: Number(row.order_index),
    ctPhasePresetId: numberOrNull(row.ct_phase_preset_id),
    ctPhasePresetName: stringOrNull(row.ct_phase_preset_name),
    customPhaseName: stringOrNull(row.custom_phase_name),
    timingOverride: stringOrNull(row.timing_override),
    coverageOverride: stringOrNull(row.coverage_override),
    reconstructionOverride: stringOrNull(row.reconstruction_override),
    instructionsOverride: stringOrNull(row.instructions_override),
    isRequired: Boolean(row.is_required),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapProtocolMriSequence(row: RawRecord): ProtocolMriSequenceRow {
  return {
    id: Number(row.id),
    protocolVersionId: Number(row.protocol_version_id),
    scannerId: numberOrNull(row.scanner_id),
    scannerName: stringOrNull(row.scanner_name),
    orderIndex: Number(row.order_index),
    mriSequencePresetId: numberOrNull(row.mri_sequence_preset_id),
    mriSequencePresetName: stringOrNull(row.mri_sequence_preset_name),
    planeOverride: stringOrNull(row.plane_override),
    coverageOverride: stringOrNull(row.coverage_override),
    bValuesOverride: stringOrNull(row.b_values_override),
    timingOverride: stringOrNull(row.timing_override),
    notesOverride: stringOrNull(row.notes_override),
    isRequired: Boolean(row.is_required),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function listProtocolAnatomyRegions(): Promise<ProtocolAnatomyRegionRow[]> {
  const result = await pool.query(`
    select id, name, body_system, modality_scope, default_coverage_note, is_active, created_at, updated_at
    from protocol_anatomy_regions
    order by is_active desc, name asc
  `);
  return result.rows.map(mapAnatomyRegion);
}

export async function listImagingScanners(): Promise<ImagingScannerRow[]> {
  const result = await pool.query(`
    select id, name, modality, vendor, model, field_strength, location, is_active, notes, created_at, updated_at
    from imaging_scanners
    order by is_active desc, modality asc, name asc
  `);
  return result.rows.map(mapScanner);
}

export async function listCtPhasePresets(): Promise<CtPhasePresetRow[]> {
  const result = await pool.query(`
    select id, name, contrast_status, timing_type, delay_seconds, bolus_tracking_site, trigger_hu,
           default_coverage, reconstruction_notes, instructions, is_active, created_at, updated_at
    from ct_phase_presets
    order by is_active desc, name asc
  `);
  return result.rows.map(mapCtPhasePreset);
}

export async function listMriSequencePresets(): Promise<MriSequencePresetRow[]> {
  const result = await pool.query(`
    select msp.id, msp.scanner_id, s.name as scanner_name, msp.vendor, msp.name, msp.vendor_sequence_name,
           msp.generic_family, msp.weighting, msp.default_plane, msp.contrast_relation, msp.default_coverage,
           msp.default_b_values, msp.default_dynamic_timing, msp.estimated_scan_time_minutes, msp.notes,
           msp.is_active, msp.created_at, msp.updated_at
    from mri_sequence_presets msp
    left join imaging_scanners s on s.id = msp.scanner_id
    order by msp.is_active desc, coalesce(s.name, ''), msp.name asc
  `);
  return result.rows.map(mapMriSequencePreset);
}

export async function listProtocols(): Promise<ProtocolLibraryProtocolRow[]> {
  const result = await pool.query(`
    select p.id, p.name, p.modality, p.anatomy_region_id, ar.name as anatomy_region_name,
           p.category, p.indication, p.contrast_policy, p.active_version_id,
           av.version_number as active_version_number,
           av.status as active_version_status,
           dv.id as latest_draft_version_id,
           dv.version_number as latest_draft_version_number,
           p.is_active, p.created_at, p.updated_at
    from protocols p
    left join protocol_anatomy_regions ar on ar.id = p.anatomy_region_id
    left join protocol_versions av on av.id = p.active_version_id
    left join lateral (
      select id, version_number
      from protocol_versions
      where protocol_id = p.id and status = 'DRAFT'
      order by id desc
      limit 1
    ) dv on true
    order by p.is_active desc, p.name asc
  `);
  return result.rows.map(mapProtocol);
}

export async function createProtocolAnatomyRegion(input: ProtocolAnatomyRegionInput): Promise<ProtocolAnatomyRegionRow> {
  const result = await pool.query(
    `
      insert into protocol_anatomy_regions (name, body_system, modality_scope, default_coverage_note, is_active)
      values ($1, $2, $3, $4, $5)
      returning id, name, body_system, modality_scope, default_coverage_note, is_active, created_at, updated_at
    `,
    [input.name, input.bodySystem, input.modalityScope, input.defaultCoverageNote, input.isActive]
  );
  return mapAnatomyRegion(result.rows[0]);
}

export async function updateProtocolAnatomyRegion(id: number, input: Partial<ProtocolAnatomyRegionInput>): Promise<ProtocolAnatomyRegionRow | null> {
  const result = await pool.query(
    `
      update protocol_anatomy_regions
      set
        name = coalesce($2, name),
        body_system = case when $3::boolean then $4 else body_system end,
        modality_scope = coalesce($5, modality_scope),
        default_coverage_note = case when $6::boolean then $7 else default_coverage_note end,
        is_active = coalesce($8, is_active)
      where id = $1
      returning id, name, body_system, modality_scope, default_coverage_note, is_active, created_at, updated_at
    `,
    [
      id,
      input.name,
      "bodySystem" in input,
      input.bodySystem ?? null,
      input.modalityScope,
      "defaultCoverageNote" in input,
      input.defaultCoverageNote ?? null,
      input.isActive,
    ]
  );
  return result.rows[0] ? mapAnatomyRegion(result.rows[0]) : null;
}

export async function createImagingScanner(input: ImagingScannerInput): Promise<ImagingScannerRow> {
  const result = await pool.query(
    `
      insert into imaging_scanners (name, modality, vendor, model, field_strength, location, notes, is_active)
      values ($1, $2, $3, $4, $5, $6, $7, $8)
      returning id, name, modality, vendor, model, field_strength, location, is_active, notes, created_at, updated_at
    `,
    [input.name, input.modality, input.vendor, input.model, input.fieldStrength, input.location, input.notes, input.isActive]
  );
  return mapScanner(result.rows[0]);
}

export async function updateImagingScanner(id: number, input: Partial<ImagingScannerInput>): Promise<ImagingScannerRow | null> {
  const result = await pool.query(
    `
      update imaging_scanners
      set
        name = coalesce($2, name),
        modality = coalesce($3, modality),
        vendor = case when $4::boolean then $5 else vendor end,
        model = case when $6::boolean then $7 else model end,
        field_strength = case when $8::boolean then $9 else field_strength end,
        location = case when $10::boolean then $11 else location end,
        notes = case when $12::boolean then $13 else notes end,
        is_active = coalesce($14, is_active)
      where id = $1
      returning id, name, modality, vendor, model, field_strength, location, is_active, notes, created_at, updated_at
    `,
    [
      id,
      input.name,
      input.modality,
      "vendor" in input,
      input.vendor ?? null,
      "model" in input,
      input.model ?? null,
      "fieldStrength" in input,
      input.fieldStrength ?? null,
      "location" in input,
      input.location ?? null,
      "notes" in input,
      input.notes ?? null,
      input.isActive,
    ]
  );
  return result.rows[0] ? mapScanner(result.rows[0]) : null;
}

export async function createCtPhasePreset(input: CtPhasePresetInput): Promise<CtPhasePresetRow> {
  const result = await pool.query(
    `
      insert into ct_phase_presets (
        name, contrast_status, timing_type, delay_seconds, bolus_tracking_site, trigger_hu,
        default_coverage, reconstruction_notes, instructions, is_active
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      returning id, name, contrast_status, timing_type, delay_seconds, bolus_tracking_site, trigger_hu,
                default_coverage, reconstruction_notes, instructions, is_active, created_at, updated_at
    `,
    [
      input.name,
      input.contrastStatus,
      input.timingType,
      input.delaySeconds,
      input.bolusTrackingSite,
      input.triggerHu,
      input.defaultCoverage,
      input.reconstructionNotes,
      input.instructions,
      input.isActive,
    ]
  );
  return mapCtPhasePreset(result.rows[0]);
}

export async function updateCtPhasePreset(id: number, input: Partial<CtPhasePresetInput>): Promise<CtPhasePresetRow | null> {
  const result = await pool.query(
    `
      update ct_phase_presets
      set
        name = coalesce($2, name),
        contrast_status = coalesce($3, contrast_status),
        timing_type = coalesce($4, timing_type),
        delay_seconds = case when $5::boolean then $6 else delay_seconds end,
        bolus_tracking_site = case when $7::boolean then $8 else bolus_tracking_site end,
        trigger_hu = case when $9::boolean then $10 else trigger_hu end,
        default_coverage = case when $11::boolean then $12 else default_coverage end,
        reconstruction_notes = case when $13::boolean then $14 else reconstruction_notes end,
        instructions = case when $15::boolean then $16 else instructions end,
        is_active = coalesce($17, is_active)
      where id = $1
      returning id, name, contrast_status, timing_type, delay_seconds, bolus_tracking_site, trigger_hu,
                default_coverage, reconstruction_notes, instructions, is_active, created_at, updated_at
    `,
    [
      id,
      input.name,
      input.contrastStatus,
      input.timingType,
      "delaySeconds" in input,
      input.delaySeconds ?? null,
      "bolusTrackingSite" in input,
      input.bolusTrackingSite ?? null,
      "triggerHu" in input,
      input.triggerHu ?? null,
      "defaultCoverage" in input,
      input.defaultCoverage ?? null,
      "reconstructionNotes" in input,
      input.reconstructionNotes ?? null,
      "instructions" in input,
      input.instructions ?? null,
      input.isActive,
    ]
  );
  return result.rows[0] ? mapCtPhasePreset(result.rows[0]) : null;
}

export async function createMriSequencePreset(input: MriSequencePresetInput): Promise<MriSequencePresetRow> {
  const result = await pool.query(
    `
      insert into mri_sequence_presets (
        scanner_id, vendor, name, vendor_sequence_name, generic_family, weighting, default_plane,
        contrast_relation, default_coverage, default_b_values, default_dynamic_timing,
        estimated_scan_time_minutes, notes, is_active
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      returning id, scanner_id, null::text as scanner_name, vendor, name, vendor_sequence_name, generic_family,
                weighting, default_plane, contrast_relation, default_coverage, default_b_values,
                default_dynamic_timing, estimated_scan_time_minutes, notes, is_active, created_at, updated_at
    `,
    [
      input.scannerId,
      input.vendor,
      input.name,
      input.vendorSequenceName,
      input.genericFamily,
      input.weighting,
      input.defaultPlane,
      input.contrastRelation,
      input.defaultCoverage,
      input.defaultBValues,
      input.defaultDynamicTiming,
      input.estimatedScanTimeMinutes,
      input.notes,
      input.isActive,
    ]
  );
  return mapMriSequencePreset(result.rows[0]);
}

export async function updateMriSequencePreset(id: number, input: Partial<MriSequencePresetInput>): Promise<MriSequencePresetRow | null> {
  const result = await pool.query(
    `
      update mri_sequence_presets
      set
        scanner_id = case when $2::boolean then $3 else scanner_id end,
        vendor = case when $4::boolean then $5 else vendor end,
        name = coalesce($6, name),
        vendor_sequence_name = case when $7::boolean then $8 else vendor_sequence_name end,
        generic_family = case when $9::boolean then $10 else generic_family end,
        weighting = case when $11::boolean then $12 else weighting end,
        default_plane = case when $13::boolean then $14 else default_plane end,
        contrast_relation = case when $15::boolean then $16 else contrast_relation end,
        default_coverage = case when $17::boolean then $18 else default_coverage end,
        default_b_values = case when $19::boolean then $20 else default_b_values end,
        default_dynamic_timing = case when $21::boolean then $22 else default_dynamic_timing end,
        estimated_scan_time_minutes = case when $23::boolean then $24 else estimated_scan_time_minutes end,
        notes = case when $25::boolean then $26 else notes end,
        is_active = coalesce($27, is_active)
      where id = $1
      returning id, scanner_id, null::text as scanner_name, vendor, name, vendor_sequence_name, generic_family,
                weighting, default_plane, contrast_relation, default_coverage, default_b_values,
                default_dynamic_timing, estimated_scan_time_minutes, notes, is_active, created_at, updated_at
    `,
    [
      id,
      "scannerId" in input,
      input.scannerId ?? null,
      "vendor" in input,
      input.vendor ?? null,
      input.name,
      "vendorSequenceName" in input,
      input.vendorSequenceName ?? null,
      "genericFamily" in input,
      input.genericFamily ?? null,
      "weighting" in input,
      input.weighting ?? null,
      "defaultPlane" in input,
      input.defaultPlane ?? null,
      "contrastRelation" in input,
      input.contrastRelation ?? null,
      "defaultCoverage" in input,
      input.defaultCoverage ?? null,
      "defaultBValues" in input,
      input.defaultBValues ?? null,
      "defaultDynamicTiming" in input,
      input.defaultDynamicTiming ?? null,
      "estimatedScanTimeMinutes" in input,
      input.estimatedScanTimeMinutes ?? null,
      "notes" in input,
      input.notes ?? null,
      input.isActive,
    ]
  );
  return result.rows[0] ? mapMriSequencePreset(result.rows[0]) : null;
}

async function protocolById(client: DbClient, protocolId: number): Promise<ProtocolLibraryProtocolRow | null> {
  const result = await client.query(
    `
      select p.id, p.name, p.modality, p.anatomy_region_id, ar.name as anatomy_region_name,
             p.category, p.indication, p.contrast_policy, p.active_version_id,
             av.version_number as active_version_number,
             av.status as active_version_status,
             dv.id as latest_draft_version_id,
             dv.version_number as latest_draft_version_number,
             p.is_active, p.created_at, p.updated_at
      from protocols p
      left join protocol_anatomy_regions ar on ar.id = p.anatomy_region_id
      left join protocol_versions av on av.id = p.active_version_id
      left join lateral (
        select id, version_number
        from protocol_versions
        where protocol_id = p.id and status = 'DRAFT'
        order by id desc
        limit 1
      ) dv on true
      where p.id = $1
    `,
    [protocolId]
  );
  return result.rows[0] ? mapProtocol(result.rows[0]) : null;
}

async function versionById(client: DbClient, versionId: number): Promise<ProtocolVersionRow | null> {
  const result = await client.query(
    `
      select id, protocol_id, version_number, status, change_summary, created_by, approved_by,
             approved_at, retired_at, created_at, updated_at
      from protocol_versions
      where id = $1
    `,
    [versionId]
  );
  return result.rows[0] ? mapVersion(result.rows[0]) : null;
}

async function ctPhasesForVersion(client: DbClient, versionId: number): Promise<ProtocolCtPhaseRow[]> {
  const result = await client.query(
    `
      select pcp.id, pcp.protocol_version_id, pcp.order_index, pcp.ct_phase_preset_id,
             cpp.name as ct_phase_preset_name, pcp.custom_phase_name, pcp.timing_override,
             pcp.coverage_override, pcp.reconstruction_override, pcp.instructions_override,
             pcp.is_required, pcp.created_at, pcp.updated_at
      from protocol_ct_phases pcp
      left join ct_phase_presets cpp on cpp.id = pcp.ct_phase_preset_id
      where pcp.protocol_version_id = $1
      order by pcp.order_index asc, pcp.id asc
    `,
    [versionId]
  );
  return result.rows.map(mapProtocolCtPhase);
}

async function mriSequencesForVersion(client: DbClient, versionId: number): Promise<ProtocolMriSequenceRow[]> {
  const result = await client.query(
    `
      select pms.id, pms.protocol_version_id, pms.scanner_id, s.name as scanner_name,
             pms.order_index, pms.mri_sequence_preset_id, msp.name as mri_sequence_preset_name,
             pms.plane_override, pms.coverage_override, pms.b_values_override, pms.timing_override,
             pms.notes_override, pms.is_required, pms.created_at, pms.updated_at
      from protocol_mri_sequences pms
      left join imaging_scanners s on s.id = pms.scanner_id
      left join mri_sequence_presets msp on msp.id = pms.mri_sequence_preset_id
      where pms.protocol_version_id = $1
      order by pms.order_index asc, pms.id asc
    `,
    [versionId]
  );
  return result.rows.map(mapProtocolMriSequence);
}

export async function getProtocolDetail(protocolId: number): Promise<{ protocol: ProtocolLibraryProtocolRow; versions: ProtocolVersionRow[] } | null> {
  const protocol = await protocolById(pool, protocolId);
  if (!protocol) return null;
  const versionsResult = await pool.query(
    `
      select id, protocol_id, version_number, status, change_summary, created_by, approved_by,
             approved_at, retired_at, created_at, updated_at
      from protocol_versions
      where protocol_id = $1
      order by id desc
    `,
    [protocolId]
  );
  return { protocol, versions: versionsResult.rows.map(mapVersion) };
}

export async function getProtocolVersionDetail(versionId: number): Promise<ProtocolVersionDetail | null> {
  const version = await versionById(pool, versionId);
  if (!version) return null;
  const protocol = await protocolById(pool, version.protocolId);
  if (!protocol) return null;
  return {
    protocol,
    version,
    ctPhases: await ctPhasesForVersion(pool, versionId),
    mriSequences: await mriSequencesForVersion(pool, versionId),
  };
}

export async function createProtocolWithDraft(input: ProtocolInput, actorUserId: number | null): Promise<{ protocol: ProtocolLibraryProtocolRow; version: ProtocolVersionRow }> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const protocolResult = await client.query(
      `
        insert into protocols (name, modality, anatomy_region_id, category, indication, contrast_policy, is_active)
        values ($1, $2, $3, $4, $5, $6, true)
        returning id
      `,
      [input.name, input.modality, input.anatomyRegionId, input.category, input.indication, input.contrastPolicy]
    );
    const protocolId = Number(protocolResult.rows[0].id);
    const versionResult = await client.query(
      `
        insert into protocol_versions (protocol_id, version_number, status, change_summary, created_by)
        values ($1, '1.0', 'DRAFT', $2, $3)
        returning id, protocol_id, version_number, status, change_summary, created_by, approved_by,
                  approved_at, retired_at, created_at, updated_at
      `,
      [protocolId, input.changeSummary || "Initial protocol version", actorUserId]
    );
    const protocol = await protocolById(client, protocolId);
    await client.query("commit");
    return { protocol: protocol!, version: mapVersion(versionResult.rows[0]) };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateProtocol(protocolId: number, input: ProtocolUpdateInput): Promise<ProtocolLibraryProtocolRow | null> {
  const result = await pool.query(
    `
      update protocols
      set
        name = coalesce($2, name),
        anatomy_region_id = case when $3::boolean then $4 else anatomy_region_id end,
        category = case when $5::boolean then $6 else category end,
        indication = case when $7::boolean then $8 else indication end,
        contrast_policy = case when $9::boolean then $10 else contrast_policy end,
        is_active = coalesce($11, is_active)
      where id = $1
      returning id
    `,
    [
      protocolId,
      input.name,
      "anatomyRegionId" in input,
      input.anatomyRegionId ?? null,
      "category" in input,
      input.category ?? null,
      "indication" in input,
      input.indication ?? null,
      "contrastPolicy" in input,
      input.contrastPolicy ?? null,
      input.isActive,
    ]
  );
  if (!result.rows[0]) return null;
  return protocolById(pool, protocolId);
}

function assertDraft(version: ProtocolVersionRow) {
  if (version.status !== "DRAFT") throw new HttpError(409, "Protocol version is not editable.");
}

async function versionContext(client: DbClient, versionId: number): Promise<{ version: ProtocolVersionRow; protocol: ProtocolLibraryProtocolRow }> {
  const version = await versionById(client, versionId);
  if (!version) throw new HttpError(404, "Protocol version not found.");
  const protocol = await protocolById(client, version.protocolId);
  if (!protocol) throw new HttpError(404, "Protocol not found.");
  return { version, protocol };
}

export async function updateProtocolVersion(versionId: number, input: { changeSummary?: string | null }): Promise<ProtocolVersionRow | null> {
  const { version } = await versionContext(pool, versionId);
  assertDraft(version);
  const result = await pool.query(
    `
      update protocol_versions
      set change_summary = case when $2::boolean then $3 else change_summary end
      where id = $1
      returning id, protocol_id, version_number, status, change_summary, created_by, approved_by,
                approved_at, retired_at, created_at, updated_at
    `,
    [versionId, "changeSummary" in input, input.changeSummary ?? null]
  );
  return result.rows[0] ? mapVersion(result.rows[0]) : null;
}

async function nextOrder(client: DbClient, table: "protocol_ct_phases" | "protocol_mri_sequences", versionId: number): Promise<number> {
  const result = await client.query(`select coalesce(max(order_index), 0)::int + 1 as next_order from ${table} where protocol_version_id = $1`, [versionId]);
  return Number(result.rows[0].next_order);
}

export async function addProtocolCtPhase(versionId: number, input: ProtocolCtPhaseInput): Promise<ProtocolCtPhaseRow> {
  const { version, protocol } = await versionContext(pool, versionId);
  assertDraft(version);
  if (protocol.modality !== "CT") throw new HttpError(400, "CT phase rows can only be added to CT protocol versions.");
  const orderIndex = await nextOrder(pool, "protocol_ct_phases", versionId);
  const result = await pool.query(
    `
      insert into protocol_ct_phases (
        protocol_version_id, order_index, ct_phase_preset_id, custom_phase_name, timing_override,
        coverage_override, reconstruction_override, instructions_override, is_required
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      returning id, protocol_version_id, order_index, ct_phase_preset_id, null::text as ct_phase_preset_name,
                custom_phase_name, timing_override, coverage_override, reconstruction_override,
                instructions_override, is_required, created_at, updated_at
    `,
    [versionId, orderIndex, input.ctPhasePresetId, input.customPhaseName, input.timingOverride, input.coverageOverride, input.reconstructionOverride, input.instructionsOverride, input.isRequired]
  );
  return mapProtocolCtPhase(result.rows[0]);
}

export async function updateProtocolCtPhase(versionId: number, rowId: number, input: Partial<ProtocolCtPhaseInput>): Promise<ProtocolCtPhaseRow | null> {
  const { version, protocol } = await versionContext(pool, versionId);
  assertDraft(version);
  if (protocol.modality !== "CT") throw new HttpError(400, "CT phase rows can only be added to CT protocol versions.");
  const result = await pool.query(
    `
      update protocol_ct_phases
      set
        ct_phase_preset_id = case when $3::boolean then $4 else ct_phase_preset_id end,
        custom_phase_name = case when $5::boolean then $6 else custom_phase_name end,
        timing_override = case when $7::boolean then $8 else timing_override end,
        coverage_override = case when $9::boolean then $10 else coverage_override end,
        reconstruction_override = case when $11::boolean then $12 else reconstruction_override end,
        instructions_override = case when $13::boolean then $14 else instructions_override end,
        is_required = coalesce($15, is_required)
      where protocol_version_id = $1 and id = $2
      returning id, protocol_version_id, order_index, ct_phase_preset_id, null::text as ct_phase_preset_name,
                custom_phase_name, timing_override, coverage_override, reconstruction_override,
                instructions_override, is_required, created_at, updated_at
    `,
    [
      versionId,
      rowId,
      "ctPhasePresetId" in input,
      input.ctPhasePresetId ?? null,
      "customPhaseName" in input,
      input.customPhaseName ?? null,
      "timingOverride" in input,
      input.timingOverride ?? null,
      "coverageOverride" in input,
      input.coverageOverride ?? null,
      "reconstructionOverride" in input,
      input.reconstructionOverride ?? null,
      "instructionsOverride" in input,
      input.instructionsOverride ?? null,
      input.isRequired,
    ]
  );
  return result.rows[0] ? mapProtocolCtPhase(result.rows[0]) : null;
}

export async function removeProtocolCtPhase(versionId: number, rowId: number): Promise<void> {
  const { version } = await versionContext(pool, versionId);
  assertDraft(version);
  await pool.query(`delete from protocol_ct_phases where protocol_version_id = $1 and id = $2`, [versionId, rowId]);
}

export async function addProtocolMriSequence(versionId: number, input: ProtocolMriSequenceInput): Promise<ProtocolMriSequenceRow> {
  const { version, protocol } = await versionContext(pool, versionId);
  assertDraft(version);
  if (protocol.modality !== "MRI") throw new HttpError(400, "MRI sequence rows can only be added to MRI protocol versions.");
  const orderIndex = await nextOrder(pool, "protocol_mri_sequences", versionId);
  const result = await pool.query(
    `
      insert into protocol_mri_sequences (
        protocol_version_id, scanner_id, order_index, mri_sequence_preset_id, plane_override,
        coverage_override, b_values_override, timing_override, notes_override, is_required
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      returning id, protocol_version_id, scanner_id, null::text as scanner_name, order_index,
                mri_sequence_preset_id, null::text as mri_sequence_preset_name, plane_override,
                coverage_override, b_values_override, timing_override, notes_override, is_required,
                created_at, updated_at
    `,
    [versionId, input.scannerId, orderIndex, input.mriSequencePresetId, input.planeOverride, input.coverageOverride, input.bValuesOverride, input.timingOverride, input.notesOverride, input.isRequired]
  );
  return mapProtocolMriSequence(result.rows[0]);
}

export async function updateProtocolMriSequence(versionId: number, rowId: number, input: Partial<ProtocolMriSequenceInput>): Promise<ProtocolMriSequenceRow | null> {
  const { version, protocol } = await versionContext(pool, versionId);
  assertDraft(version);
  if (protocol.modality !== "MRI") throw new HttpError(400, "MRI sequence rows can only be added to MRI protocol versions.");
  const result = await pool.query(
    `
      update protocol_mri_sequences
      set
        scanner_id = case when $3::boolean then $4 else scanner_id end,
        mri_sequence_preset_id = case when $5::boolean then $6 else mri_sequence_preset_id end,
        plane_override = case when $7::boolean then $8 else plane_override end,
        coverage_override = case when $9::boolean then $10 else coverage_override end,
        b_values_override = case when $11::boolean then $12 else b_values_override end,
        timing_override = case when $13::boolean then $14 else timing_override end,
        notes_override = case when $15::boolean then $16 else notes_override end,
        is_required = coalesce($17, is_required)
      where protocol_version_id = $1 and id = $2
      returning id, protocol_version_id, scanner_id, null::text as scanner_name, order_index,
                mri_sequence_preset_id, null::text as mri_sequence_preset_name, plane_override,
                coverage_override, b_values_override, timing_override, notes_override, is_required,
                created_at, updated_at
    `,
    [
      versionId,
      rowId,
      "scannerId" in input,
      input.scannerId ?? null,
      "mriSequencePresetId" in input,
      input.mriSequencePresetId ?? null,
      "planeOverride" in input,
      input.planeOverride ?? null,
      "coverageOverride" in input,
      input.coverageOverride ?? null,
      "bValuesOverride" in input,
      input.bValuesOverride ?? null,
      "timingOverride" in input,
      input.timingOverride ?? null,
      "notesOverride" in input,
      input.notesOverride ?? null,
      input.isRequired,
    ]
  );
  return result.rows[0] ? mapProtocolMriSequence(result.rows[0]) : null;
}

export async function removeProtocolMriSequence(versionId: number, rowId: number): Promise<void> {
  const { version } = await versionContext(pool, versionId);
  assertDraft(version);
  await pool.query(`delete from protocol_mri_sequences where protocol_version_id = $1 and id = $2`, [versionId, rowId]);
}

export async function reorderProtocolRows(versionId: number, rowIds: number[], kind: "CT" | "MRI"): Promise<void> {
  const { version } = await versionContext(pool, versionId);
  assertDraft(version);
  const table = kind === "CT" ? "protocol_ct_phases" : "protocol_mri_sequences";
  const client = await pool.connect();
  try {
    await client.query("begin");
    for (let index = 0; index < rowIds.length; index += 1) {
      await client.query(`update ${table} set order_index = $3 where protocol_version_id = $1 and id = $2`, [versionId, rowIds[index], index + 1]);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function nextDraftVersionNumber(versionNumber: string): string {
  const parts = versionNumber.split(".");
  const minor = Number(parts[parts.length - 1] || "0");
  if (!Number.isInteger(minor)) return `${versionNumber}.1`;
  parts[parts.length - 1] = String(minor + 1);
  return parts.join(".");
}

export async function activateProtocolVersion(versionId: number, actorUserId: number | null): Promise<ProtocolVersionDetail> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const { version, protocol } = await versionContext(client, versionId);
    assertDraft(version);
    const countResult = await client.query(
      protocol.modality === "CT"
        ? `select count(*)::int as count from protocol_ct_phases where protocol_version_id = $1`
        : `select count(*)::int as count from protocol_mri_sequences where protocol_version_id = $1`,
      [versionId]
    );
    const rowCount = Number(countResult.rows[0].count);
    if (rowCount < 1) {
      throw new HttpError(400, protocol.modality === "CT" ? "Activation requires at least one CT phase." : "Activation requires at least one MRI sequence.");
    }
    await client.query(`update protocol_versions set status = 'RETIRED', retired_at = now() where protocol_id = $1 and status = 'ACTIVE'`, [version.protocolId]);
    await client.query(
      `update protocol_versions set status = 'ACTIVE', approved_by = $2, approved_at = now() where id = $1`,
      [versionId, actorUserId]
    );
    await client.query(`update protocols set active_version_id = $2, is_active = true where id = $1`, [version.protocolId, versionId]);
    await client.query("commit");
    const detail = await getProtocolVersionDetail(versionId);
    return detail!;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function createDraftFromActiveVersion(protocolId: number, actorUserId: number | null): Promise<ProtocolVersionDetail> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const protocol = await protocolById(client, protocolId);
    if (!protocol?.activeVersionId) throw new HttpError(400, "Protocol has no active version.");
    const activeVersion = await versionById(client, protocol.activeVersionId);
    if (!activeVersion) throw new HttpError(400, "Protocol has no active version.");
    const versionResult = await client.query(
      `
        insert into protocol_versions (protocol_id, version_number, status, change_summary, created_by)
        values ($1, $2, 'DRAFT', $3, $4)
        returning id, protocol_id, version_number, status, change_summary, created_by, approved_by,
                  approved_at, retired_at, created_at, updated_at
      `,
      [protocolId, nextDraftVersionNumber(activeVersion.versionNumber), `Draft from active ${activeVersion.versionNumber}`, actorUserId]
    );
    const draft = mapVersion(versionResult.rows[0]);
    await client.query(
      `
        insert into protocol_ct_phases (
          protocol_version_id, order_index, ct_phase_preset_id, custom_phase_name, timing_override,
          coverage_override, reconstruction_override, instructions_override, is_required
        )
        select $1, order_index, ct_phase_preset_id, custom_phase_name, timing_override,
               coverage_override, reconstruction_override, instructions_override, is_required
        from protocol_ct_phases
        where protocol_version_id = $2
      `,
      [draft.id, activeVersion.id]
    );
    await client.query(
      `
        insert into protocol_mri_sequences (
          protocol_version_id, scanner_id, order_index, mri_sequence_preset_id, plane_override,
          coverage_override, b_values_override, timing_override, notes_override, is_required
        )
        select $1, scanner_id, order_index, mri_sequence_preset_id, plane_override,
               coverage_override, b_values_override, timing_override, notes_override, is_required
        from protocol_mri_sequences
        where protocol_version_id = $2
      `,
      [draft.id, activeVersion.id]
    );
    await client.query("commit");
    const detail = await getProtocolVersionDetail(draft.id);
    return detail!;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
