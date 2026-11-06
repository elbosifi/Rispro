export const PERMISSIONS = ['access', 'referral', 'clinical', 'mdt', 'treatment', 'scheduling', 'documents', 'episode_correction', 'identity_review'] as const;
export type Permission = typeof PERMISSIONS[number];
export const CATEGORIES = ['referral', 'investigation', 'consent', 'treatment_report', 'patient_instructions', 'other'] as const;
export type Category = typeof CATEGORIES[number];
export type Status = 'referrals' | 'clinical_review' | 'mdt' | 'preparation' | 'treatment' | 'followup' | 'closed';
export type BrainMetastasisLesion = { identifier: string; location: string; lengthMm: number | null; widthMm: number | null; depthMm: number | null };
export type DiagnosisClinicalDetails =
  | { schemaVersion: 1; diagnosis: 'brain_metastases'; lesions: BrainMetastasisLesion[] }
  | { schemaVersion: 1; diagnosis: 'vestibular_schwannoma'; laterality: string; cpaIacDetails: string; hearingAssessment: string; audiology: string }
  | { schemaVersion: 1; diagnosis: 'pituitary_parasellar'; opticApparatusRelationship: string; additionalAssessment: string }
  | { schemaVersion: 1; diagnosis: 'trigeminal_neuralgia'; painHistory: string; painAssessment: string; priorTreatmentResponse: string };
export type Clinical = { history: string; examination: string; imaging: string; assessment: string; priorTreatment: string; diagnosisDetails: string; priorTreatmentUnavailable: boolean; structuredDetails?: DiagnosisClinicalDetails };
export type AppointmentLink = { bookingId: number; confirmed: boolean; postponed: boolean };
export type ReferralInfo = { details: string; administrativeNotes: string; source: string; referringPhysician: string };
export type PatientIdentityCorrectionRequest = { id: number; episodeId: number; patientId: number; requestedFields: Record<string, string>; reason: string; status: 'pending' | 'approved' | 'rejected'; requestedBy: string; createdAt: string; decidedBy?: string | null; decisionReason?: string | null; decidedAt?: string | null; patientUpdateCompletedAt?: string | null; patientUpdateCompletedBy?: string | null };
export type PostClosureCorrection = { id: number; kind: 'clinical_addendum' | 'administrative_correction'; affectedRecord: string; reason: string; previousContent: unknown; correctedContent: unknown; author: string; createdAt: string };
export type ReadinessItem = { id: number; episodeId: number; itemKey: string; label: string; required: boolean; status: 'pending' | 'in_progress' | 'completed'; responsibleUserId: number | null; responsibleName: string | null; dueDate: string | null; priority: 'low' | 'normal' | 'high' | 'urgent'; notes: string; completedAt: string | null; completedBy: string | null };
export type PatientCommunication = { id: number; episodeId: number; kind: 'telephone_attempt' | 'successful_contact' | 'appointment_confirmed' | 'unreachable' | 'postponement_requested' | 'treatment_declined' | 'followup_reminder'; outcome: string; notes: string; nextAction: string | null; nextActionDate: string | null; createdBy: string; createdAt: string };
export type OperationsTask = { episodeId: number; episodeRevision: number; ownerUserId?: number | null; patientName: string; patientArabicName?: string | null; patientEnglishName?: string | null; mrn: string; taskKey: string; task: string; owner: string | null; dueDate: string | null; priority: 'low' | 'normal' | 'high' | 'urgent'; status: string; assignmentStatus?: 'open' | 'in_progress' | 'resolved' | 'cancelled'; bookingId?: number | null; appointmentDate?: string | null; appointmentTime?: string | null; ready?: boolean; nextAction?: string };
export type Preparation = { consent: boolean; imaging: boolean; clinicalReady: boolean; notes: string; instructions: string; actions: string; ready: boolean };
export type Treatment = { date: string; immobilization: 'frame' | 'mask'; fractions: number; team: string[]; completed: boolean; reportId: number | null; finalized: boolean };
export type Mdt = { decision: 'approved' | 'additional_information' | 'deferred' | 'not_suitable'; consultants: string[]; assessment: string; notes: string; investigations: string; assessmentRevision: number };
export type Followup = { id?: string; date: string; condition: string; imaging: string; response: string; complications: string; severity: string; actions: string; nextBookingId: number | null; courseId?: number | null; voided?: boolean; voidedReason?: string; voidedBy?: number | string };
export type TreatmentFraction = { id: number; plannedFractionNumber: number; status: 'delivered' | 'interrupted' | 'not_delivered'; eventDate: string; operatorName: string; gammaPlanReference: string | null; notes: string; createdBy: number; createdAt: string };
export type WorkflowHistory = { action: string; reason: string; snapshot: unknown; actor: string; createdAt: string };
export type TreatmentCourse = { id: number; episodeId: number; courseNumber: number; priorCourseId: number | null; reassessmentId: number | null; immobilization: 'frame' | 'mask'; plannedFractionCount: number; gammaPlanReference: string | null; targetReferences: string[]; status: 'planned' | 'in_progress' | 'interrupted' | 'completed' | 'cancelled'; source: 'clinical_record' | 'legacy_import'; legacyTreatmentSnapshot?: Treatment | null; completionReason?: string | null; completedAt?: string | null; reportId?: number | null; documentationFinalized?: boolean; fractions: TreatmentFraction[]; history?: WorkflowHistory[] };
export type ReassessmentDecision = { decision: 'approved' | 'additional_information' | 'deferred' | 'not_suitable'; assessment: string; notes: string; consultants: string[]; reason: string; revision: number; createdAt: string };
export type Reassessment = { id: number; episodeId: number; courseId: number; reason: 'progression' | 'complication' | 'uncertain_response' | 'other'; reasonDetail: string; status: 'requested' | 'awaiting_information' | 'decided' | 'cancelled'; decision?: ReassessmentDecision | null; decisionHistory?: ReassessmentDecision[] };
export type Investigation = { id: number; episodeId: number; reassessmentId: number | null; requestedText: string; responsibleUserId: number | null; responsibleName: string | null; dueDate: string | null; priority: 'low' | 'normal' | 'high' | 'urgent'; status: 'requested' | 'received' | 'cancelled'; evidenceDocumentId: number | null; receivedNote: string | null; createdAt: string; history?: WorkflowHistory[] };
export type EpisodeData = {
  referral?: ReferralInfo; referralReviewRequired?: boolean; mdtReviewRequired?: boolean; patientAttributionCorrectionId?: number;
  clinical?: Clinical; assessmentStatus?: 'draft' | 'provisional' | 'finalized'; assessmentRevision?: number;
  mdt?: Mdt; preparation?: Preparation; treatment?: Treatment; followups?: Followup[];
  treatmentAppointment?: AppointmentLink; followupAppointment?: AppointmentLink;
  nextFollowupDate?: string | null;
  appointmentReconciliation?: Array<{ purpose: 'treatment' | 'followup'; bookingId: number; status: 'required' | 'resolved'; reason: string }>;
  checklist?: string[]; investigationsPending?: boolean; postponementReason?: string; closureReason?: string;
  legacyTreatmentSummarized?: boolean;
};
export type Episode = { id: number; patientId: number; diagnosis: string; diagnosisCategory: string; status: Status; active: boolean; closureClassification?: 'not_suitable' | 'withdrawn' | 'entered_in_error' | 'completed' | null; replacementEpisodeId?: number | null; revision: number; data: EpisodeData; patientName: string; patientArabicName?: string | null; patientEnglishName?: string | null; mrn: string; updatedAt: string; qrActive: boolean; followupDate?: string | null };
export type Config = { revision: number; diagnoses: { name: string; checklist: string[] }[]; consultants: string[]; documentVisibility: Record<Category, 'internal' | 'routine' | 'sensitive'>; treatmentExamTypeId: number | null; followupExamTypeId: number | null; reminderDays: number; diagnosisDetailsEnabled: boolean; qrEnabled: boolean };
export type EpisodeDocument = { id: number; name: string; category: Category; released: boolean; visibility: 'internal' | 'routine' | 'sensitive' };
export const STATUS_LABELS: Record<Status, string> = { referrals: 'Referral', clinical_review: 'Clinical Review', mdt: 'MDT Review', preparation: 'Preparation', treatment: 'Treatment', followup: 'Follow-up', closed: 'Closed' };
export function nextAction(episode: Pick<Episode, 'status' | 'data'>): string {
  if (episode.data.referralReviewRequired) return 'Review corrected referral and clinical assessment';
  if (episode.data.mdtReviewRequired) return 'Review corrected referral at MDT';
  if (episode.data.investigationsPending) return 'Operations: obtain requested investigations';
  if (episode.status === 'mdt' && episode.data.assessmentStatus !== 'finalized') return 'Finalize clinical assessment before the MDT decision';
  if (episode.status === 'followup' && !episode.data.treatment?.finalized) return 'Attach treatment report and record follow-up';
  return { referrals: 'Complete clinical assessment', clinical_review: 'Complete clinical assessment', mdt: 'Record MDT decision', preparation: 'Complete preparation and schedule treatment', treatment: 'Confirm treatment completion', followup: 'Record follow-up and next appointment', closed: 'View episode history' }[episode.status];
}
