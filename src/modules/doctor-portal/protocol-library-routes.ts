import { Router, type Request, type Response } from "express";
import { HttpError } from "../../utils/http-error.js";
import { asyncRoute } from "../../utils/async-route.js";
import type { AuthenticatedUserContext } from "../../types/http.js";
import { asOptionalString, asString } from "../../utils/request-coercion.js";
import { asUnknownRecord } from "../../utils/records.js";
import { getDoctorMe } from "./profile-service.js";
import {
  activateProtocolVersion,
  addProtocolCtPhase,
  addProtocolMriSequence,
  createCtPhasePreset,
  createDraftFromActiveVersion,
  createImagingScanner,
  createMriSequencePreset,
  createProtocolWithDraft,
  createProtocolAnatomyRegion,
  getProtocolDetail,
  getProtocolVersionDetail,
  listCtPhasePresets,
  listImagingScanners,
  listMriSequencePresets,
  listProtocolAnatomyRegions,
  listProtocols,
  removeProtocolCtPhase,
  removeProtocolMriSequence,
  reorderProtocolRows,
  updateCtPhasePreset,
  updateImagingScanner,
  updateMriSequencePreset,
  updateProtocol,
  updateProtocolCtPhase,
  updateProtocolMriSequence,
  updateProtocolVersion,
  updateProtocolAnatomyRegion,
} from "./protocol-library-repository.js";

const router = Router();

interface DoctorRequest extends Request {
  user?: AuthenticatedUserContext;
}

async function requireDoctorPortalAccess(req: DoctorRequest): Promise<void> {
  if (!req.user) throw new HttpError(401, "Authentication required.");
  const me = await getDoctorMe(req.user.sub, req.user.role);
  if (!me.canAccessDoctorPortal) {
    throw new HttpError(403, "Doctor Portal access is required.");
  }
}

async function requireProtocolLibraryAdminAccess(req: DoctorRequest): Promise<void> {
  if (!req.user) throw new HttpError(401, "Authentication required.");
  const me = await getDoctorMe(req.user.sub, req.user.role);
  if (!me.canAccessDoctorPortal) throw new HttpError(403, "Doctor Portal access is required.");
  if (
    req.user.role !== "super_admin" &&
    req.user.role !== "supervisor" &&
    !me.canSupervise &&
    !me.moduleCapabilities.includes("doctor_supervisor") &&
    !me.moduleCapabilities.includes("doctor_admin")
  ) {
    throw new HttpError(403, "Protocol Library administration access is required.");
  }
}

function positiveInteger(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new HttpError(400, `${field} must be a positive integer.`);
  return parsed;
}

function optionalPositiveInteger(value: unknown, field: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  return positiveInteger(value, field);
}

function optionalNonNegativeInteger(value: unknown, field: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new HttpError(400, `${field} must be a non-negative number.`);
  return parsed;
}

function optionalPositiveNumber(value: unknown, field: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new HttpError(400, `${field} must be positive.`);
  return parsed;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new HttpError(400, `${field} must be true or false.`);
}

function requiredBoolean(value: unknown, defaultValue: boolean): boolean {
  return optionalBoolean(value, "isActive") ?? defaultValue;
}

function requiredText(value: unknown, field: string): string {
  const text = asString(value).trim();
  if (!text) throw new HttpError(400, `${field} is required.`);
  return text;
}

function optionalText(value: unknown): string | null {
  const text = asOptionalString(value)?.trim();
  return text ? text : null;
}

const PROTOCOL_CATEGORIES = ["General", "Oncology", "Non-oncology"] as const;
const IV_CONTRAST_POLICIES = ["Non-contrast", "With IV contrast", "Without and with IV contrast", "Dynamic contrast", "Conditional / radiologist decision"] as const;
const MRI_SEQUENCE_PLANES = ["Axial", "Sagittal", "Coronal", "Oblique axial", "Oblique coronal", "3D / isotropic", "Other"] as const;
const MRI_SEQUENCE_FAMILIES = ["T1", "T2", "PD", "FLAIR", "DWI / ADC", "SWI / T2*", "Perfusion", "Dynamic contrast", "MRCP", "MRA / TOF", "Localizer", "Other"] as const;
const MRI_FAT_SUPPRESSION = ["None", "Fat saturated", "Dixon", "STIR", "SPAIR / SPIR", "Other"] as const;
const MRI_ACQUISITION_TYPES = ["2D", "3D", "Not specified"] as const;
const MRI_CONTRAST_RELATIONS = ["Non-contrast", "Pre-contrast", "Post-contrast", "Dynamic", "Optional / depends on protocol"] as const;

function oneOf<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  const parsed = String(value ?? "");
  if (!allowed.includes(parsed as T)) throw new HttpError(400, `${field} is invalid.`);
  return parsed as T;
}

function optionalOneOf<T extends string>(value: unknown, field: string, allowed: readonly T[]): T | undefined {
  if (value === undefined) return undefined;
  return oneOf(value, field, allowed);
}

function maybe<T>(body: Record<string, unknown>, key: string, parser: (value: unknown) => T): T | undefined {
  return key in body ? parser(body[key]) : undefined;
}

function maybeEither<T>(body: Record<string, unknown>, firstKey: string, secondKey: string, parser: (value: unknown) => T): T | undefined {
  if (firstKey in body) return parser(body[firstKey]);
  if (secondKey in body) return parser(body[secondKey]);
  return undefined;
}

function requireFound<T>(record: T | null, message: string): T {
  if (!record) throw new HttpError(404, message);
  return record;
}

function actorUserId(req: DoctorRequest): number | null {
  const userId = req.user?.sub;
  const parsed = Number(userId);
  return Number.isInteger(parsed) ? parsed : null;
}

function protocolInput(body: Record<string, unknown>) {
  return {
    name: requiredText(body.name, "name"),
    modality: oneOf(body.modality, "modality", ["CT", "MRI"] as const),
    anatomyRegionId: optionalPositiveInteger(body.anatomyRegionId ?? body.anatomy_region_id, "anatomyRegionId"),
    category: body.category == null || body.category === "" ? null : oneOf(body.category, "category", PROTOCOL_CATEGORIES),
    indication: optionalText(body.indication),
    contrastPolicy: body.contrastPolicy == null && body.contrast_policy == null ? null : oneOf(body.contrastPolicy ?? body.contrast_policy, "contrastPolicy", IV_CONTRAST_POLICIES),
    oralContrastPolicy: optionalText(body.oralContrastPolicy ?? body.oral_contrast_policy),
    bowelPreparation: optionalText(body.bowelPreparation ?? body.bowel_preparation),
    preparationNotes: optionalText(body.preparationNotes ?? body.preparation_notes),
    changeSummary: optionalText(body.changeSummary ?? body.change_summary) ?? "Initial protocol version",
  };
}

function protocolPatch(body: Record<string, unknown>) {
  return {
    name: maybe(body, "name", (value) => requiredText(value, "name")),
    anatomyRegionId: maybeEither(body, "anatomyRegionId", "anatomy_region_id", (value) => optionalPositiveInteger(value, "anatomyRegionId")),
    category: maybe(body, "category", (value) => value == null || value === "" ? null : oneOf(value, "category", PROTOCOL_CATEGORIES)),
    indication: maybe(body, "indication", optionalText),
    contrastPolicy: maybeEither(body, "contrastPolicy", "contrast_policy", (value) => value == null || value === "" ? null : oneOf(value, "contrastPolicy", IV_CONTRAST_POLICIES)),
    oralContrastPolicy: maybeEither(body, "oralContrastPolicy", "oral_contrast_policy", optionalText),
    bowelPreparation: maybeEither(body, "bowelPreparation", "bowel_preparation", optionalText),
    preparationNotes: maybeEither(body, "preparationNotes", "preparation_notes", optionalText),
    isActive: optionalBoolean(body.isActive ?? body.is_active, "isActive"),
  };
}

function optionalDropdown<T extends string>(value: unknown, field: string, allowed: readonly T[]): T | null {
  if (value === null || value === undefined || value === "") return null;
  return oneOf(value, field, allowed);
}

function mriSequenceAliases(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null) return [];
  if (!Array.isArray(value)) throw new HttpError(400, "scannerAliases must be an array.");
  return value.map((item, index) => {
    const alias = asUnknownRecord(item);
    return {
      scannerId: positiveInteger(alias.scannerId ?? alias.scanner_id, `scannerAliases[${index}].scannerId`),
      vendorSequenceName: requiredText(alias.vendorSequenceName ?? alias.vendor_sequence_name, `scannerAliases[${index}].vendorSequenceName`),
      notes: optionalText(alias.notes),
    };
  });
}

function maybeMriSequenceAliases(body: Record<string, unknown>) {
  if ("scannerAliases" in body) return mriSequenceAliases(body.scannerAliases);
  if ("scanner_aliases" in body) return mriSequenceAliases(body.scanner_aliases);
  return undefined;
}

function ctPhaseRowInput(body: Record<string, unknown>) {
  return {
    ctPhasePresetId: optionalPositiveInteger(body.ctPhasePresetId ?? body.ct_phase_preset_id, "ctPhasePresetId"),
    customPhaseName: optionalText(body.customPhaseName ?? body.custom_phase_name),
    timingOverride: optionalText(body.timingOverride ?? body.timing_override),
    coverageOverride: optionalText(body.coverageOverride ?? body.coverage_override),
    reconstructionOverride: optionalText(body.reconstructionOverride ?? body.reconstruction_override),
    instructionsOverride: optionalText(body.instructionsOverride ?? body.instructions_override),
    isRequired: requiredBoolean(body.isRequired ?? body.is_required, true),
  };
}

function ctPhaseRowPatch(body: Record<string, unknown>) {
  return {
    ctPhasePresetId: maybeEither(body, "ctPhasePresetId", "ct_phase_preset_id", (value) => optionalPositiveInteger(value, "ctPhasePresetId")),
    customPhaseName: maybeEither(body, "customPhaseName", "custom_phase_name", optionalText),
    timingOverride: maybeEither(body, "timingOverride", "timing_override", optionalText),
    coverageOverride: maybeEither(body, "coverageOverride", "coverage_override", optionalText),
    reconstructionOverride: maybeEither(body, "reconstructionOverride", "reconstruction_override", optionalText),
    instructionsOverride: maybeEither(body, "instructionsOverride", "instructions_override", optionalText),
    isRequired: optionalBoolean(body.isRequired ?? body.is_required, "isRequired"),
  };
}

function mriSequenceRowInput(body: Record<string, unknown>) {
  return {
    scannerId: optionalPositiveInteger(body.scannerId ?? body.scanner_id, "scannerId"),
    mriSequencePresetId: optionalPositiveInteger(body.mriSequencePresetId ?? body.mri_sequence_preset_id, "mriSequencePresetId"),
    planeOverride: optionalText(body.planeOverride ?? body.plane_override),
    coverageOverride: optionalText(body.coverageOverride ?? body.coverage_override),
    bValuesOverride: optionalText(body.bValuesOverride ?? body.b_values_override),
    timingOverride: optionalText(body.timingOverride ?? body.timing_override),
    notesOverride: optionalText(body.notesOverride ?? body.notes_override),
    isRequired: requiredBoolean(body.isRequired ?? body.is_required, true),
  };
}

function mriSequenceRowPatch(body: Record<string, unknown>) {
  return {
    scannerId: maybeEither(body, "scannerId", "scanner_id", (value) => optionalPositiveInteger(value, "scannerId")),
    mriSequencePresetId: maybeEither(body, "mriSequencePresetId", "mri_sequence_preset_id", (value) => optionalPositiveInteger(value, "mriSequencePresetId")),
    planeOverride: maybeEither(body, "planeOverride", "plane_override", optionalText),
    coverageOverride: maybeEither(body, "coverageOverride", "coverage_override", optionalText),
    bValuesOverride: maybeEither(body, "bValuesOverride", "b_values_override", optionalText),
    timingOverride: maybeEither(body, "timingOverride", "timing_override", optionalText),
    notesOverride: maybeEither(body, "notesOverride", "notes_override", optionalText),
    isRequired: optionalBoolean(body.isRequired ?? body.is_required, "isRequired"),
  };
}

function rowIds(body: Record<string, unknown>): number[] {
  const value = body.rowIds ?? body.row_ids;
  if (!Array.isArray(value)) throw new HttpError(400, "rowIds must be an array.");
  return value.map((item) => positiveInteger(item, "rowId"));
}

router.get(
  "/anatomy-regions",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    await requireDoctorPortalAccess(req);
    res.json({ anatomyRegions: await listProtocolAnatomyRegions() });
  })
);

router.post(
  "/anatomy-regions",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    await requireProtocolLibraryAdminAccess(req);
    const body = asUnknownRecord(req.body);
    const anatomyRegion = await createProtocolAnatomyRegion({
      name: requiredText(body.name, "name"),
      bodySystem: optionalText(body.bodySystem ?? body.body_system),
      modalityScope: oneOf(body.modalityScope ?? body.modality_scope, "modalityScope", ["CT", "MRI", "BOTH"] as const),
      defaultCoverageNote: optionalText(body.defaultCoverageNote ?? body.default_coverage_note),
      isActive: requiredBoolean(body.isActive ?? body.is_active, true),
    });
    res.status(201).json({ anatomyRegion });
  })
);

router.patch(
  "/anatomy-regions/:id",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    await requireProtocolLibraryAdminAccess(req);
    const body = asUnknownRecord(req.body);
    const anatomyRegion = await updateProtocolAnatomyRegion(positiveInteger(req.params.id, "region id"), {
      name: maybe(body, "name", (value) => requiredText(value, "name")),
      bodySystem: maybeEither(body, "bodySystem", "body_system", optionalText),
      modalityScope: maybeEither(body, "modalityScope", "modality_scope", (value) => oneOf(value, "modalityScope", ["CT", "MRI", "BOTH"] as const)),
      defaultCoverageNote: maybeEither(body, "defaultCoverageNote", "default_coverage_note", optionalText),
      isActive: optionalBoolean(body.isActive ?? body.is_active, "isActive"),
    });
    res.json({ anatomyRegion: requireFound(anatomyRegion, "Anatomy region not found.") });
  })
);

router.get(
  "/scanners",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    await requireDoctorPortalAccess(req);
    res.json({ scanners: await listImagingScanners() });
  })
);

router.post(
  "/scanners",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    await requireProtocolLibraryAdminAccess(req);
    const body = asUnknownRecord(req.body);
    const scanner = await createImagingScanner({
      name: requiredText(body.name, "name"),
      modality: oneOf(body.modality, "modality", ["CT", "MRI"] as const),
      vendor: optionalText(body.vendor),
      model: optionalText(body.model),
      fieldStrength: optionalText(body.fieldStrength ?? body.field_strength),
      ctSliceDetectorSpecification: optionalText(body.ctSliceDetectorSpecification ?? body.ct_slice_detector_specification),
      location: optionalText(body.location),
      notes: optionalText(body.notes),
      isActive: requiredBoolean(body.isActive ?? body.is_active, true),
    });
    res.status(201).json({ scanner });
  })
);

router.patch(
  "/scanners/:id",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    await requireProtocolLibraryAdminAccess(req);
    const body = asUnknownRecord(req.body);
    const scanner = await updateImagingScanner(positiveInteger(req.params.id, "scanner id"), {
      name: maybe(body, "name", (value) => requiredText(value, "name")),
      modality: optionalOneOf(body.modality, "modality", ["CT", "MRI"] as const),
      vendor: maybe(body, "vendor", optionalText),
      model: maybe(body, "model", optionalText),
      fieldStrength: maybeEither(body, "fieldStrength", "field_strength", optionalText),
      ctSliceDetectorSpecification: maybeEither(body, "ctSliceDetectorSpecification", "ct_slice_detector_specification", optionalText),
      location: maybe(body, "location", optionalText),
      notes: maybe(body, "notes", optionalText),
      isActive: optionalBoolean(body.isActive ?? body.is_active, "isActive"),
    });
    res.json({ scanner: requireFound(scanner, "Scanner not found.") });
  })
);

router.get(
  "/ct-phase-presets",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    await requireDoctorPortalAccess(req);
    res.json({ ctPhasePresets: await listCtPhasePresets() });
  })
);

router.post(
  "/ct-phase-presets",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    await requireProtocolLibraryAdminAccess(req);
    const body = asUnknownRecord(req.body);
    const ctPhasePreset = await createCtPhasePreset({
      name: requiredText(body.name, "name"),
      contrastStatus: oneOf(body.contrastStatus ?? body.contrast_status, "contrastStatus", ["NON_CONTRAST", "POST_CONTRAST", "DELAYED", "OTHER"] as const),
      timingType: oneOf(body.timingType ?? body.timing_type, "timingType", ["NONE", "FIXED_DELAY", "BOLUS_TRACKING", "MANUAL"] as const),
      delaySeconds: optionalNonNegativeInteger(body.delaySeconds ?? body.delay_seconds, "delaySeconds"),
      bolusTrackingSite: optionalText(body.bolusTrackingSite ?? body.bolus_tracking_site),
      triggerHu: optionalNonNegativeInteger(body.triggerHu ?? body.trigger_hu, "triggerHu"),
      defaultCoverage: optionalText(body.defaultCoverage ?? body.default_coverage),
      reconstructionNotes: optionalText(body.reconstructionNotes ?? body.reconstruction_notes),
      instructions: optionalText(body.instructions),
      isActive: requiredBoolean(body.isActive ?? body.is_active, true),
    });
    res.status(201).json({ ctPhasePreset });
  })
);

router.patch(
  "/ct-phase-presets/:id",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    await requireProtocolLibraryAdminAccess(req);
    const body = asUnknownRecord(req.body);
    const ctPhasePreset = await updateCtPhasePreset(positiveInteger(req.params.id, "CT phase preset id"), {
      name: maybe(body, "name", (value) => requiredText(value, "name")),
      contrastStatus: maybeEither(body, "contrastStatus", "contrast_status", (value) => oneOf(value, "contrastStatus", ["NON_CONTRAST", "POST_CONTRAST", "DELAYED", "OTHER"] as const)),
      timingType: maybeEither(body, "timingType", "timing_type", (value) => oneOf(value, "timingType", ["NONE", "FIXED_DELAY", "BOLUS_TRACKING", "MANUAL"] as const)),
      delaySeconds: maybeEither(body, "delaySeconds", "delay_seconds", (value) => optionalNonNegativeInteger(value, "delaySeconds")),
      bolusTrackingSite: maybeEither(body, "bolusTrackingSite", "bolus_tracking_site", optionalText),
      triggerHu: maybeEither(body, "triggerHu", "trigger_hu", (value) => optionalNonNegativeInteger(value, "triggerHu")),
      defaultCoverage: maybeEither(body, "defaultCoverage", "default_coverage", optionalText),
      reconstructionNotes: maybeEither(body, "reconstructionNotes", "reconstruction_notes", optionalText),
      instructions: maybe(body, "instructions", optionalText),
      isActive: optionalBoolean(body.isActive ?? body.is_active, "isActive"),
    });
    res.json({ ctPhasePreset: requireFound(ctPhasePreset, "CT phase preset not found.") });
  })
);

router.get(
  "/mri-sequence-presets",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    await requireDoctorPortalAccess(req);
    res.json({ mriSequencePresets: await listMriSequencePresets() });
  })
);

router.post(
  "/mri-sequence-presets",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    await requireProtocolLibraryAdminAccess(req);
    const body = asUnknownRecord(req.body);
    const mriSequencePreset = await createMriSequencePreset({
      scannerId: optionalPositiveInteger(body.scannerId ?? body.scanner_id, "scannerId"),
      vendor: optionalText(body.vendor),
      name: requiredText(body.name, "name"),
      vendorSequenceName: optionalText(body.vendorSequenceName ?? body.vendor_sequence_name),
      genericFamily: optionalText(body.genericFamily ?? body.generic_family),
      weighting: optionalDropdown(body.weighting, "weighting", MRI_SEQUENCE_FAMILIES),
      defaultPlane: optionalDropdown(body.defaultPlane ?? body.default_plane, "defaultPlane", MRI_SEQUENCE_PLANES),
      fatSuppression: optionalDropdown(body.fatSuppression ?? body.fat_suppression, "fatSuppression", MRI_FAT_SUPPRESSION),
      acquisitionType: optionalDropdown(body.acquisitionType ?? body.acquisition_type, "acquisitionType", MRI_ACQUISITION_TYPES),
      contrastRelation: optionalDropdown(body.contrastRelation ?? body.contrast_relation, "contrastRelation", MRI_CONTRAST_RELATIONS),
      defaultCoverage: optionalText(body.defaultCoverage ?? body.default_coverage),
      defaultBValues: optionalText(body.defaultBValues ?? body.default_b_values),
      defaultDynamicTiming: optionalText(body.defaultDynamicTiming ?? body.default_dynamic_timing),
      estimatedScanTimeMinutes: optionalPositiveNumber(body.estimatedScanTimeMinutes ?? body.estimated_scan_time_minutes, "estimatedScanTimeMinutes"),
      notes: optionalText(body.notes),
      scannerAliases: maybeMriSequenceAliases(body),
      isActive: requiredBoolean(body.isActive ?? body.is_active, true),
    });
    res.status(201).json({ mriSequencePreset });
  })
);

router.patch(
  "/mri-sequence-presets/:id",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    await requireProtocolLibraryAdminAccess(req);
    const body = asUnknownRecord(req.body);
    const mriSequencePreset = await updateMriSequencePreset(positiveInteger(req.params.id, "MRI sequence preset id"), {
      scannerId: maybeEither(body, "scannerId", "scanner_id", (value) => optionalPositiveInteger(value, "scannerId")),
      vendor: maybe(body, "vendor", optionalText),
      name: maybe(body, "name", (value) => requiredText(value, "name")),
      vendorSequenceName: maybeEither(body, "vendorSequenceName", "vendor_sequence_name", optionalText),
      genericFamily: maybeEither(body, "genericFamily", "generic_family", optionalText),
      weighting: maybe(body, "weighting", (value) => optionalDropdown(value, "weighting", MRI_SEQUENCE_FAMILIES)),
      defaultPlane: maybeEither(body, "defaultPlane", "default_plane", (value) => optionalDropdown(value, "defaultPlane", MRI_SEQUENCE_PLANES)),
      fatSuppression: maybeEither(body, "fatSuppression", "fat_suppression", (value) => optionalDropdown(value, "fatSuppression", MRI_FAT_SUPPRESSION)),
      acquisitionType: maybeEither(body, "acquisitionType", "acquisition_type", (value) => optionalDropdown(value, "acquisitionType", MRI_ACQUISITION_TYPES)),
      contrastRelation: maybeEither(body, "contrastRelation", "contrast_relation", (value) => optionalDropdown(value, "contrastRelation", MRI_CONTRAST_RELATIONS)),
      defaultCoverage: maybeEither(body, "defaultCoverage", "default_coverage", optionalText),
      defaultBValues: maybeEither(body, "defaultBValues", "default_b_values", optionalText),
      defaultDynamicTiming: maybeEither(body, "defaultDynamicTiming", "default_dynamic_timing", optionalText),
      estimatedScanTimeMinutes: maybeEither(body, "estimatedScanTimeMinutes", "estimated_scan_time_minutes", (value) => optionalPositiveNumber(value, "estimatedScanTimeMinutes")),
      notes: maybe(body, "notes", optionalText),
      scannerAliases: maybeMriSequenceAliases(body),
      isActive: optionalBoolean(body.isActive ?? body.is_active, "isActive"),
    });
    res.json({ mriSequencePreset: requireFound(mriSequencePreset, "MRI sequence preset not found.") });
  })
);

router.get(
  "/protocols/:id",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    await requireDoctorPortalAccess(req);
    const detail = await getProtocolDetail(positiveInteger(req.params.id, "protocol id"));
    res.json({ detail: requireFound(detail, "Protocol not found.") });
  })
);

router.post(
  "/protocols",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    await requireProtocolLibraryAdminAccess(req);
    const body = asUnknownRecord(req.body);
    const result = await createProtocolWithDraft(protocolInput(body), actorUserId(req));
    res.status(201).json(result);
  })
);

router.patch(
  "/protocols/:id",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    await requireProtocolLibraryAdminAccess(req);
    const body = asUnknownRecord(req.body);
    const protocol = await updateProtocol(positiveInteger(req.params.id, "protocol id"), protocolPatch(body));
    res.json({ protocol: requireFound(protocol, "Protocol not found.") });
  })
);

router.post(
  "/protocols/:id/draft-from-active",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    await requireProtocolLibraryAdminAccess(req);
    const detail = await createDraftFromActiveVersion(positiveInteger(req.params.id, "protocol id"), actorUserId(req));
    res.status(201).json({ detail });
  })
);

router.get(
  "/protocol-versions/:versionId",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    await requireDoctorPortalAccess(req);
    const detail = await getProtocolVersionDetail(positiveInteger(req.params.versionId, "version id"));
    res.json({ detail: requireFound(detail, "Protocol version not found.") });
  })
);

router.patch(
  "/protocol-versions/:versionId",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    await requireProtocolLibraryAdminAccess(req);
    const versionId = positiveInteger(req.params.versionId, "version id");
    const body = asUnknownRecord(req.body);
    const version = await updateProtocolVersion(versionId, {
      changeSummary: maybeEither(body, "changeSummary", "change_summary", optionalText),
    });
    requireFound(version, "Protocol version not found.");
    res.json({ detail: requireFound(await getProtocolVersionDetail(versionId), "Protocol version not found.") });
  })
);

router.post(
  "/protocol-versions/:versionId/activate",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    await requireProtocolLibraryAdminAccess(req);
    const detail = await activateProtocolVersion(positiveInteger(req.params.versionId, "version id"), actorUserId(req));
    res.json({ detail });
  })
);

router.post(
  "/protocol-versions/:versionId/ct-phases",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    await requireProtocolLibraryAdminAccess(req);
    const versionId = positiveInteger(req.params.versionId, "version id");
    await addProtocolCtPhase(versionId, ctPhaseRowInput(asUnknownRecord(req.body)));
    res.status(201).json({ detail: requireFound(await getProtocolVersionDetail(versionId), "Protocol version not found.") });
  })
);

router.patch(
  "/protocol-versions/:versionId/ct-phases/:rowId",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    await requireProtocolLibraryAdminAccess(req);
    const versionId = positiveInteger(req.params.versionId, "version id");
    const row = await updateProtocolCtPhase(versionId, positiveInteger(req.params.rowId, "row id"), ctPhaseRowPatch(asUnknownRecord(req.body)));
    requireFound(row, "CT phase row not found.");
    res.json({ detail: requireFound(await getProtocolVersionDetail(versionId), "Protocol version not found.") });
  })
);

router.delete(
  "/protocol-versions/:versionId/ct-phases/:rowId",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    await requireProtocolLibraryAdminAccess(req);
    const versionId = positiveInteger(req.params.versionId, "version id");
    await removeProtocolCtPhase(versionId, positiveInteger(req.params.rowId, "row id"));
    res.json({ detail: requireFound(await getProtocolVersionDetail(versionId), "Protocol version not found.") });
  })
);

router.post(
  "/protocol-versions/:versionId/ct-phases/reorder",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    await requireProtocolLibraryAdminAccess(req);
    const versionId = positiveInteger(req.params.versionId, "version id");
    await reorderProtocolRows(versionId, rowIds(asUnknownRecord(req.body)), "CT");
    res.json({ detail: requireFound(await getProtocolVersionDetail(versionId), "Protocol version not found.") });
  })
);

router.post(
  "/protocol-versions/:versionId/mri-sequences",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    await requireProtocolLibraryAdminAccess(req);
    const versionId = positiveInteger(req.params.versionId, "version id");
    await addProtocolMriSequence(versionId, mriSequenceRowInput(asUnknownRecord(req.body)));
    res.status(201).json({ detail: requireFound(await getProtocolVersionDetail(versionId), "Protocol version not found.") });
  })
);

router.patch(
  "/protocol-versions/:versionId/mri-sequences/:rowId",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    await requireProtocolLibraryAdminAccess(req);
    const versionId = positiveInteger(req.params.versionId, "version id");
    const row = await updateProtocolMriSequence(versionId, positiveInteger(req.params.rowId, "row id"), mriSequenceRowPatch(asUnknownRecord(req.body)));
    requireFound(row, "MRI sequence row not found.");
    res.json({ detail: requireFound(await getProtocolVersionDetail(versionId), "Protocol version not found.") });
  })
);

router.delete(
  "/protocol-versions/:versionId/mri-sequences/:rowId",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    await requireProtocolLibraryAdminAccess(req);
    const versionId = positiveInteger(req.params.versionId, "version id");
    await removeProtocolMriSequence(versionId, positiveInteger(req.params.rowId, "row id"));
    res.json({ detail: requireFound(await getProtocolVersionDetail(versionId), "Protocol version not found.") });
  })
);

router.post(
  "/protocol-versions/:versionId/mri-sequences/reorder",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    await requireProtocolLibraryAdminAccess(req);
    const versionId = positiveInteger(req.params.versionId, "version id");
    await reorderProtocolRows(versionId, rowIds(asUnknownRecord(req.body)), "MRI");
    res.json({ detail: requireFound(await getProtocolVersionDetail(versionId), "Protocol version not found.") });
  })
);

router.get(
  "/protocols",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    await requireDoctorPortalAccess(req);
    res.json({ protocols: await listProtocols() });
  })
);

export { router as doctorProtocolLibraryRouter };
