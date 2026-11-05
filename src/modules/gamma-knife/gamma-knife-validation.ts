import { HttpError } from '../../utils/http-error.js';
import { validateIsoDate } from '../../utils/date.js';
import { CATEGORIES, type BrainMetastasisLesion, type Category, type Clinical, type Config, type DiagnosisClinicalDetails, type Episode, type Permission, type ReferralInfo } from './gamma-knife-types.js';

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'An object is required.');
  return value as Record<string, unknown>;
}
export function text(value: unknown, label: string, required = false, max = 20000): string {
  if (value != null && typeof value !== 'string') throw new HttpError(400, `${label} must be text.`);
  const result = String(value ?? '').trim();
  if ((required && !result) || result.length > max) throw new HttpError(400, `${label} is required and must be within ${max} characters.`);
  return result;
}
export function id(value: unknown): number {
  if (typeof value !== 'number' && typeof value !== 'string') throw new HttpError(400, 'A valid positive ID is required.');
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result <= 0) throw new HttpError(400, 'A valid positive ID is required.');
  return result;
}
export function strings(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 100) throw new HttpError(400, `${label} must be a list of at most 100 items.`);
  return [...new Set(value.map(item => text(item, label, true, 1000)))];
}
function optionalMeasurement(value: unknown, label: string): number | null {
  if (value === '' || value == null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 999) throw new HttpError(400, `${label} must be a positive measurement in millimetres.`);
  return parsed;
}
function diagnosisDetails(value: unknown, diagnosisCategory: string | undefined): DiagnosisClinicalDetails | undefined {
  if (!diagnosisCategory) return undefined;
  const normalized = diagnosisCategory.toLowerCase().replace(/[^a-z]/g, '');
  if (normalized.includes('metast')) {
    const data = record(value ?? {});
    if (!Array.isArray(data.lesions) || data.lesions.length > 200) throw new HttpError(400, 'Lesions must be a list of at most 200 items.');
    const lesions: BrainMetastasisLesion[] = data.lesions.map((entry, index) => {
      const lesion = record(entry);
      return {
        identifier: text(lesion.identifier, `Lesion ${index + 1} identifier`, true, 100),
        location: text(lesion.location, `Lesion ${index + 1} location`, false, 1000),
        lengthMm: optionalMeasurement(lesion.lengthMm, `Lesion ${index + 1} length`),
        widthMm: optionalMeasurement(lesion.widthMm, `Lesion ${index + 1} width`),
        depthMm: optionalMeasurement(lesion.depthMm, `Lesion ${index + 1} depth`),
      };
    });
    if (new Set(lesions.map(item => item.identifier.toLowerCase())).size !== lesions.length) throw new HttpError(400, 'Lesion identifiers must be unique within the assessment.');
    return { schemaVersion: 1, diagnosis: 'brain_metastases', lesions };
  }
  if (normalized.includes('schwannoma') || normalized.includes('vestibular')) {
    const data = record(value ?? {});
    return { schemaVersion: 1, diagnosis: 'vestibular_schwannoma', laterality: text(data.laterality, 'Laterality', false, 30), cpaIacDetails: text(data.cpaIacDetails, 'CPA/IAC details', false, 4000), hearingAssessment: text(data.hearingAssessment, 'Hearing assessment', false, 4000), audiology: text(data.audiology, 'Audiology', false, 4000) };
  }
  if (normalized.includes('pituitary') || normalized.includes('parasellar')) {
    const data = record(value ?? {});
    return { schemaVersion: 1, diagnosis: 'pituitary_parasellar', opticApparatusRelationship: text(data.opticApparatusRelationship, 'Optic apparatus relationship', false, 4000), additionalAssessment: text(data.additionalAssessment, 'Additional assessment', false, 4000) };
  }
  if (normalized.includes('trigeminal') || normalized.includes('neuralgia')) {
    const data = record(value ?? {});
    return { schemaVersion: 1, diagnosis: 'trigeminal_neuralgia', painHistory: text(data.painHistory, 'Pain history', false, 4000), painAssessment: text(data.painAssessment, 'Pain assessment', false, 4000), priorTreatmentResponse: text(data.priorTreatmentResponse, 'Prior treatment response', false, 4000) };
  }
  return undefined;
}
export function clinical(value: unknown, submit: boolean, diagnosisCategory?: string): Clinical {
  const body = record(value);
  const details = diagnosisDetails(body.structuredDetails, diagnosisCategory);
  return { history: text(body.history, 'History', submit), examination: text(body.examination, 'Examination', submit), imaging: text(body.imaging, 'Imaging', submit), assessment: text(body.assessment, 'Clinical assessment', submit), priorTreatment: text(body.priorTreatment, 'Prior treatment'), diagnosisDetails: text(body.diagnosisDetails, 'Diagnosis-specific information'), priorTreatmentUnavailable: body.priorTreatmentUnavailable === true, ...(details ? { structuredDetails: details } : {}) };
}
export function referralCorrection(value: unknown): { diagnosis: string; diagnosisCategory: string; referral: ReferralInfo; reason: string } {
  const body = record(value);
  return {
    diagnosis: text(body.diagnosis, 'Provisional diagnosis', true, 1000),
    diagnosisCategory: text(body.diagnosisCategory, 'Diagnosis category', true, 150),
    referral: {
      details: text(body.details, 'Referral details', false, 4000),
      administrativeNotes: text(body.administrativeNotes, 'Administrative notes', false, 4000),
      source: text(body.source, 'Referral source', false, 250),
      referringPhysician: text(body.referringPhysician, 'Referring physician', false, 250),
    },
    reason: text(body.reason, 'Correction reason', true, 1000),
  };
}
export function mriPrimaryScreening(value: unknown): { result: 'no_known_implant_reported' | 'implant_reported_review_required'; implantSite: string | null; implantDescription: string | null; previousReviewerNameReported: string | null } | null {
  if (value == null) return null;
  const body = record(value);
  const result = body.result;
  if (result !== 'no_known_implant_reported' && result !== 'implant_reported_review_required') throw new HttpError(400, 'Choose a valid MRI implant screening result.');
  return {
    result,
    implantSite: text(body.implantSite, 'Implant or device site', false, 250) || null,
    implantDescription: text(body.implantDescription, 'Implant or device description', false, 1000) || null,
    previousReviewerNameReported: text(body.previousReviewerNameReported, 'Previous reviewer name', false, 250) || null,
  };
}
export function category(value: unknown): Category {
  if (!CATEGORIES.includes(value as Category)) throw new HttpError(400, 'Invalid document category.');
  return value as Category;
}
export function config(value: unknown): Config {
  const body = record(value);
  const visibility = record(body.documentVisibility);
  const documentVisibility = {} as Config['documentVisibility'];
  for (const key of CATEGORIES) {
    if (!['internal','routine','sensitive'].includes(String(visibility[key]))) throw new HttpError(400, 'Invalid document visibility.');
    documentVisibility[key] = visibility[key] as Config['documentVisibility'][Category];
  }
  if (!Array.isArray(body.diagnoses) || !body.diagnoses.length || body.diagnoses.length > 50) throw new HttpError(400, 'Provide 1–50 diagnosis categories.');
  const diagnoses = body.diagnoses.map(item => { const d = record(item); return { name: text(d.name, 'Diagnosis category', true, 150), checklist: strings(d.checklist, 'Checklist') }; });
  if (new Set(diagnoses.map(d => d.name.toLowerCase())).size !== diagnoses.length) throw new HttpError(400, 'Diagnosis names must be unique.');
  const reminderDays = Number(body.reminderDays);
  if (!Number.isInteger(reminderDays) || reminderDays < 0 || reminderDays > 365) throw new HttpError(400, 'Reminder window must be 0–365 days.');
  const treatmentExamTypeId = body.treatmentExamTypeId == null || body.treatmentExamTypeId === '' ? null : id(body.treatmentExamTypeId);
  const followupExamTypeId = body.followupExamTypeId == null || body.followupExamTypeId === '' ? null : id(body.followupExamTypeId);
  if (treatmentExamTypeId && treatmentExamTypeId === followupExamTypeId) throw new HttpError(400, 'Treatment and follow-up must use separate exam types.');
  return { revision: id(body.revision), diagnoses, consultants: strings(body.consultants, 'Consultants'), documentVisibility, treatmentExamTypeId, followupExamTypeId, reminderDays, diagnosisDetailsEnabled: body.diagnosisDetailsEnabled === true, qrEnabled: body.qrEnabled === true };
}
export const actionPermission: Record<string, Permission> = { clinical: 'clinical', submit: 'clinical', mdt: 'mdt', investigations: 'documents', preparation: 'treatment', completion: 'treatment', report: 'treatment', postpone: 'scheduling', appointment: 'scheduling', confirm_appointment: 'scheduling', followup: 'clinical', followup_correct: 'clinical', followup_void: 'clinical', close: 'clinical', document_visibility: 'documents', document_correct: 'documents', document_remove: 'documents', qr_replace: 'documents', qr_revoke: 'documents' };
export function requireStage(episode: Episode, stages: Episode['status'][]): void {
  if (!stages.includes(episode.status)) throw new HttpError(409, 'This action is not allowed at the current stage.');
}
export function date(value: unknown): string { return validateIsoDate(value); }
