export const PERMISSIONS = ['access', 'referral', 'clinical', 'mdt', 'treatment', 'scheduling', 'documents'] as const;
export type Permission = typeof PERMISSIONS[number];
export const CATEGORIES = ['referral', 'investigation', 'consent', 'treatment_report', 'patient_instructions', 'other'] as const;
export type Category = typeof CATEGORIES[number];
export type Status = 'referrals' | 'clinical_review' | 'mdt' | 'preparation' | 'treatment' | 'followup' | 'closed';
export type Clinical = { history: string; examination: string; imaging: string; assessment: string; priorTreatment: string; diagnosisDetails: string; priorTreatmentUnavailable: boolean };
export type AppointmentLink = { bookingId: number; confirmed: boolean; postponed: boolean };
export type Preparation = { consent: boolean; imaging: boolean; clinicalReady: boolean; notes: string; instructions: string; actions: string; ready: boolean };
export type Treatment = { date: string; immobilization: 'frame' | 'mask'; fractions: number; team: string[]; completed: boolean; reportId: number | null; finalized: boolean };
export type Mdt = { decision: 'approved' | 'additional_information' | 'deferred' | 'not_suitable'; consultants: string[]; assessment: string; notes: string; investigations: string; assessmentRevision: number };
export type Followup = { date: string; condition: string; imaging: string; response: string; complications: string; severity: string; actions: string; nextBookingId: number | null };
export type EpisodeData = {
  clinical?: Clinical; assessmentStatus?: 'draft' | 'provisional' | 'finalized'; assessmentRevision?: number;
  mdt?: Mdt; preparation?: Preparation; treatment?: Treatment; followups?: Followup[];
  treatmentAppointment?: AppointmentLink; followupAppointment?: AppointmentLink;
  checklist?: string[]; investigationsPending?: boolean; postponementReason?: string; closureReason?: string;
};
export type Episode = { id: number; patientId: number; diagnosis: string; diagnosisCategory: string; status: Status; active: boolean; revision: number; data: EpisodeData; patientName: string; patientArabicName?: string | null; patientEnglishName?: string | null; mrn: string; updatedAt: string; qrActive: boolean; followupDate?: string | null };
export type Config = { revision: number; diagnoses: { name: string; checklist: string[] }[]; consultants: string[]; documentVisibility: Record<Category, 'internal' | 'routine' | 'sensitive'>; treatmentExamTypeId: number | null; followupExamTypeId: number | null; reminderDays: number; diagnosisDetailsEnabled: boolean; qrEnabled: boolean };
export type EpisodeDocument = { id: number; name: string; category: Category; released: boolean; visibility: 'internal' | 'routine' | 'sensitive' };
export const STATUS_LABELS: Record<Status, string> = { referrals: 'Referral', clinical_review: 'Clinical Review', mdt: 'MDT Review', preparation: 'Preparation', treatment: 'Treatment', followup: 'Follow-up', closed: 'Closed' };
export function nextAction(episode: Pick<Episode, 'status' | 'data'>): string {
  if (episode.data.investigationsPending) return 'Operations: obtain requested investigations';
  if (episode.status === 'mdt' && episode.data.assessmentStatus !== 'finalized') return 'Finalize clinical assessment before the MDT decision';
  if (episode.status === 'followup' && !episode.data.treatment?.finalized) return 'Attach treatment report and record follow-up';
  return { referrals: 'Complete clinical assessment', clinical_review: 'Complete clinical assessment', mdt: 'Record MDT decision', preparation: 'Complete preparation and schedule treatment', treatment: 'Confirm treatment completion', followup: 'Record follow-up and next appointment', closed: 'View episode history' }[episode.status];
}
