import { HttpError } from '../../utils/http-error.js';
import { validateIsoDate } from '../../utils/date.js';
import { CATEGORIES, type Category, type Clinical, type Config, type Episode, type Permission } from './gamma-knife-types.js';

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
export function clinical(value: unknown, submit: boolean): Clinical {
  const body = record(value);
  return { history: text(body.history, 'History', submit), examination: text(body.examination, 'Examination', submit), imaging: text(body.imaging, 'Imaging', submit), assessment: text(body.assessment, 'Clinical assessment', submit), priorTreatment: text(body.priorTreatment, 'Prior treatment'), diagnosisDetails: text(body.diagnosisDetails, 'Diagnosis-specific information'), priorTreatmentUnavailable: body.priorTreatmentUnavailable === true };
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
export const actionPermission: Record<string, Permission> = { clinical: 'clinical', submit: 'clinical', mdt: 'mdt', investigations: 'documents', preparation: 'treatment', completion: 'treatment', report: 'treatment', postpone: 'scheduling', appointment: 'scheduling', confirm_appointment: 'scheduling', followup: 'clinical', close: 'clinical', document_visibility: 'documents', qr_replace: 'documents', qr_revoke: 'documents' };
export function requireStage(episode: Episode, stages: Episode['status'][]): void {
  if (!stages.includes(episode.status)) throw new HttpError(409, 'This action is not allowed at the current stage.');
}
export function date(value: unknown): string { return validateIsoDate(value); }
