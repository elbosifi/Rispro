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
  ctSliceDetectorSpecification: string | null;
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
  sequenceKey: string | null;
  scannerId: number | null;
  scannerName: string | null;
  vendor: string | null;
  name: string;
  vendorSequenceName: string | null;
  genericFamily: string | null;
  weighting: string | null;
  defaultPlane: string | null;
  fatSuppression: string | null;
  acquisitionType: string | null;
  contrastRelation: string | null;
  defaultCoverage: string | null;
  defaultBValues: string | null;
  defaultDynamicTiming: string | null;
  estimatedScanTimeMinutes: number | null;
  notes: string | null;
  scannerAliases: MriSequenceScannerAliasRow[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MriSequenceScannerAliasRow {
  id: number;
  mriSequencePresetId: number;
  scannerId: number;
  scannerName: string | null;
  vendorSequenceName: string;
  notes: string | null;
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
  oralContrastPolicy: string | null;
  bowelPreparation: string | null;
  preparationNotes: string | null;
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
  oralContrastPolicy: string | null;
  bowelPreparation: string | null;
  preparationNotes: string | null;
  changeSummary: string | null;
  protocolNotes: string | null;
}

export interface ProtocolUpdateInput {
  name?: string;
  anatomyRegionId?: number | null;
  category?: string | null;
  indication?: string | null;
  contrastPolicy?: string | null;
  oralContrastPolicy?: string | null;
  bowelPreparation?: string | null;
  preparationNotes?: string | null;
  isActive?: boolean;
}

export interface ProtocolVersionRow {
  id: number;
  protocolId: number;
  versionNumber: string;
  status: ProtocolVersionStatus;
  changeSummary: string | null;
  protocolNotes: string | null;
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
  presetContrastStatus: string | null;
  presetTimingType: string | null;
  presetDelaySeconds: number | null;
  presetBolusTrackingSite: string | null;
  presetTriggerHu: number | null;
  presetDefaultCoverage: string | null;
  presetReconstructionNotes: string | null;
  presetInstructions: string | null;
  customPhaseName: string | null;
  timingOverride: string | null;
  timingType: "NON_CONTRAST" | "FIXED_DELAY_INJECTION_START" | "FIXED_DELAY_INJECTION_END" | "BOLUS_TRACKING" | "MANUAL" | null;
  delaySeconds: number | null;
  bolusTrackingSite: string | null;
  triggerHu: number | null;
  postTriggerDelaySeconds: number | null;
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
  presetGenericFamily: string | null;
  presetWeighting: string | null;
  presetDefaultPlane: string | null;
  presetFatSuppression: string | null;
  presetAcquisitionType: string | null;
  presetContrastRelation: string | null;
  scannerAliasVendorSequenceName: string | null;
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
  ctTechniques: ProtocolCtTechniqueRow[];
}

export interface ProtocolCtTechniqueRow {
  id: number;
  protocolVersionId: number;
  scannerId: number;
  scannerName: string | null;
  scannerVendor: string | null;
  scannerModel: string | null;
  kvMode: "AUTO" | "FIXED" | null;
  kvp: number | null;
  tubeCurrentMode: "AUTOMATIC" | "FIXED_MA" | "REFERENCE_MAS" | null;
  fixedMa: number | null;
  referenceMas: number | null;
  exposureControl: string | null;
  noiseIndex: number | null;
  minMa: number | null;
  maxMa: number | null;
  reconstructionMethod: string | null;
  reconstructionStrength: string | null;
  reconstructionImageDefinition: string | null;
  sliceThicknessMm: number | null;
  reconstructionIntervalMm: number | null;
  kernel: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProtocolCtPhaseInput {
  ctPhasePresetId: number | null;
  customPhaseName: string | null;
  timingOverride: string | null;
  timingType: ProtocolCtPhaseRow["timingType"];
  delaySeconds: number | null;
  bolusTrackingSite: string | null;
  triggerHu: number | null;
  postTriggerDelaySeconds: number | null;
  coverageOverride: string | null;
  reconstructionOverride: string | null;
  instructionsOverride: string | null;
  isRequired: boolean;
}

export interface ProtocolCtTechniqueInput {
  scannerId: number;
  kvMode: ProtocolCtTechniqueRow["kvMode"];
  kvp: number | null;
  tubeCurrentMode: ProtocolCtTechniqueRow["tubeCurrentMode"];
  fixedMa: number | null;
  referenceMas: number | null;
  exposureControl: string | null;
  noiseIndex: number | null;
  minMa: number | null;
  maxMa: number | null;
  reconstructionMethod: string | null;
  reconstructionStrength: string | null;
  reconstructionImageDefinition: string | null;
  sliceThicknessMm: number | null;
  reconstructionIntervalMm: number | null;
  kernel: string | null;
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
  ctSliceDetectorSpecification: string | null;
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
  fatSuppression: string | null;
  acquisitionType: string | null;
  contrastRelation: string | null;
  defaultCoverage: string | null;
  defaultBValues: string | null;
  defaultDynamicTiming: string | null;
  estimatedScanTimeMinutes: number | null;
  notes: string | null;
  scannerAliases?: MriSequenceScannerAliasInput[];
  isActive: boolean;
}

export interface MriSequenceScannerAliasInput {
  scannerId: number;
  vendorSequenceName: string;
  notes: string | null;
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
    ctSliceDetectorSpecification: stringOrNull(row.ct_slice_detector_specification),
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
    sequenceKey: stringOrNull(row.sequence_key),
    scannerId: numberOrNull(row.scanner_id),
    scannerName: stringOrNull(row.scanner_name),
    vendor: stringOrNull(row.vendor),
    name: String(row.name),
    vendorSequenceName: stringOrNull(row.vendor_sequence_name),
    genericFamily: stringOrNull(row.generic_family),
    weighting: stringOrNull(row.weighting),
    defaultPlane: stringOrNull(row.default_plane),
    fatSuppression: stringOrNull(row.fat_suppression),
    acquisitionType: stringOrNull(row.acquisition_type),
    contrastRelation: stringOrNull(row.contrast_relation),
    defaultCoverage: stringOrNull(row.default_coverage),
    defaultBValues: stringOrNull(row.default_b_values),
    defaultDynamicTiming: stringOrNull(row.default_dynamic_timing),
    estimatedScanTimeMinutes: numberOrNull(row.estimated_scan_time_minutes),
    notes: stringOrNull(row.notes),
    scannerAliases: rawAliases(row.scanner_aliases),
    isActive: Boolean(row.is_active),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rawAliases(value: unknown): MriSequenceScannerAliasRow[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = item as RawRecord;
    return {
      id: Number(row.id),
      mriSequencePresetId: Number(row.mri_sequence_preset_id),
      scannerId: Number(row.scanner_id),
      scannerName: stringOrNull(row.scanner_name),
      vendorSequenceName: String(row.vendor_sequence_name),
      notes: stringOrNull(row.notes),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  });
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
    oralContrastPolicy: stringOrNull(row.oral_contrast_policy),
    bowelPreparation: stringOrNull(row.bowel_preparation),
    preparationNotes: stringOrNull(row.preparation_notes),
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
    protocolNotes: stringOrNull(row.protocol_notes),
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
    presetContrastStatus: stringOrNull(row.preset_contrast_status),
    presetTimingType: stringOrNull(row.preset_timing_type),
    presetDelaySeconds: numberOrNull(row.preset_delay_seconds),
    presetBolusTrackingSite: stringOrNull(row.preset_bolus_tracking_site),
    presetTriggerHu: numberOrNull(row.preset_trigger_hu),
    presetDefaultCoverage: stringOrNull(row.preset_default_coverage),
    presetReconstructionNotes: stringOrNull(row.preset_reconstruction_notes),
    presetInstructions: stringOrNull(row.preset_instructions),
    customPhaseName: stringOrNull(row.custom_phase_name),
    timingOverride: stringOrNull(row.timing_override),
    timingType: row.timing_type == null ? null : String(row.timing_type) as ProtocolCtPhaseRow["timingType"],
    delaySeconds: numberOrNull(row.delay_seconds),
    bolusTrackingSite: stringOrNull(row.bolus_tracking_site),
    triggerHu: numberOrNull(row.trigger_hu),
    postTriggerDelaySeconds: numberOrNull(row.post_trigger_delay_seconds),
    coverageOverride: stringOrNull(row.coverage_override),
    reconstructionOverride: stringOrNull(row.reconstruction_override),
    instructionsOverride: stringOrNull(row.instructions_override),
    isRequired: Boolean(row.is_required),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapProtocolCtTechnique(row: RawRecord): ProtocolCtTechniqueRow {
  return {
    id: Number(row.id), protocolVersionId: Number(row.protocol_version_id), scannerId: Number(row.scanner_id),
    scannerName: stringOrNull(row.scanner_name), scannerVendor: stringOrNull(row.scanner_vendor), scannerModel: stringOrNull(row.scanner_model),
    kvMode: row.kv_mode == null ? null : String(row.kv_mode) as ProtocolCtTechniqueRow["kvMode"], kvp: numberOrNull(row.kvp),
    tubeCurrentMode: row.tube_current_mode == null ? null : String(row.tube_current_mode) as ProtocolCtTechniqueRow["tubeCurrentMode"],
    fixedMa: numberOrNull(row.fixed_ma), referenceMas: numberOrNull(row.reference_mas), exposureControl: stringOrNull(row.exposure_control),
    noiseIndex: numberOrNull(row.noise_index), minMa: numberOrNull(row.min_ma), maxMa: numberOrNull(row.max_ma),
    reconstructionMethod: stringOrNull(row.reconstruction_method), reconstructionStrength: stringOrNull(row.reconstruction_strength),
    reconstructionImageDefinition: stringOrNull(row.reconstruction_image_definition), sliceThicknessMm: numberOrNull(row.slice_thickness_mm),
    reconstructionIntervalMm: numberOrNull(row.reconstruction_interval_mm), kernel: stringOrNull(row.kernel),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
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
    presetGenericFamily: stringOrNull(row.preset_generic_family),
    presetWeighting: stringOrNull(row.preset_weighting),
    presetDefaultPlane: stringOrNull(row.preset_default_plane),
    presetFatSuppression: stringOrNull(row.preset_fat_suppression),
    presetAcquisitionType: stringOrNull(row.preset_acquisition_type),
    presetContrastRelation: stringOrNull(row.preset_contrast_relation),
    scannerAliasVendorSequenceName: stringOrNull(row.scanner_alias_vendor_sequence_name),
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
    select id, name, modality, vendor, model, field_strength, ct_slice_detector_specification, location, is_active, notes, created_at, updated_at
    from equipment
    where equipment_type in ('CT', 'MRI')
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
    select msp.id, msp.sequence_key, msp.scanner_id, s.name as scanner_name, msp.vendor, msp.name, msp.vendor_sequence_name,
           msp.generic_family, msp.weighting, msp.default_plane, msp.fat_suppression, msp.acquisition_type,
           msp.contrast_relation, msp.default_coverage,
           msp.default_b_values, msp.default_dynamic_timing, msp.estimated_scan_time_minutes, msp.notes,
           msp.is_active, msp.created_at, msp.updated_at,
           coalesce(aliases.items, '[]'::json) as scanner_aliases
    from mri_sequence_presets msp
    left join equipment s on s.id = msp.scanner_id
    left join lateral (
      select json_agg(json_build_object(
        'id', alias.id,
        'mri_sequence_preset_id', alias.mri_sequence_preset_id,
        'scanner_id', alias.scanner_id,
        'scanner_name', alias_scanner.name,
        'vendor_sequence_name', alias.vendor_sequence_name,
        'notes', alias.notes,
        'created_at', alias.created_at,
        'updated_at', alias.updated_at
      ) order by alias_scanner.name asc, alias.id asc) as items
      from mri_sequence_scanner_aliases alias
      left join equipment alias_scanner on alias_scanner.id = alias.scanner_id
      where alias.mri_sequence_preset_id = msp.id
    ) aliases on true
    order by msp.is_active desc, coalesce(s.name, ''), msp.name asc
  `);
  return result.rows.map(mapMriSequencePreset);
}

export async function listProtocols(): Promise<ProtocolLibraryProtocolRow[]> {
  const result = await pool.query(`
    select p.id, p.name, p.modality, p.anatomy_region_id, ar.name as anatomy_region_name,
           p.category, p.indication, p.contrast_policy, p.oral_contrast_policy, p.bowel_preparation, p.preparation_notes, p.active_version_id,
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

async function replaceMriSequenceScannerAliases(client: DbClient, presetId: number, aliases: MriSequenceScannerAliasInput[]): Promise<void> {
  await client.query("delete from mri_sequence_scanner_aliases where mri_sequence_preset_id = $1", [presetId]);
  for (const alias of aliases) {
    await client.query(
      `
        insert into mri_sequence_scanner_aliases (mri_sequence_preset_id, scanner_id, vendor_sequence_name, notes)
        values ($1, $2, $3, $4)
      `,
      [presetId, alias.scannerId, alias.vendorSequenceName, alias.notes]
    );
  }
}

export async function createMriSequencePreset(input: MriSequencePresetInput): Promise<MriSequencePresetRow> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await client.query(
    `
      insert into mri_sequence_presets (
        scanner_id, vendor, name, vendor_sequence_name, generic_family, weighting, default_plane,
        fat_suppression, acquisition_type, contrast_relation, default_coverage, default_b_values, default_dynamic_timing,
        estimated_scan_time_minutes, notes, is_active
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      returning id
    `,
    [
      input.scannerId,
      input.vendor,
      input.name,
      input.vendorSequenceName,
      input.genericFamily,
      input.weighting,
      input.defaultPlane,
      input.fatSuppression,
      input.acquisitionType,
      input.contrastRelation,
      input.defaultCoverage,
      input.defaultBValues,
      input.defaultDynamicTiming,
      input.estimatedScanTimeMinutes,
      input.notes,
      input.isActive,
    ]
  );
    const id = Number(result.rows[0].id);
    if (input.scannerAliases) await replaceMriSequenceScannerAliases(client, id, input.scannerAliases);
    await client.query("commit");
    const rows = await listMriSequencePresets();
    return rows.find((row) => row.id === id)!;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateMriSequencePreset(id: number, input: Partial<MriSequencePresetInput>): Promise<MriSequencePresetRow | null> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await client.query(
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
        fat_suppression = case when $15::boolean then $16 else fat_suppression end,
        acquisition_type = case when $17::boolean then $18 else acquisition_type end,
        contrast_relation = case when $19::boolean then $20 else contrast_relation end,
        default_coverage = case when $21::boolean then $22 else default_coverage end,
        default_b_values = case when $23::boolean then $24 else default_b_values end,
        default_dynamic_timing = case when $25::boolean then $26 else default_dynamic_timing end,
        estimated_scan_time_minutes = case when $27::boolean then $28 else estimated_scan_time_minutes end,
        notes = case when $29::boolean then $30 else notes end,
        is_active = coalesce($31, is_active)
      where id = $1
      returning id
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
      "fatSuppression" in input,
      input.fatSuppression ?? null,
      "acquisitionType" in input,
      input.acquisitionType ?? null,
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
    if (!result.rows[0]) {
      await client.query("rollback");
      return null;
    }
    if ("scannerAliases" in input && input.scannerAliases) await replaceMriSequenceScannerAliases(client, id, input.scannerAliases);
    await client.query("commit");
    const rows = await listMriSequencePresets();
    return rows.find((row) => row.id === id) ?? null;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function protocolById(client: DbClient, protocolId: number): Promise<ProtocolLibraryProtocolRow | null> {
  const result = await client.query(
    `
      select p.id, p.name, p.modality, p.anatomy_region_id, ar.name as anatomy_region_name,
             p.category, p.indication, p.contrast_policy, p.oral_contrast_policy, p.bowel_preparation, p.preparation_notes, p.active_version_id,
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
      select id, protocol_id, version_number, status, change_summary, protocol_notes, created_by, approved_by,
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
             cpp.name as ct_phase_preset_name, cpp.contrast_status as preset_contrast_status, cpp.timing_type as preset_timing_type,
             cpp.delay_seconds as preset_delay_seconds, cpp.bolus_tracking_site as preset_bolus_tracking_site,
             cpp.trigger_hu as preset_trigger_hu, cpp.default_coverage as preset_default_coverage,
             cpp.reconstruction_notes as preset_reconstruction_notes, cpp.instructions as preset_instructions,
             pcp.custom_phase_name, pcp.timing_override, pcp.timing_type,
             pcp.delay_seconds, pcp.bolus_tracking_site, pcp.trigger_hu, pcp.post_trigger_delay_seconds,
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

async function ctTechniquesForVersion(client: DbClient, versionId: number): Promise<ProtocolCtTechniqueRow[]> {
  const result = await client.query(`
    select technique.*, scanner.name as scanner_name, scanner.vendor as scanner_vendor, scanner.model as scanner_model
    from protocol_ct_techniques technique
    join equipment scanner on scanner.id = technique.scanner_id
    where technique.protocol_version_id = $1
    order by scanner.name asc, technique.id asc
  `, [versionId]);
  return result.rows.map(mapProtocolCtTechnique);
}

async function mriSequencesForVersion(client: DbClient, versionId: number): Promise<ProtocolMriSequenceRow[]> {
  const result = await client.query(
    `
      select pms.id, pms.protocol_version_id, pms.scanner_id, s.name as scanner_name,
             pms.order_index, pms.mri_sequence_preset_id, msp.name as mri_sequence_preset_name,
             msp.generic_family as preset_generic_family, msp.weighting as preset_weighting,
             msp.default_plane as preset_default_plane, msp.fat_suppression as preset_fat_suppression,
             msp.acquisition_type as preset_acquisition_type, msp.contrast_relation as preset_contrast_relation,
             msa.vendor_sequence_name as scanner_alias_vendor_sequence_name,
             pms.plane_override, pms.coverage_override, pms.b_values_override, pms.timing_override,
             pms.notes_override, pms.is_required, pms.created_at, pms.updated_at
      from protocol_mri_sequences pms
      left join equipment s on s.id = pms.scanner_id
      left join mri_sequence_presets msp on msp.id = pms.mri_sequence_preset_id
      left join mri_sequence_scanner_aliases msa on msa.mri_sequence_preset_id = msp.id and msa.scanner_id = pms.scanner_id
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
      select id, protocol_id, version_number, status, change_summary, protocol_notes, created_by, approved_by,
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
    ctTechniques: await ctTechniquesForVersion(pool, versionId),
  };
}

export async function createProtocolWithDraft(input: ProtocolInput, actorUserId: number | null): Promise<{ protocol: ProtocolLibraryProtocolRow; version: ProtocolVersionRow }> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const protocolResult = await client.query(
      `
        insert into protocols (
          name, modality, anatomy_region_id, category, indication, contrast_policy,
          oral_contrast_policy, bowel_preparation, preparation_notes, is_active
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
        returning id
      `,
      [
        input.name,
        input.modality,
        input.anatomyRegionId,
        input.category,
        input.indication,
        input.contrastPolicy,
        input.oralContrastPolicy,
        input.bowelPreparation,
        input.preparationNotes,
      ]
    );
    const protocolId = Number(protocolResult.rows[0].id);
    const versionResult = await client.query(
      `
        insert into protocol_versions (protocol_id, version_number, status, change_summary, protocol_notes, created_by)
        values ($1, '1.0', 'DRAFT', $2, $3, $4)
        returning id, protocol_id, version_number, status, change_summary, protocol_notes, created_by, approved_by,
                  approved_at, retired_at, created_at, updated_at
      `,
      [protocolId, input.changeSummary || "Initial protocol version", input.protocolNotes, actorUserId]
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
        oral_contrast_policy = case when $11::boolean then $12 else oral_contrast_policy end,
        bowel_preparation = case when $13::boolean then $14 else bowel_preparation end,
        preparation_notes = case when $15::boolean then $16 else preparation_notes end,
        is_active = coalesce($17, is_active)
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
      "oralContrastPolicy" in input,
      input.oralContrastPolicy ?? null,
      "bowelPreparation" in input,
      input.bowelPreparation ?? null,
      "preparationNotes" in input,
      input.preparationNotes ?? null,
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

export async function updateProtocolVersion(versionId: number, input: { changeSummary?: string | null; protocolNotes?: string | null }): Promise<ProtocolVersionRow | null> {
  const { version } = await versionContext(pool, versionId);
  assertDraft(version);
  const result = await pool.query(
    `
      update protocol_versions
      set change_summary = case when $2::boolean then $3 else change_summary end,
          protocol_notes = case when $4::boolean then $5 else protocol_notes end
      where id = $1
      returning id, protocol_id, version_number, status, change_summary, protocol_notes, created_by, approved_by,
                approved_at, retired_at, created_at, updated_at
    `,
    [versionId, "changeSummary" in input, input.changeSummary ?? null, "protocolNotes" in input, input.protocolNotes ?? null]
  );
  return result.rows[0] ? mapVersion(result.rows[0]) : null;
}

async function nextOrder(client: DbClient, table: "protocol_ct_phases" | "protocol_mri_sequences", versionId: number): Promise<number> {
  const result = await client.query(`select coalesce(max(order_index), 0)::int + 1 as next_order from ${table} where protocol_version_id = $1`, [versionId]);
  return Number(result.rows[0].next_order);
}

function validateCtPhaseTiming(input: Partial<ProtocolCtPhaseInput>) {
  if (!("timingType" in input)) return;
  if (!input.timingType) throw new HttpError(400, "timingType is required.");
  if ((input.timingType === "FIXED_DELAY_INJECTION_START" || input.timingType === "FIXED_DELAY_INJECTION_END") && (input.delaySeconds == null || input.delaySeconds < 0)) {
    throw new HttpError(400, "delaySeconds is required for fixed-delay timing.");
  }
  if (input.timingType === "BOLUS_TRACKING" && (!input.bolusTrackingSite || input.triggerHu == null || input.triggerHu < 0)) {
    throw new HttpError(400, "bolusTrackingSite and triggerHu are required for bolus tracking.");
  }
  if (input.timingType === "MANUAL" && !input.timingOverride) throw new HttpError(400, "timingOverride is required for manual timing.");
}

export async function addProtocolCtPhase(versionId: number, input: ProtocolCtPhaseInput): Promise<ProtocolCtPhaseRow> {
  const { version, protocol } = await versionContext(pool, versionId);
  assertDraft(version);
  if (protocol.modality !== "CT") throw new HttpError(400, "CT phase rows can only be added to CT protocol versions.");
  if (!input.customPhaseName?.trim()) throw new HttpError(400, "customPhaseName is required for CT phases.");
  if (input.ctPhasePresetId == null && !input.coverageOverride?.trim()) throw new HttpError(400, "coverageOverride is required for direct CT phases.");
  validateCtPhaseTiming(input);
  const orderIndex = await nextOrder(pool, "protocol_ct_phases", versionId);
  const result = await pool.query(
    `
      insert into protocol_ct_phases (
        protocol_version_id, order_index, ct_phase_preset_id, custom_phase_name, timing_override, timing_type,
        delay_seconds, bolus_tracking_site, trigger_hu, post_trigger_delay_seconds,
        coverage_override, reconstruction_override, instructions_override, is_required
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      returning id, protocol_version_id, order_index, ct_phase_preset_id, null::text as ct_phase_preset_name,
                custom_phase_name, timing_override, timing_type, delay_seconds, bolus_tracking_site, trigger_hu, post_trigger_delay_seconds, coverage_override, reconstruction_override,
                instructions_override, is_required, created_at, updated_at
    `,
    [versionId, orderIndex, input.ctPhasePresetId, input.customPhaseName, input.timingOverride, input.timingType, input.delaySeconds, input.bolusTrackingSite, input.triggerHu, input.postTriggerDelaySeconds, input.coverageOverride, input.reconstructionOverride, input.instructionsOverride, input.isRequired]
  );
  return mapProtocolCtPhase(result.rows[0]);
}

export async function updateProtocolCtPhase(versionId: number, rowId: number, input: Partial<ProtocolCtPhaseInput>): Promise<ProtocolCtPhaseRow | null> {
  const { version, protocol } = await versionContext(pool, versionId);
  assertDraft(version);
  if (protocol.modality !== "CT") throw new HttpError(400, "CT phase rows can only be added to CT protocol versions.");
  validateCtPhaseTiming(input);
  const result = await pool.query(
    `
      update protocol_ct_phases
      set
        ct_phase_preset_id = case when $3::boolean then $4 else ct_phase_preset_id end,
        custom_phase_name = case when $5::boolean then $6 else custom_phase_name end,
        timing_override = case when $7::boolean then $8 else timing_override end,
        timing_type = case when $9::boolean then $10 else timing_type end,
        delay_seconds = case when $11::boolean then $12 else delay_seconds end,
        bolus_tracking_site = case when $13::boolean then $14 else bolus_tracking_site end,
        trigger_hu = case when $15::boolean then $16 else trigger_hu end,
        post_trigger_delay_seconds = case when $17::boolean then $18 else post_trigger_delay_seconds end,
        coverage_override = case when $19::boolean then $20 else coverage_override end,
        reconstruction_override = case when $21::boolean then $22 else reconstruction_override end,
        instructions_override = case when $23::boolean then $24 else instructions_override end,
        is_required = coalesce($25, is_required)
      where protocol_version_id = $1 and id = $2
      returning id, protocol_version_id, order_index, ct_phase_preset_id, null::text as ct_phase_preset_name,
                custom_phase_name, timing_override, timing_type, delay_seconds, bolus_tracking_site, trigger_hu, post_trigger_delay_seconds, coverage_override, reconstruction_override,
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
      "timingType" in input, input.timingType ?? null,
      "delaySeconds" in input, input.delaySeconds ?? null,
      "bolusTrackingSite" in input, input.bolusTrackingSite ?? null,
      "triggerHu" in input, input.triggerHu ?? null,
      "postTriggerDelaySeconds" in input, input.postTriggerDelaySeconds ?? null,
      "coverageOverride" in input, input.coverageOverride ?? null,
      "reconstructionOverride" in input, input.reconstructionOverride ?? null,
      "instructionsOverride" in input, input.instructionsOverride ?? null,
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

function nextDraftVersionNumber(versionNumber: string, revisionType: "MINOR" | "MAJOR"): string {
  const [majorText, minorText] = versionNumber.split(".");
  const major = Number(majorText);
  const minor = Number(minorText ?? "0");
  if (!Number.isInteger(major) || !Number.isInteger(minor)) throw new HttpError(400, "Active protocol version number is invalid.");
  return revisionType === "MAJOR" ? `${major + 1}.0` : `${major}.${minor + 1}`;
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

export async function createDraftFromActiveVersion(protocolId: number, actorUserId: number | null, revisionType: "MINOR" | "MAJOR" = "MINOR"): Promise<ProtocolVersionDetail> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const protocol = await protocolById(client, protocolId);
    if (!protocol?.activeVersionId) throw new HttpError(400, "Protocol has no active version.");
    const activeVersion = await versionById(client, protocol.activeVersionId);
    if (!activeVersion) throw new HttpError(400, "Protocol has no active version.");
    const versionResult = await client.query(
      `
        insert into protocol_versions (protocol_id, version_number, status, change_summary, protocol_notes, created_by)
        values ($1, $2, 'DRAFT', $3, $4, $5)
        returning id, protocol_id, version_number, status, change_summary, protocol_notes, created_by, approved_by,
                  approved_at, retired_at, created_at, updated_at
      `,
      [protocolId, nextDraftVersionNumber(activeVersion.versionNumber, revisionType), `Draft from active ${activeVersion.versionNumber}`, activeVersion.protocolNotes, actorUserId]
    );
    const draft = mapVersion(versionResult.rows[0]);
    await client.query(
      `
        insert into protocol_ct_phases (
          protocol_version_id, order_index, ct_phase_preset_id, custom_phase_name, timing_override, timing_type,
          delay_seconds, bolus_tracking_site, trigger_hu, post_trigger_delay_seconds,
          coverage_override, reconstruction_override, instructions_override, is_required
        )
        select $1, order_index, ct_phase_preset_id, custom_phase_name, timing_override, timing_type,
               delay_seconds, bolus_tracking_site, trigger_hu, post_trigger_delay_seconds,
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
    if (protocol.modality === "CT") {
      await client.query(`
        insert into protocol_ct_techniques (
          protocol_version_id, scanner_id, kv_mode, kvp, tube_current_mode, fixed_ma, reference_mas,
          exposure_control, noise_index, min_ma, max_ma, reconstruction_method, reconstruction_strength,
          reconstruction_image_definition, slice_thickness_mm, reconstruction_interval_mm, kernel
        )
        select $1, scanner_id, kv_mode, kvp, tube_current_mode, fixed_ma, reference_mas,
               exposure_control, noise_index, min_ma, max_ma, reconstruction_method, reconstruction_strength,
               reconstruction_image_definition, slice_thickness_mm, reconstruction_interval_mm, kernel
        from protocol_ct_techniques where protocol_version_id = $2
      `, [draft.id, activeVersion.id]);
    }
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

export async function duplicateCtProtocolVersion(versionId: number, name: string, actorUserId: number | null): Promise<ProtocolVersionDetail> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const { version: sourceVersion, protocol: source } = await versionContext(client, versionId);
    if (source.modality !== "CT") throw new HttpError(400, "Only CT protocol versions can be duplicated.");
    const protocolResult = await client.query(`
      insert into protocols (name, modality, anatomy_region_id, category, indication, contrast_policy, oral_contrast_policy, bowel_preparation, preparation_notes, is_active)
      values ($1, 'CT', $2, $3, $4, $5, $6, $7, $8, true) returning id
    `, [name, source.anatomyRegionId, source.category, source.indication, source.contrastPolicy, source.oralContrastPolicy, source.bowelPreparation, source.preparationNotes]);
    const protocolId = Number(protocolResult.rows[0].id);
    const versionResult = await client.query(`
      insert into protocol_versions (protocol_id, version_number, status, change_summary, protocol_notes, created_by)
      values ($1, '1.0', 'DRAFT', 'Initial protocol version', $2, $3)
      returning id, protocol_id, version_number, status, change_summary, protocol_notes, created_by, approved_by, approved_at, retired_at, created_at, updated_at
    `, [protocolId, sourceVersion.protocolNotes, actorUserId]);
    const draft = mapVersion(versionResult.rows[0]);
    await client.query(`insert into protocol_ct_phases (protocol_version_id, order_index, ct_phase_preset_id, custom_phase_name, timing_override, timing_type, delay_seconds, bolus_tracking_site, trigger_hu, post_trigger_delay_seconds, coverage_override, reconstruction_override, instructions_override, is_required)
      select $1, order_index, ct_phase_preset_id, custom_phase_name, timing_override, timing_type, delay_seconds, bolus_tracking_site, trigger_hu, post_trigger_delay_seconds, coverage_override, reconstruction_override, instructions_override, is_required
      from protocol_ct_phases where protocol_version_id = $2`, [draft.id, sourceVersion.id]);
    await client.query(`insert into protocol_ct_techniques (protocol_version_id, scanner_id, kv_mode, kvp, tube_current_mode, fixed_ma, reference_mas, exposure_control, noise_index, min_ma, max_ma, reconstruction_method, reconstruction_strength, reconstruction_image_definition, slice_thickness_mm, reconstruction_interval_mm, kernel)
      select $1, scanner_id, kv_mode, kvp, tube_current_mode, fixed_ma, reference_mas, exposure_control, noise_index, min_ma, max_ma, reconstruction_method, reconstruction_strength, reconstruction_image_definition, slice_thickness_mm, reconstruction_interval_mm, kernel
      from protocol_ct_techniques where protocol_version_id = $2`, [draft.id, sourceVersion.id]);
    await client.query("commit");
    return (await getProtocolVersionDetail(draft.id))!;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally { client.release(); }
}

export async function upsertProtocolCtTechnique(versionId: number, input: ProtocolCtTechniqueInput): Promise<ProtocolCtTechniqueRow> {
  const { version, protocol } = await versionContext(pool, versionId);
  assertDraft(version);
  if (protocol.modality !== "CT") throw new HttpError(400, "CT techniques can only be added to CT protocol versions.");
  if (input.kvMode === "FIXED" && (input.kvp == null || input.kvp <= 0)) throw new HttpError(400, "kvp is required when kV mode is fixed.");
  if (input.tubeCurrentMode === "FIXED_MA" && (input.fixedMa == null || input.fixedMa <= 0)) throw new HttpError(400, "fixedMa is required when tube current mode is fixed.");
  if (input.tubeCurrentMode === "REFERENCE_MAS" && (input.referenceMas == null || input.referenceMas <= 0)) throw new HttpError(400, "referenceMas is required when tube current mode is reference mAs.");
  if (input.minMa != null && input.maxMa != null && input.minMa > input.maxMa) throw new HttpError(400, "minMa cannot exceed maxMa.");
  if (input.reconstructionMethod === "ASiR-V" && (!input.reconstructionStrength || !/^([0-9]|[1-9][0-9]|100)$/.test(input.reconstructionStrength))) throw new HttpError(400, "ASiR-V strength must be between 0 and 100.");
  const result = await pool.query(`
    insert into protocol_ct_techniques (protocol_version_id, scanner_id, kv_mode, kvp, tube_current_mode, fixed_ma, reference_mas, exposure_control, noise_index, min_ma, max_ma, reconstruction_method, reconstruction_strength, reconstruction_image_definition, slice_thickness_mm, reconstruction_interval_mm, kernel)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
    on conflict (protocol_version_id, scanner_id) do update set kv_mode=excluded.kv_mode, kvp=excluded.kvp, tube_current_mode=excluded.tube_current_mode, fixed_ma=excluded.fixed_ma, reference_mas=excluded.reference_mas, exposure_control=excluded.exposure_control, noise_index=excluded.noise_index, min_ma=excluded.min_ma, max_ma=excluded.max_ma, reconstruction_method=excluded.reconstruction_method, reconstruction_strength=excluded.reconstruction_strength, reconstruction_image_definition=excluded.reconstruction_image_definition, slice_thickness_mm=excluded.slice_thickness_mm, reconstruction_interval_mm=excluded.reconstruction_interval_mm, kernel=excluded.kernel
    returning id, protocol_version_id, scanner_id, null::text as scanner_name, null::text as scanner_vendor, null::text as scanner_model, kv_mode, kvp, tube_current_mode, fixed_ma, reference_mas, exposure_control, noise_index, min_ma, max_ma, reconstruction_method, reconstruction_strength, reconstruction_image_definition, slice_thickness_mm, reconstruction_interval_mm, kernel, created_at, updated_at
  `, [versionId, input.scannerId, input.kvMode, input.kvp, input.tubeCurrentMode, input.fixedMa, input.referenceMas, input.exposureControl, input.noiseIndex, input.minMa, input.maxMa, input.reconstructionMethod, input.reconstructionStrength, input.reconstructionImageDefinition, input.sliceThicknessMm, input.reconstructionIntervalMm, input.kernel]);
  return mapProtocolCtTechnique(result.rows[0]);
}

export async function removeProtocolCtTechnique(versionId: number, scannerId: number): Promise<void> {
  const { version, protocol } = await versionContext(pool, versionId);
  assertDraft(version);
  if (protocol.modality !== "CT") throw new HttpError(400, "CT techniques can only be removed from CT protocol versions.");
  await pool.query(`delete from protocol_ct_techniques where protocol_version_id = $1 and scanner_id = $2`, [versionId, scannerId]);
}
