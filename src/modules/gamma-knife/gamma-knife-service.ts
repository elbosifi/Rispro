import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import type { PoolClient } from 'pg';
import { pool } from '../../db/pool.js';
import { assertModuleAccess, assertUsableModuleAccess, hasModuleAccess, resolveModuleAccess } from '../module-access/module-access-service.js';
import { HttpError } from '../../utils/http-error.js';
import { getTripoliToday } from '../../utils/date.js';
import { logAuditEntry } from '../../services/audit-service.js';
import { uploadDocument, getDocumentById, readDocumentContent, type DocumentUploadPayload } from '../../services/document-service.js';
import { getPatientById, updatePatientContactDetails } from '../../services/patient-service.js';
import { isPatientIdentityVerificationRequired, maskPatientIdentifier, resolvePatientIdentityRisk, resolvePatientIdentityVerificationMode, verifyPatientIdentityEvidence } from '../../services/patient-selection-safety-service.js';
import { createBooking } from '../appointments-v2/booking/services/create-booking.service.js';
import { cancelBooking } from '../appointments-v2/booking/services/cancel-booking.service.js';
import { rescheduleBooking } from '../appointments-v2/booking/services/reschedule-booking.service.js';
import { SchedulingError } from '../appointments-v2/shared/errors/scheduling-error.js';
import type { CreateBookingPayload } from '../appointments-v2/booking/models/booking.js';
import type { AuthenticatedUserContext } from '../../types/http.js';
import { CATEGORIES, PERMISSIONS, STATUS_LABELS, nextAction, type Config, type Episode, type EpisodeDocument, type Investigation, type OperationsTask, type PatientCommunication, type Permission, type ReadinessItem, type Reassessment, type Followup, type Treatment, type TreatmentCourse, type TreatmentFraction } from './gamma-knife-types.js';
import { actionPermission, category, clinical, config as validateConfig, date, id, mriPrimaryScreening, record, referralCorrection, requireStage, strings, text } from './gamma-knife-validation.js';
import { historicalTreatments } from './historical-treatment-service.js';

type Db = PoolClient | typeof pool;
export type Actor = AuthenticatedUserContext;
const SELECT = `select e.id, e.patient_id as "patientId", e.diagnosis, e.diagnosis_category as "diagnosisCategory", e.status, e.active,
  e.closure_classification as "closureClassification",e.replacement_episode_id as "replacementEpisodeId",e.revision,e.data,
  coalesce(nullif(p.english_full_name,''),p.arabic_full_name) as "patientName", p.arabic_full_name as "patientArabicName", p.english_full_name as "patientEnglishName", p.mrn, e.updated_at as "updatedAt", (e.qr_hash is not null) as "qrActive",
  coalesce((select b.booking_date::text from appointments_v2.bookings b where b.id=(e.data->'followupAppointment'->>'bookingId')::bigint
    and b.patient_id=e.patient_id and b.status='scheduled' and b.voided_at is null
    and not exists(select 1 from jsonb_array_elements(coalesce(e.data->'followups','[]'::jsonb)) v where (v->>'date')::date >= b.booking_date)
  ), e.data->>'nextFollowupDate') as "followupDate"
  from gamma_knife_episodes e join patients p on p.id=e.patient_id`;
function episodeRow(row: Episode): Episode { return { ...row, id: Number(row.id), patientId: Number(row.patientId), replacementEpisodeId: row.replacementEpisodeId == null ? null : Number(row.replacementEpisodeId) }; }
export function tokenHash(token: string): string { return createHash('sha256').update(token).digest('hex'); }

export async function permissions(actor: Actor, db: Db = pool): Promise<Permission[]> {
  const result = await db.query<{ gamma_knife_permissions: Permission[] }>('select gamma_knife_permissions from users where id=$1 and is_active=true', [actor.sub]);
  return result.rows[0]?.gamma_knife_permissions ?? [];
}
export async function authorize(actor: Actor, permission: Permission = 'access', db: Db = pool): Promise<void> {
  await assertModuleAccess(actor.sub, 'gamma-knife', db);
  const granted = await permissions(actor, db);
  if (!granted.includes('access') || !granted.includes(permission)) throw new HttpError(403, 'Gamma Knife assignment and permission required.');
}
export async function readConfig(db: Db = pool): Promise<Config> {
  const result = await db.query<{ setting_value: Config }>("select setting_value from system_settings where category='gamma_knife' and setting_key='config'");
  if (!result.rows[0]) throw new HttpError(503, 'Gamma Knife settings are unavailable.');
  return result.rows[0].setting_value;
}
export async function settings(actor: Actor) {
  // Existing administrators manage assignments, including the first assignment. No clinical data here.
  if (!['supervisor','super_admin'].includes(actor.role)) throw new HttpError(403, 'RISpro administrator required for Gamma Knife settings.');
  const users = await pool.query('select id, full_name as name, role, is_active as active, gamma_knife_permissions as permissions from users order by full_name, id');
  const exams = await pool.query('select id, name_en as name, name_ar as "arabicName" from exam_types where is_active=true order by name_en');
  return { config: await readConfig(), users: users.rows.map(u => ({ ...u, id: Number(u.id) })), exams: exams.rows.map(e => ({ ...e, id: Number(e.id) })), smsAvailable: false };
}
async function transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try { await client.query('begin'); const result = await operation(client); await client.query('commit'); return result; }
  catch (error) {
    await client.query('rollback');
    if ((error as { constraint?: string }).constraint === 'gamma_knife_one_active_episode') throw new HttpError(409, 'This patient already has an active Gamma Knife episode.');
    throw error;
  }
  finally { client.release(); }
}
export async function saveSettings(actor: Actor, input: unknown) {
  if (!['supervisor','super_admin'].includes(actor.role)) throw new HttpError(403, 'RISpro administrator required for Gamma Knife settings.');
  const body = record(input); const value = validateConfig(body.config);
  const grants = body.users;
  if (!Array.isArray(grants) || grants.length > 2000) throw new HttpError(400, 'Invalid user permissions.');
  // Assignment management follows existing administrator authority, never a self-granted module flag.
  if (!['supervisor','super_admin'].includes(actor.role)) throw new HttpError(403, 'RISpro administrator required to update assignments.');
  await transaction(async client => {
    const old = await client.query<{ setting_value: Config }>("select setting_value from system_settings where category='gamma_knife' and setting_key='config' for update");
    if (old.rows[0]?.setting_value.revision !== value.revision) throw new HttpError(409, 'Settings changed. Reload before saving.');
    for (const examId of [value.treatmentExamTypeId, value.followupExamTypeId].filter(Boolean)) {
      const found = await client.query('select id from exam_types where id=$1 and is_active=true', [examId]);
      if (!found.rows.length) throw new HttpError(400, 'Choose an active RISpro exam type.');
    }
    for (const item of grants) {
      const user = record(item); const granted = strings(user.permissions, 'Permissions');
      if (granted.some(p => !PERMISSIONS.includes(p as Permission))) throw new HttpError(400, 'Unknown Gamma Knife permission.');
      if (granted.length && !granted.includes('access')) throw new HttpError(400, 'Actions require module access.');
      const target = await client.query<{ role: string; gamma_knife_permissions: string[] }>('select role,gamma_knife_permissions from users where id=$1 for update', [id(user.id)]);
      if (!target.rows.length) throw new HttpError(400, 'User not found.');
      if ([...target.rows[0].gamma_knife_permissions].sort().join(',') === [...granted].sort().join(',')) continue;
      if (target.rows[0].role === 'super_admin' && actor.role !== 'super_admin') throw new HttpError(403, 'Cannot manage protected administrator.');
      if (Number(actor.sub) === id(user.id) && granted.some(p => !target.rows[0]!.gamma_knife_permissions.includes(p))) throw new HttpError(403, 'Administrators cannot grant themselves clinical permissions.');
      await client.query('update users set gamma_knife_permissions=$2::text[],auth_version=auth_version+1 where id=$1', [id(user.id), granted]);
      await assertUsableModuleAccess(id(user.id), client);
    }
    await client.query("update system_settings set setting_value=$1::jsonb, updated_at=now(), updated_by_user_id=$2 where category='gamma_knife' and setting_key='config'", [JSON.stringify({ ...value, revision: value.revision + 1 }), actor.sub]);
    await logAuditEntry({ entityType: 'gamma_knife_settings', actionType: 'update', changedByUserId: actor.sub, oldValues: old.rows[0]?.setting_value, newValues: { ...value, users: grants } }, client);
  });
  return settings(actor);
}
export async function listEpisodes(actor: Actor, q = '', status = '') {
  await authorize(actor);
  if (status && !Object.hasOwn(STATUS_LABELS, status)) throw new HttpError(400, 'Invalid status.');
  const result = await pool.query<Episode>(`${SELECT} where ($1='' or e.status=$1) and ($2='' or p.mrn ilike $3 or p.english_full_name ilike $3 or p.arabic_full_name ilike $3 or e.diagnosis ilike $3) order by e.updated_at desc, e.id desc limit 200`, [status, q, `%${q}%`]);
  return result.rows.map(episodeRow);
}
export async function findEpisode(episodeId: unknown, db: Db = pool, lock = false): Promise<Episode> {
  const result = await db.query<Episode>(`${SELECT} where e.id=$1${lock ? ' for update of e' : ''}`, [id(episodeId)]);
  if (!result.rows[0]) throw new HttpError(404, 'Gamma Knife episode not found.');
  return episodeRow(result.rows[0]);
}
async function history(client: PoolClient, episode: Episode, actor: Actor, action: string, reason = '', details: Record<string, unknown> = {}) {
  await client.query('insert into gamma_knife_history(episode_id,revision,action,snapshot,actor_id) values($1,$2,$3,$4::jsonb,$5)', [episode.id, episode.revision, action, JSON.stringify({ diagnosis: episode.diagnosis, diagnosisCategory: episode.diagnosisCategory, status: episode.status, active: episode.active, closureClassification: episode.closureClassification ?? null, replacementEpisodeId: episode.replacementEpisodeId ?? null, qrActive: episode.qrActive, data: episode.data, reason, details }), actor.sub]);
  await logAuditEntry({ entityType: 'gamma_knife_episode', entityId: episode.id, actionType: action, changedByUserId: actor.sub, newValues: { revision: episode.revision, status: episode.status } }, client);
}
function checkEpisodeRevision(episode: Episode, value: unknown) {
  if (episode.revision !== Number(value)) throw new HttpError(409, 'Episode changed. Reload and review before saving.');
}
async function episodeWorkflowHistory(client: PoolClient, episode: Episode, actor: Actor, action: string, reason: string, details: Record<string, unknown> = {}) {
  episode.revision++;
  await client.query('update gamma_knife_episodes set status=$2,active=$3,closure_classification=$4,replacement_episode_id=$5,data=$6::jsonb,revision=$7,updated_at=now() where id=$1', [episode.id, episode.status, episode.active, episode.closureClassification ?? null, episode.replacementEpisodeId ?? null, JSON.stringify(episode.data), episode.revision]);
  await history(client, episode, actor, action, reason, details);
}
async function treatmentHistory(client: PoolClient, courseId: number, actor: Actor, action: string, snapshot: unknown, reason = '', fractionId: number | null = null) {
  await client.query('insert into gamma_knife_treatment_history(course_id,fraction_id,action,reason,snapshot,actor_id) values($1,$2,$3,$4,$5::jsonb,$6)', [courseId, fractionId, action, reason, JSON.stringify(snapshot), actor.sub]);
  await logAuditEntry({ entityType: 'gamma_knife_treatment_course', entityId: courseId, actionType: action, changedByUserId: actor.sub, newValues: { fractionId, reason } }, client);
}
async function reassessmentHistory(client: PoolClient, reassessmentId: number, actor: Actor, action: string, snapshot: unknown, reason = '') {
  await client.query('insert into gamma_knife_reassessment_history(reassessment_id,action,reason,snapshot,actor_id) values($1,$2,$3,$4::jsonb,$5)', [reassessmentId, action, reason, JSON.stringify(snapshot), actor.sub]);
  await logAuditEntry({ entityType: 'gamma_knife_reassessment', entityId: reassessmentId, actionType: action, changedByUserId: actor.sub, newValues: { reason } }, client);
}
async function investigationHistory(client: PoolClient, investigationId: number, actor: Actor, action: string, snapshot: unknown, reason = '') {
  await client.query('insert into gamma_knife_investigation_history(investigation_id,action,reason,snapshot,actor_id) values($1,$2,$3,$4::jsonb,$5)', [investigationId, action, reason, JSON.stringify(snapshot), actor.sub]);
  await logAuditEntry({ entityType: 'gamma_knife_investigation', entityId: investigationId, actionType: action, changedByUserId: actor.sub, newValues: { reason } }, client);
}
export async function createEpisode(actor: Actor, input: unknown) {
  const body = record(input);
  try {
    return await transaction(async client => {
      await authorize(actor, 'referral', client);
      const config = await readConfig(client); const diagnosisCategory = text(body.diagnosisCategory, 'Diagnosis category', true, 150);
      const definition = config.diagnoses.find(d => d.name === diagnosisCategory);
      if (!definition) throw new HttpError(400, 'Select a supported diagnosis category.');
      const patient = await client.query<{ id: string; mrn: string; arabic_full_name: string; english_full_name: string | null }>("select id,mrn,arabic_full_name,english_full_name from patients where id=$1 and coalesce(nullif(trim(phone_1),''),nullif(trim(phone_2),''),'') <> '' for key share", [id(body.patientId)]);
      if (!patient.rows.length) throw new HttpError(400, 'An existing patient with contact information is required.');
      const replacementForEpisodeId = body.replacementForEpisodeId == null || body.replacementForEpisodeId === '' ? null : id(body.replacementForEpisodeId);
      let original: Episode | null = null;
      if (replacementForEpisodeId) {
        original = await findEpisode(replacementForEpisodeId, client, true);
        if (original.active || original.closureClassification !== 'entered_in_error' || original.replacementEpisodeId) throw new HttpError(409, 'A replacement can only be linked to an entered-in-error episode that has no replacement yet.');
        const attributionCorrection = await client.query<{ corrected_patient_id: number }>('select corrected_patient_id from gamma_knife_patient_attribution_corrections where episode_id=$1', [original.id]);
        if (attributionCorrection.rows[0] && Number(attributionCorrection.rows[0].corrected_patient_id) !== Number(body.patientId)) throw new HttpError(409, 'The replacement must use the patient recorded in the authorized wrong-patient correction.');
        const confirmedMrn = text(body.confirmationPatientMrn, 'Confirmed patient MRN', true, 80);
        const confirmedName = text(body.confirmationPatientName, 'Confirmed patient name', true, 250).toLocaleLowerCase();
        const selectedPatient = patient.rows[0]!;
        const validNames = [selectedPatient.arabic_full_name, selectedPatient.english_full_name].filter(Boolean).map(value => String(value).trim().toLocaleLowerCase());
        if (confirmedMrn !== selectedPatient.mrn || !validNames.includes(confirmedName)) throw new HttpError(409, 'Confirm the selected patient by entering the same MRN and registered name shown above.');
      }
      const referral = {
        details: text(body.referralDetails, 'Referral details', false, 4000),
        administrativeNotes: text(body.administrativeNotes, 'Administrative notes', false, 4000),
        source: text(body.referralSource, 'Referral source', false, 250),
        referringPhysician: text(body.referringPhysician, 'Referring physician', false, 250),
      };
      const inserted = await client.query<{ id: number }>('insert into gamma_knife_episodes(patient_id,diagnosis,diagnosis_category,data,created_by) values($1,$2,$3,$4::jsonb,$5) returning id', [id(body.patientId), text(body.diagnosis, 'Provisional diagnosis', true, 1000), diagnosisCategory, JSON.stringify({ checklist: definition.checklist, referral }), actor.sub]);
      await client.query(`insert into gamma_knife_readiness_items(episode_id,item_key,label,required,created_by_user_id,updated_by_user_id)
        values($1,'identity_verification','Patient identity verification',true,$2,$2),($1,'consent_documentation','Consent documentation',true,$2,$2),($1,'required_imaging','Required MRI/CT imaging',true,$2,$2)`, [inserted.rows[0]!.id, actor.sub]);
      const episode = await findEpisode(inserted.rows[0]!.id, client);
      await history(client, episode, actor, replacementForEpisodeId ? 'referral_replacement_created' : 'referral', '', replacementForEpisodeId ? { replacementForEpisodeId } : {});
      if (original) {
        original.replacementEpisodeId = episode.id;
        await episodeWorkflowHistory(client, original, actor, 'replacement_linked', 'Wrong-patient or incorrect referral replaced after identifier confirmation.', { replacementEpisodeId: episode.id, patientId: episode.patientId, mrn: selectedPatientMrn(patient.rows[0]!) });
      }
      return episode;
    });
  } catch (error) {
    if ((error as { code?: string; constraint?: string }).constraint === 'gamma_knife_one_active_episode') throw new HttpError(409, 'This patient already has an active Gamma Knife episode.');
    throw error;
  }
}
function selectedPatientMrn(patient: { mrn: string }): string { return patient.mrn; }

export async function editReferral(actor: Actor, episodeId: unknown, input: unknown) {
  const body = record(input);
  const correction = referralCorrection(body);
  return transaction(async client => {
    await authorize(actor, 'referral', client);
    const episode = await findEpisode(episodeId, client, true);
    checkEpisodeRevision(episode, body.revision);
    const closedCorrection = !episode.active;
    if (closedCorrection) {
      if (!['supervisor','super_admin'].includes(actor.role)) throw new HttpError(403, 'A closed episode requires an authorized administrator to correct referral details.');
      await authorize(actor, 'episode_correction', client);
    }
    const config = await readConfig(client);
    if (!config.diagnoses.some(item => item.name === correction.diagnosisCategory)) throw new HttpError(400, 'Select a supported diagnosis category.');
    const previous = { diagnosis: episode.diagnosis, diagnosisCategory: episode.diagnosisCategory, referral: episode.data.referral ?? { details: '', administrativeNotes: '', source: '', referringPhysician: '' } };
    const changedDiagnosis = correction.diagnosis !== episode.diagnosis;
    const changedCategory = correction.diagnosisCategory !== episode.diagnosisCategory;
    if (episode.active && (changedDiagnosis || changedCategory)) {
      const courseEvidence = await client.query("select 1 from gamma_knife_treatment_courses where episode_id=$1 and status <> 'cancelled' limit 1", [episode.id]);
      if (courseEvidence.rows.length) throw new HttpError(409, 'Cancel or resolve the current treatment plan before changing the clinical referral diagnosis.');
      if (episode.data.clinical || episode.data.mdt) {
        episode.data.referralReviewRequired = true;
        if (episode.data.mdt) episode.data.mdtReviewRequired = true;
        episode.status = 'clinical_review';
      }
    }
    episode.diagnosis = correction.diagnosis;
    episode.diagnosisCategory = correction.diagnosisCategory;
    episode.data.referral = correction.referral;
    episode.revision++;
    await client.query('update gamma_knife_episodes set diagnosis=$2,diagnosis_category=$3,status=$4,data=$5::jsonb,revision=$6,updated_at=now() where id=$1', [episode.id, episode.diagnosis, episode.diagnosisCategory, episode.status, JSON.stringify(episode.data), episode.revision]);
    await history(client, episode, actor, 'referral_corrected', correction.reason, { before: previous, after: { diagnosis: episode.diagnosis, diagnosisCategory: episode.diagnosisCategory, referral: episode.data.referral }, clinicalReviewRequired: Boolean(episode.data.referralReviewRequired), mdtReviewRequired: Boolean(episode.data.mdtReviewRequired) });
    return { episode };
  });
}

async function hasDeliveredTreatment(client: PoolClient, episodeId: number): Promise<boolean> {
  const result = await client.query(`select 1 from gamma_knife_treatment_courses c
    left join gamma_knife_treatment_fractions f on f.course_id=c.id and f.status='delivered'
    where c.episode_id=$1 and (c.status='completed' or f.id is not null) limit 1`, [episodeId]);
  return result.rows.length > 0;
}

async function hasSignificantEpisodeEvidence(client: PoolClient, episode: Episode): Promise<boolean> {
  const clinicalContent = episode.data.clinical && Object.values(episode.data.clinical).some(value => {
    if (typeof value === 'string') return value.trim().length > 0;
    if (typeof value === 'boolean') return value;
    return value != null;
  });
  if (clinicalContent || episode.data.mdt || episode.data.treatment?.completed || episode.data.assessmentStatus === 'finalized') return true;
  const evidence = await client.query(`select 1 from gamma_knife_treatment_courses where episode_id=$1
    union all select 1 from gamma_knife_investigations where episode_id=$1
    union all select 1 from gamma_knife_documents where episode_id=$1 and removed_at is null and category in ('consent','investigation','treatment_report')
    limit 1`, [episode.id]);
  return evidence.rows.length > 0;
}

type AppointmentPurpose = 'treatment' | 'followup';
const appointmentLinkKey: Record<AppointmentPurpose, 'treatmentAppointment' | 'followupAppointment'> = {
  treatment: 'treatmentAppointment', followup: 'followupAppointment',
};

/** Cancel linked Appointments V2 bookings through its policy service, recording a visible task when policy or privilege prevents cancellation. */
async function reconcileEpisodeAppointments(
  actor: Actor,
  episodeId: unknown,
  expectedRevision: number,
  purposes: AppointmentPurpose[],
  reason: string,
  validate: (client: PoolClient, episode: Episode) => Promise<void>,
) {
  const links = await transaction(async client => {
    const episode = await findEpisode(episodeId, client, true);
    checkEpisodeRevision(episode, expectedRevision);
    await validate(client, episode);
    return purposes.flatMap(purpose => {
      const link = episode.data[appointmentLinkKey[purpose]];
      return link ? [{ purpose, bookingId: Number(link.bookingId) }] : [];
    });
  });
  let revision = expectedRevision;
  const pending: Array<{ purpose: AppointmentPurpose; bookingId: number; reason: string }> = [];
  const canCancel = (await permissions(actor)).includes('scheduling');
  for (const link of links) {
    const active = await pool.query<{ status: string; patient_id: number; updated_at: string }>("select status,patient_id,updated_at::text from appointments_v2.bookings where id=$1 and status in ('scheduled','arrived','waiting') and voided_at is null", [link.bookingId]);
    if (!active.rows.length) continue;
    const linkedEpisode = await findEpisode(episodeId);
    if (Number(active.rows[0]!.patient_id) !== linkedEpisode.patientId) {
      pending.push({ ...link, reason: 'The linked RISpro appointment belongs to a different patient and requires authorized review.' });
      continue;
    }
    if (!canCancel) {
      pending.push({ ...link, reason: 'The assigned user cannot cancel this RISpro appointment.' });
      continue;
    }
    try {
      await cancelBooking(link.bookingId, Number(actor.sub), async (client, cancelled) => {
        await authorize(actor, 'scheduling', client);
        const current = await findEpisode(episodeId, client, true);
        checkEpisodeRevision(current, revision);
        await validate(client, current);
        const key = appointmentLinkKey[link.purpose];
        if (Number(current.data[key]?.bookingId) !== link.bookingId) throw new HttpError(409, 'The linked appointment changed. Reload the episode before continuing.');
        current.data[key] = { ...current.data[key]!, confirmed: false, postponed: true };
        current.data.appointmentReconciliation = (current.data.appointmentReconciliation ?? []).map(item => item.bookingId === link.bookingId ? { ...item, status: 'resolved' as const } : item);
        await client.query("update gamma_knife_operation_task_assignments set status='resolved',updated_at=now(),updated_by_user_id=$3 where episode_id=$1 and task_key=$2", [current.id, `appointment_reconciliation:${link.bookingId}`, actor.sub]);
        await episodeWorkflowHistory(client, current, actor, 'linked_appointment_cancelled', reason, { purpose: link.purpose, bookingId: link.bookingId, previousBookingStatus: cancelled.previousStatus });
        revision = current.revision;
      }, active.rows[0]!.updated_at);
    } catch (error) {
      if (!(error instanceof SchedulingError)) throw error;
      const state = await transaction(async client => {
        const current = await findEpisode(episodeId, client, true);
        checkEpisodeRevision(current, revision);
        await validate(client, current);
        const status = await client.query<{ status: string }>('select status from appointments_v2.bookings where id=$1 for share', [link.bookingId]);
        if (!status.rows.length || !['scheduled','arrived','waiting'].includes(status.rows[0].status)) {
          current.data[appointmentLinkKey[link.purpose]] = { ...current.data[appointmentLinkKey[link.purpose]]!, confirmed: false, postponed: true };
          current.data.appointmentReconciliation = (current.data.appointmentReconciliation ?? []).map(item => item.bookingId === link.bookingId ? { ...item, status: 'resolved' as const } : item);
          await client.query("update gamma_knife_operation_task_assignments set status='resolved',updated_at=now(),updated_by_user_id=$3 where episode_id=$1 and task_key=$2", [current.id, `appointment_reconciliation:${link.bookingId}`, actor.sub]);
          await episodeWorkflowHistory(client, current, actor, 'linked_appointment_reconciled', reason, { purpose: link.purpose, bookingId: link.bookingId, bookingStatus: status.rows[0]?.status ?? 'missing' });
          return { revision: current.revision, pending: false };
        }
        return { revision: current.revision, pending: true };
      });
      revision = state.revision;
      if (state.pending) pending.push({ ...link, reason: error.message });
    }
  }
  return { revision, pending };
}

async function recordAppointmentReconciliation(client: PoolClient, episode: Episode, actor: Actor, pending: Array<{ purpose: AppointmentPurpose; bookingId: number; reason: string }>) {
  for (const item of pending) {
    const previous = episode.data.appointmentReconciliation?.find(value => value.bookingId === item.bookingId);
    if (previous?.status === 'required') continue;
    episode.data.appointmentReconciliation = [...(episode.data.appointmentReconciliation ?? []).filter(value => value.bookingId !== item.bookingId), { purpose: item.purpose, bookingId: item.bookingId, status: 'required', reason: item.reason }];
    await client.query(`insert into gamma_knife_operation_task_assignments(episode_id,task_key,owner_user_id,due_date,priority,updated_by_user_id,status)
      values($1,$2,null,null,'urgent',$3,'open') on conflict(episode_id,task_key) do update set status='open',priority='urgent',updated_by_user_id=excluded.updated_by_user_id,updated_at=now()`, [episode.id, `appointment_reconciliation:${item.bookingId}`, actor.sub]);
  }
}

async function resolveAppointmentReconciliation(client: PoolClient, episode: Episode, actor: Actor, purpose: AppointmentPurpose, bookingId: number, reason: string, bookingStatus: string) {
  const key = appointmentLinkKey[purpose];
  if (Number(episode.data[key]?.bookingId) !== bookingId) throw new HttpError(409, 'The appointment is no longer linked to this episode. Review the episode and task again.');
  const task = episode.data.appointmentReconciliation?.find(item => item.bookingId === bookingId && item.status === 'required');
  if (!task) throw new HttpError(409, 'This appointment reconciliation task is already resolved or no longer applies.');
  episode.data[key] = { ...episode.data[key]!, confirmed: false, postponed: true };
  episode.data.appointmentReconciliation = (episode.data.appointmentReconciliation ?? []).map(item => item.bookingId === bookingId ? { ...item, status: 'resolved' as const } : item);
  await client.query("update gamma_knife_operation_task_assignments set status='resolved',updated_at=now(),updated_by_user_id=$3 where episode_id=$1 and task_key=$2", [episode.id, `appointment_reconciliation:${bookingId}`, actor.sub]);
  await episodeWorkflowHistory(client, episode, actor, 'appointment_reconciliation_resolved', reason, { purpose, bookingId, bookingStatus });
}

export async function reconcileEpisodeAppointment(actor: Actor, episodeId: unknown, bookingIdValue: unknown, input: unknown) {
  await authorize(actor, 'scheduling');
  const body = record(input); const bookingId = id(bookingIdValue); const reason = text(body.reason, 'Appointment reconciliation reason', true, 1000);
  const initial = await transaction(async client => {
    const episode = await findEpisode(episodeId, client, true); checkEpisodeRevision(episode, body.revision);
    const task = episode.data.appointmentReconciliation?.find(item => item.bookingId === bookingId && item.status === 'required');
    if (!task) throw new HttpError(404, 'Appointment reconciliation task not found.');
    const link = episode.data[appointmentLinkKey[task.purpose]];
    if (Number(link?.bookingId) !== bookingId) throw new HttpError(409, 'The appointment is no longer linked to this episode.');
    return { revision: episode.revision, purpose: task.purpose, patientId: episode.patientId };
  });
  const snapshot = await pool.query<{ status: string; patient_id: number; updated_at: string }>('select status,patient_id,updated_at::text from appointments_v2.bookings where id=$1 and voided_at is null', [bookingId]);
  if (!snapshot.rows[0] || !['scheduled','arrived','waiting'].includes(snapshot.rows[0].status)) {
    return transaction(async client => {
      await authorize(actor, 'scheduling', client);
      const episode = await findEpisode(episodeId, client, true); checkEpisodeRevision(episode, initial.revision);
      await resolveAppointmentReconciliation(client, episode, actor, initial.purpose, bookingId, reason, snapshot.rows[0]?.status ?? 'missing');
      return { episode, reconciliationRequired: false };
    });
  }
  if (Number(snapshot.rows[0].patient_id) !== initial.patientId) return { episode: await findEpisode(episodeId), reconciliationRequired: true, message: 'The appointment belongs to another patient and remains in the exception queue for authorized review.' };
  try {
    await cancelBooking(bookingId, Number(actor.sub), async (client, cancelled) => {
      await authorize(actor, 'scheduling', client);
      const episode = await findEpisode(episodeId, client, true); checkEpisodeRevision(episode, initial.revision);
      await resolveAppointmentReconciliation(client, episode, actor, initial.purpose, bookingId, reason, cancelled.previousStatus);
    }, snapshot.rows[0]!.updated_at);
    return { episode: await findEpisode(episodeId), reconciliationRequired: false };
  } catch (error) {
    if (!(error instanceof SchedulingError)) throw error;
    return { episode: await findEpisode(episodeId), reconciliationRequired: true, message: error.message };
  }
}

export async function withdrawEpisode(actor: Actor, episodeId: unknown, input: unknown) {
  const body = record(input);
  const reason = text(body.reason, 'Withdrawal reason', true, 1000);
  if (body.confirmed !== true) throw new HttpError(400, 'Confirm that this genuine referral is being withdrawn.');
  await authorize(actor, 'referral');
  const validate = async (client: PoolClient, episode: Episode) => {
    if (!episode.active) throw new HttpError(409, 'This episode is already closed.');
    if (episode.data.mdt?.decision === 'not_suitable') throw new HttpError(409, 'Not suitable is an MDT outcome and must remain separate from referral withdrawal.');
    if (await hasDeliveredTreatment(client, episode.id)) throw new HttpError(409, 'Delivered or completed treatment cannot be withdrawn through the ordinary referral workflow. Use the authorized clinical correction process.');
    if (await hasSignificantEpisodeEvidence(client, episode)) {
      if (!['supervisor','super_admin'].includes(actor.role)) throw new HttpError(403, 'This episode contains clinical evidence and requires an authorized administrator or clinician to resolve.');
      await authorize(actor, 'episode_correction', client);
    }
  };
  const reconciliation = await reconcileEpisodeAppointments(actor, episodeId, Number(body.revision), ['treatment','followup'], reason, validate);
  return transaction(async client => {
    await authorize(actor, 'referral', client);
    const episode = await findEpisode(episodeId, client, true);
    checkEpisodeRevision(episode, reconciliation.revision);
    await validate(client, episode);
    await recordAppointmentReconciliation(client, episode, actor, reconciliation.pending);
    episode.active = false;
    episode.status = 'closed';
    episode.closureClassification = 'withdrawn';
    episode.data.closureReason = reason;
    episode.qrActive = false;
    await client.query('update gamma_knife_episodes set qr_hash=null where id=$1', [episode.id]);
    await episodeWorkflowHistory(client, episode, actor, 'referral_withdrawn', reason, { classification: 'withdrawn', appointmentReconciliationRequired: reconciliation.pending.map(item => item.bookingId) });
    return { episode, reconciliationRequired: reconciliation.pending.length > 0, reconciliationPending: reconciliation.pending.map(item => item.bookingId) };
  });
}

export async function markEpisodeEnteredInError(actor: Actor, episodeId: unknown, input: unknown) {
  const body = record(input);
  const reason = text(body.reason, 'Entered-in-error reason', true, 1000);
  if (body.confirmed !== true) throw new HttpError(400, 'Confirm that this episode was registered in error.');
  await authorize(actor, 'episode_correction');
  const validate = async (client: PoolClient, episode: Episode) => {
    if (!episode.active) throw new HttpError(409, 'This episode is already closed.');
    const significant = await hasSignificantEpisodeEvidence(client, episode);
    const delivered = await hasDeliveredTreatment(client, episode.id);
    if (significant || delivered) {
      if (!['doctor','supervisor','super_admin'].includes(actor.role)) throw new HttpError(403, 'This episode contains clinical evidence and requires an authorized clinician or administrator to resolve.');
      if (body.correctedPatientId == null || String(body.correctedPatientId).trim() === '') throw new HttpError(409, 'Select and confirm the correct patient before resolving an episode with clinical evidence.');
      const correctedPatientId = id(body.correctedPatientId);
      const confirmedMrn = text(body.confirmationPatientMrn, 'Confirmed patient MRN', true, 80);
      const confirmedName = text(body.confirmationPatientName, 'Confirmed patient name', true, 250).toLocaleLowerCase();
      const patient = await client.query<{ id: number; mrn: string; arabic_full_name: string; english_full_name: string | null }>('select id,mrn,arabic_full_name,english_full_name from patients where id=$1 for key share', [correctedPatientId]);
      const selected = patient.rows[0];
      const validNames = selected ? [selected.arabic_full_name,selected.english_full_name].filter(Boolean).map(value => String(value).trim().toLocaleLowerCase()) : [];
      if (!selected || selected.mrn !== confirmedMrn || !validNames.includes(confirmedName)) throw new HttpError(409, 'Confirm the corrected patient by entering the same MRN and registered name shown for that patient.');
    }
  };
  const reconciliation = await reconcileEpisodeAppointments(actor, episodeId, Number(body.revision), ['treatment','followup'], reason, validate);
  return transaction(async client => {
    await authorize(actor, 'episode_correction', client);
    const episode = await findEpisode(episodeId, client, true);
    checkEpisodeRevision(episode, reconciliation.revision);
    await validate(client, episode);
    let attributionDetails: Record<string, unknown> = {};
    const significant = await hasSignificantEpisodeEvidence(client, episode);
    const delivered = await hasDeliveredTreatment(client, episode.id);
    if (significant || delivered) {
      const correctedPatientId = id(body.correctedPatientId);
      const patient = await client.query<{ id: number; mrn: string; arabic_full_name: string; english_full_name: string | null; national_id: string | null; sex: string | null; estimated_date_of_birth: string | null }>('select id,mrn,arabic_full_name,english_full_name,national_id,sex,estimated_date_of_birth from patients where id=$1 for key share', [correctedPatientId]);
      const selected = patient.rows[0]!;
      const correctedName = selected.english_full_name || selected.arabic_full_name;
      if (correctedPatientId !== episode.patientId) {
        const original = await client.query<{ id: number; mrn: string; arabic_full_name: string; english_full_name: string | null; national_id: string | null; sex: string | null; estimated_date_of_birth: string | null }>('select id,mrn,arabic_full_name,english_full_name,national_id,sex,estimated_date_of_birth from patients where id=$1', [episode.patientId]);
        const saved = await client.query(`insert into gamma_knife_patient_attribution_corrections(episode_id,original_patient_id,corrected_patient_id,original_patient_snapshot,corrected_patient_snapshot,confirmed_mrn,confirmed_name,reason,authorized_by_user_id)
          values($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9) returning id`, [episode.id,episode.patientId,correctedPatientId,JSON.stringify(identitySnapshot(original.rows[0]!)),JSON.stringify(identitySnapshot(selected)),selected.mrn,correctedName,reason,actor.sub]);
        episode.data.patientAttributionCorrectionId = Number(saved.rows[0]!.id);
        attributionDetails = { patientAttributionCorrectionId: Number(saved.rows[0]!.id), originalPatientId: episode.patientId, correctedPatientId, correctedPatientMrn: selected.mrn, correctedPatientName: correctedName, clinicalRecordAttributionPreserved: true };
      } else attributionDetails = { duplicateEpisodeConfirmedPatientId: episode.patientId, confirmedPatientMrn: selected.mrn, clinicalRecordAttributionPreserved: true };
    }
    await recordAppointmentReconciliation(client, episode, actor, reconciliation.pending);
    episode.active = false;
    episode.status = 'closed';
    episode.closureClassification = 'entered_in_error';
    episode.data.closureReason = reason;
    episode.qrActive = false;
    await client.query('update gamma_knife_episodes set qr_hash=null where id=$1', [episode.id]);
    await episodeWorkflowHistory(client, episode, actor, 'episode_entered_in_error', reason, { classification: 'entered_in_error', ...attributionDetails, appointmentReconciliationRequired: reconciliation.pending.map(item => item.bookingId) });
    return { episode, reconciliationRequired: reconciliation.pending.length > 0, reconciliationPending: reconciliation.pending.map(item => item.bookingId) };
  });
}

function identitySnapshot(patient: { id: number; mrn: string; national_id: string | null; arabic_full_name: string; english_full_name: string | null; sex: string | null; estimated_date_of_birth: string | null }) {
  return { patientId: patient.id, mrn: patient.mrn, nationalId: patient.national_id, arabicFullName: patient.arabic_full_name, englishFullName: patient.english_full_name, sex: patient.sex, dateOfBirth: patient.estimated_date_of_birth };
}

export async function reverseEpisodeClosure(actor: Actor, episodeId: unknown, input: unknown) {
  const body = record(input);
  const reason = text(body.reason, 'Correction reason', true, 1000);
  if (!['supervisor','super_admin'].includes(actor.role)) throw new HttpError(403, 'An authorized RISpro administrator is required to reverse an episode closure.');
  return transaction(async client => {
    await authorize(actor, 'episode_correction', client);
    const episode = await findEpisode(episodeId, client, true);
    checkEpisodeRevision(episode, body.revision);
    if (episode.active || !['entered_in_error','withdrawn'].includes(episode.closureClassification ?? '')) throw new HttpError(409, 'Only an episode closed as withdrawn or entered in error can be reinstated through this workflow.');
    if (episode.replacementEpisodeId) throw new HttpError(409, 'This episode already has a linked replacement. Review both episodes through the authorized correction process before reinstating either one.');
    const attributionCorrection = await client.query('select 1 from gamma_knife_patient_attribution_corrections where episode_id=$1', [episode.id]);
    if (attributionCorrection.rows.length) throw new HttpError(409, 'This episode has an authorized wrong-patient correction. Resolve the patient attribution through the correction process before reversing closure.');
    const before = { status: episode.status, closureClassification: episode.closureClassification, closureReason: episode.data.closureReason };
    episode.active = true;
    episode.closureClassification = null;
    episode.status = episode.data.clinical ? 'clinical_review' : 'referrals';
    delete episode.data.closureReason;
    episode.data.referralReviewRequired = Boolean(episode.data.clinical);
    episode.data.mdtReviewRequired = Boolean(episode.data.mdt);
    await episodeWorkflowHistory(client, episode, actor, 'episode_closure_reversed', reason, { before, after: { status: episode.status, active: true } });
    return { episode };
  });
}

export async function updateEpisodePatientContact(actor: Actor, episodeId: unknown, input: unknown) {
  const body = record(input);
  const reason = text(body.reason, 'Contact correction reason', true, 1000);
  return transaction(async client => {
    await authorize(actor, 'referral', client);
    const episode = await findEpisode(episodeId, client, true);
    checkEpisodeRevision(episode, body.revision);
    const previous = await getPatientById(episode.patientId, client);
    const updated = await updatePatientContactDetails(episode.patientId, { phone1: body.phone1, phone2: body.phone2, address: body.address }, actor.sub, client);
    await episodeWorkflowHistory(client, episode, actor, 'patient_contact_corrected', reason, { before: { phone1: previous.phone_1, phone2: previous.phone_2, address: previous.address }, after: { phone1: updated.phone_1, phone2: updated.phone_2, address: updated.address } });
    return { episode, patientDemographics: { id: Number(updated.id), mrn: updated.mrn, arabicFullName: updated.arabic_full_name, englishFullName: updated.english_full_name, nationalId: updated.national_id, identifierType: updated.identifier_type, identifierValue: updated.identifier_value, identifiers: updated.identifiers ?? [], ageYears: updated.age_years, demographicsEstimated: updated.demographics_estimated, sex: updated.sex, dateOfBirth: updated.estimated_date_of_birth, phone1: updated.phone_1, phone2: updated.phone_2, address: updated.address } };
  });
}

const SENSITIVE_PATIENT_FIELDS: Record<string, { label: string; max: number }> = {
  arabicFullName: { label: 'Arabic full name', max: 200 }, englishFullName: { label: 'English full name', max: 200 },
  nationalId: { label: 'National ID', max: 50 }, identifierType: { label: 'Identifier type', max: 40 }, identifierValue: { label: 'Identifier value', max: 100 },
  sex: { label: 'Sex', max: 20 }, dateOfBirth: { label: 'Date of birth', max: 20 },
};

export async function requestPatientIdentityCorrection(actor: Actor, episodeId: unknown, input: unknown) {
  const body = record(input); const fields = record(body.requestedFields); const reason = text(body.reason, 'Correction request reason', true, 1000);
  const requestedFields: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    const definition = SENSITIVE_PATIENT_FIELDS[key];
    if (!definition) throw new HttpError(400, 'Choose only sensitive identity fields supported by the patient record.');
    requestedFields[key] = text(value, definition.label, true, definition.max);
  }
  if (!Object.keys(requestedFields).length) throw new HttpError(400, 'Select at least one identity field to correct.');
  if (requestedFields.dateOfBirth) requestedFields.dateOfBirth = date(requestedFields.dateOfBirth);
  return transaction(async client => {
    await authorize(actor, 'referral', client);
    const episode = await findEpisode(episodeId, client, true); checkEpisodeRevision(episode, body.revision);
    const inserted = await client.query(`insert into gamma_knife_patient_identity_correction_requests(episode_id,patient_id,requested_fields,reason,requested_by_user_id)
      values($1,$2,$3::jsonb,$4,$5) returning id,episode_id as "episodeId",patient_id as "patientId",requested_fields as "requestedFields",reason,status,created_at as "createdAt"`, [episode.id, episode.patientId, JSON.stringify(requestedFields), reason, actor.sub]);
    await episodeWorkflowHistory(client, episode, actor, 'patient_identity_correction_requested', reason, { correctionRequestId: Number(inserted.rows[0]!.id), fields: Object.keys(requestedFields) });
    return { request: { ...inserted.rows[0], id: Number(inserted.rows[0]!.id), episodeId: Number(inserted.rows[0]!.episodeId), patientId: Number(inserted.rows[0]!.patientId) }, episode };
  });
}

export async function decidePatientIdentityCorrection(actor: Actor, episodeId: unknown, requestId: unknown, input: unknown) {
  const body = record(input); const decision = String(body.decision);
  if (decision !== 'approved' && decision !== 'rejected') throw new HttpError(400, 'Choose approve or reject.');
  const reason = text(body.reason, 'Decision reason', true, 1000);
  if (!['supervisor','super_admin'].includes(actor.role)) throw new HttpError(403, 'An authorized identity-management administrator is required.');
  return transaction(async client => {
    await authorize(actor, 'identity_review', client);
    const episode = await findEpisode(episodeId, client, true); checkEpisodeRevision(episode, body.revision);
    const request = await client.query('select id,status,requested_fields,reason from gamma_knife_patient_identity_correction_requests where id=$1 and episode_id=$2 for update', [id(requestId), episode.id]);
    if (!request.rows.length) throw new HttpError(404, 'Identity correction request not found.');
    if (request.rows[0]!.status !== 'pending') throw new HttpError(409, 'This identity correction request has already been reviewed.');
    const updated = await client.query(`update gamma_knife_patient_identity_correction_requests set status=$2,decided_by_user_id=$3,decision_reason=$4,decided_at=now()
      where id=$1 returning id,status,decision_reason as "decisionReason",decided_at as "decidedAt"`, [id(requestId), decision, actor.sub, reason]);
    await episodeWorkflowHistory(client, episode, actor, `patient_identity_correction_${decision}`, reason, { correctionRequestId: id(requestId), requestedFields: request.rows[0]!.requested_fields });
    return { request: { ...updated.rows[0], id: Number(updated.rows[0]!.id) }, episode };
  });
}

export async function completePatientIdentityCorrection(actor: Actor, episodeId: unknown, requestId: unknown, input: unknown) {
  if (!['supervisor','super_admin'].includes(actor.role)) throw new HttpError(403, 'An authorized identity-management administrator is required.');
  const body = record(input);
  const reason = text(body.reason, 'Handoff confirmation reason', true, 1000);
  return transaction(async client => {
    await authorize(actor, 'identity_review', client);
    const episode = await findEpisode(episodeId, client, true);
    checkEpisodeRevision(episode, body.revision);
    const request = await client.query(`select id,status,requested_fields,decided_at,patient_update_completed_at
      from gamma_knife_patient_identity_correction_requests where id=$1 and episode_id=$2 for update`, [id(requestId), episode.id]);
    const row = request.rows[0];
    if (!row || row.status !== 'approved') throw new HttpError(409, 'Approve the identity request before confirming its patient-record update.');
    if (row.patient_update_completed_at) throw new HttpError(409, 'The Core patient update has already been recorded for this request.');
    const patient = await client.query<Record<string, unknown>>(`select id,arabic_full_name,english_full_name,national_id,identifier_type,identifier_value,sex,estimated_date_of_birth
      from patients where id=$1 for key share`, [episode.patientId]);
    const identity = patient.rows[0];
    if (!identity) throw new HttpError(404, 'The patient record is no longer available.');
    const columns: Record<string, string> = { arabicFullName: 'arabic_full_name', englishFullName: 'english_full_name', nationalId: 'national_id', identifierType: 'identifier_type', identifierValue: 'identifier_value', sex: 'sex', dateOfBirth: 'estimated_date_of_birth' };
    const requested = row.requested_fields as Record<string, string>;
    const normalized = (value: unknown, field: string) => {
      const result = String(value ?? '').trim().toLocaleLowerCase();
      return field === 'dateOfBirth' ? result.slice(0, 10) : result;
    };
    for (const [field, desired] of Object.entries(requested)) {
      const actual = identity[columns[field]!];
      if (normalized(actual, field) !== normalized(desired, field)) {
        throw new HttpError(409, `The existing patient-edit workflow has not yet applied the requested ${SENSITIVE_PATIENT_FIELDS[field]?.label ?? 'identity'} value.`);
      }
    }
    const audit = await client.query<{ changed_by_user_id: number; created_at: string; new_values: Record<string, unknown> }>(`select changed_by_user_id,created_at,new_values from audit_log
      where entity_type='patient' and entity_id=$1 and action_type='update' and created_at >= $2 and changed_by_user_id is not null
      order by created_at desc,id desc`, [episode.patientId, row.decided_at]);
    const matching = audit.rows.find(entry => Object.entries(requested).every(([field, desired]) => {
      const saved = entry.new_values?.[columns[field]!];
      return normalized(saved, field) === normalized(desired, field);
    }));
    if (!matching) throw new HttpError(409, 'The requested values are present, but no matching audited update from the Core patient-edit workflow was found after approval.');
    await client.query(`update gamma_knife_patient_identity_correction_requests
      set patient_update_completed_at=$2,patient_update_completed_by_user_id=$3 where id=$1`, [id(requestId), matching.created_at, matching.changed_by_user_id]);
    await episodeWorkflowHistory(client, episode, actor, 'patient_identity_correction_handoff_completed', reason, { correctionRequestId: id(requestId), updatedByUserId: Number(matching.changed_by_user_id), updatedAt: matching.created_at });
    return { episode, request: { id: id(requestId), status: 'approved', patientUpdateCompletedAt: matching.created_at, patientUpdateCompletedByUserId: Number(matching.changed_by_user_id) } };
  });
}

export async function addPostClosureCorrection(actor: Actor, episodeId: unknown, input: unknown) {
  const body = record(input); const kind = String(body.kind);
  if (kind !== 'clinical_addendum' && kind !== 'administrative_correction') throw new HttpError(400, 'Choose a clinical addendum or administrative correction.');
  const affectedRecord = text(body.affectedRecord, 'Affected record', true, 250);
  const reason = text(body.reason, 'Correction reason', true, 1000);
  const content = text(body.content, kind === 'clinical_addendum' ? 'Addendum' : 'Corrected administrative information', true, 4000);
  return transaction(async client => {
    await authorize(actor, kind === 'clinical_addendum' ? 'clinical' : 'episode_correction', client);
    if (kind === 'administrative_correction' && !['supervisor','super_admin'].includes(actor.role)) throw new HttpError(403, 'An authorized administrator is required for post-closure administrative corrections.');
    const episode = await findEpisode(episodeId, client, true);
    checkEpisodeRevision(episode, body.revision);
    if (episode.active) throw new HttpError(409, 'Post-closure corrections are available only after the episode is closed.');
    const previousContent = await authoritativeCorrectionContent(client, episode, affectedRecord, kind);
    const correctedContent = { addendum: content };
    const inserted = await client.query(`insert into gamma_knife_post_closure_corrections(episode_id,kind,affected_record,reason,previous_content,corrected_content,created_by_user_id)
      values($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7) returning id`, [episode.id, kind, affectedRecord, reason, JSON.stringify(previousContent), JSON.stringify(correctedContent), actor.sub]);
    await episodeWorkflowHistory(client, episode, actor, 'post_closure_correction_added', reason, { correctionId: Number(inserted.rows[0]!.id), kind, affectedRecord, previousContent, correctedContent });
    return { id: Number(inserted.rows[0]!.id), episode };
  });
}

async function authoritativeCorrectionContent(client: PoolClient, episode: Episode, key: string, kind: string): Promise<Record<string, unknown>> {
  if (key === 'referral' && kind === 'administrative_correction') return { diagnosis: episode.diagnosis, diagnosisCategory: episode.diagnosisCategory, referral: episode.data.referral ?? null };
  if (key === 'clinical_assessment' && kind === 'clinical_addendum' && episode.data.clinical) return episode.data.clinical as unknown as Record<string, unknown>;
  if (key === 'mdt_decision' && kind === 'clinical_addendum' && episode.data.mdt) return episode.data.mdt as unknown as Record<string, unknown>;
  const courseMatch = /^treatment_course:(\d+)$/.exec(key);
  if (courseMatch && kind === 'clinical_addendum') {
    const course = await client.query<{ value: Record<string, unknown> }>('select to_jsonb(c) as value from gamma_knife_treatment_courses c where c.id=$1 and c.episode_id=$2', [Number(courseMatch[1]), episode.id]);
    if (course.rows[0]) return course.rows[0].value;
  }
  const followupMatch = /^followup:([a-f0-9-]+)$/i.exec(key);
  if (followupMatch && kind === 'clinical_addendum') {
    const followup = episode.data.followups?.find(item => item.id === followupMatch[1]);
    if (followup) return followup as unknown as Record<string, unknown>;
  }
  throw new HttpError(400, 'Select an existing record of a type supported for this correction.');
}
export async function documentsForEpisode(episodeId: number, db: Db = pool): Promise<EpisodeDocument[]> {
  const config = await readConfig(db);
  const result = await db.query('select d.id,d.original_filename as name,g.category,g.released from gamma_knife_documents g join documents d on d.id=g.document_id where g.episode_id=$1 and g.removed_at is null order by g.created_at desc', [episodeId]);
  return result.rows.map(d => ({ ...d, id: Number(d.id), visibility: config.documentVisibility[d.category as typeof CATEGORIES[number]] } as EpisodeDocument));
}
async function workflowRecords(episodeId: number, db: Db = pool) {
  const courses = await db.query(`select id,episode_id as "episodeId",course_number as "courseNumber",prior_course_id as "priorCourseId",reassessment_id as "reassessmentId",
    immobilization,planned_fraction_count as "plannedFractionCount",gamma_plan_reference as "gammaPlanReference",target_references as "targetReferences",status,source,
    legacy_treatment_snapshot as "legacyTreatmentSnapshot",completion_reason as "completionReason",completed_at::text as "completedAt",
    report_document_id as "reportId",documentation_finalized as "documentationFinalized"
    from gamma_knife_treatment_courses where episode_id=$1 order by course_number,id`, [episodeId]);
  const fractions = await db.query(`select f.id,c.id as "courseId",f.planned_fraction_number as "plannedFractionNumber",f.status,f.event_date::text as "eventDate",
    f.operator_name as "operatorName",f.gamma_plan_reference as "gammaPlanReference",f.notes,f.created_by as "createdBy",f.created_at as "createdAt"
    from gamma_knife_treatment_fractions f join gamma_knife_treatment_courses c on c.id=f.course_id
    where c.episode_id=$1 order by f.event_date,f.id`, [episodeId]);
  const courseHistory = await db.query(`select h.course_id as "courseId",h.action,h.reason,h.snapshot,u.full_name as actor,h.created_at as "createdAt"
    from gamma_knife_treatment_history h join gamma_knife_treatment_courses c on c.id=h.course_id join users u on u.id=h.actor_id
    where c.episode_id=$1 order by h.created_at,h.id`, [episodeId]);
  const reassessments = await db.query(`select r.id,r.episode_id as "episodeId",r.course_id as "courseId",r.reason,r.reason_detail as "reasonDetail",r.status,
    d.decision,d.assessment,d.notes,d.consultants,d.reason as "decisionReason",d.revision,d.created_at as "decisionAt"
    from gamma_knife_reassessments r left join lateral (select * from gamma_knife_reassessment_decisions x where x.reassessment_id=r.id order by revision desc limit 1) d on true
    where r.episode_id=$1 order by r.requested_at,r.id`, [episodeId]);
  const reassessmentDecisions = await db.query(`select d.reassessment_id as "reassessmentId",d.decision,d.assessment,d.notes,d.consultants,d.reason,d.revision,d.created_at as "createdAt"
    from gamma_knife_reassessment_decisions d join gamma_knife_reassessments r on r.id=d.reassessment_id where r.episode_id=$1 order by d.revision,d.id`, [episodeId]);
    const investigations = await db.query(`select i.id,i.episode_id as "episodeId",reassessment_id as "reassessmentId",requested_text as "requestedText",
      responsible_user_id as "responsibleUserId",responsible_name_snapshot as "responsibleName",due_date::text as "dueDate",i.priority,i.status,
    evidence_document_id as "evidenceDocumentId",received_note as "receivedNote",i.created_at as "createdAt"
    from gamma_knife_investigations i where i.episode_id=$1 order by (i.status='requested') desc,i.due_date nulls last,i.created_at,i.id`, [episodeId]);
  const investigationHistoryRows = await db.query(`select h.investigation_id as "investigationId",h.action,h.reason,h.snapshot,u.full_name as actor,h.created_at as "createdAt"
    from gamma_knife_investigation_history h join gamma_knife_investigations i on i.id=h.investigation_id join users u on u.id=h.actor_id
    where i.episode_id=$1 order by h.created_at,h.id`, [episodeId]);
  const readinessItems = await db.query(`select r.id,r.episode_id as "episodeId",r.item_key as "itemKey",r.label,r.required,r.status,r.responsible_user_id as "responsibleUserId",owner.full_name as "responsibleName",r.due_date::text as "dueDate",r.priority,r.notes,r.completed_at as "completedAt",completed.full_name as "completedBy"
    from gamma_knife_readiness_items r left join users owner on owner.id=r.responsible_user_id left join users completed on completed.id=r.completed_by_user_id where r.episode_id=$1 order by r.required desc,r.due_date nulls last,r.id`, [episodeId]);
  const communications = await db.query(`select c.id,c.episode_id as "episodeId",c.kind,c.outcome,c.notes,c.next_action as "nextAction",c.next_action_date::text as "nextActionDate",u.full_name as "createdBy",c.created_at as "createdAt"
    from gamma_knife_patient_communications c join users u on u.id=c.created_by_user_id where c.episode_id=$1 order by c.created_at desc,c.id desc`, [episodeId]);
  const courseRows = courses.rows.map(row => ({ ...row, id: Number(row.id), episodeId: Number(row.episodeId), courseNumber: Number(row.courseNumber), priorCourseId: row.priorCourseId == null ? null : Number(row.priorCourseId), reassessmentId: row.reassessmentId == null ? null : Number(row.reassessmentId), plannedFractionCount: Number(row.plannedFractionCount), fractions: fractions.rows.filter(f => Number(f.courseId) === Number(row.id)).map(f => ({ ...f, id: Number(f.id), createdBy: Number(f.createdBy) })), history: courseHistory.rows.filter(h => Number(h.courseId) === Number(row.id)).map(h => ({ action: h.action, reason: h.reason, snapshot: h.snapshot, actor: h.actor, createdAt: h.createdAt })) } as TreatmentCourse));
  return {
    courses: courseRows,
    reassessments: reassessments.rows.map(row => ({ id: Number(row.id), episodeId: Number(row.episodeId), courseId: Number(row.courseId), reason: row.reason, reasonDetail: row.reasonDetail, status: row.status, decision: row.decision ? { decision: row.decision, assessment: row.assessment, notes: row.notes, consultants: row.consultants, reason: row.decisionReason, revision: Number(row.revision), createdAt: row.decisionAt } : null, decisionHistory: reassessmentDecisions.rows.filter(item => Number(item.reassessmentId) === Number(row.id)).map(item => ({ decision: item.decision, assessment: item.assessment, notes: item.notes, consultants: item.consultants, reason: item.reason, revision: Number(item.revision), createdAt: item.createdAt })) } as Reassessment)),
    investigations: investigations.rows.map(row => ({ ...row, id: Number(row.id), episodeId: Number(row.episodeId), reassessmentId: row.reassessmentId == null ? null : Number(row.reassessmentId), responsibleUserId: row.responsibleUserId == null ? null : Number(row.responsibleUserId), evidenceDocumentId: row.evidenceDocumentId == null ? null : Number(row.evidenceDocumentId), history: investigationHistoryRows.rows.filter(h => Number(h.investigationId) === Number(row.id)).map(h => ({ action: h.action, reason: h.reason, snapshot: h.snapshot, actor: h.actor, createdAt: h.createdAt })) } as Investigation)),
    readinessItems: readinessItems.rows.map(row => ({ ...row, id: Number(row.id), episodeId: Number(row.episodeId), responsibleUserId: row.responsibleUserId == null ? null : Number(row.responsibleUserId) } as ReadinessItem)),
    communications: communications.rows.map(row => ({ ...row, id: Number(row.id), episodeId: Number(row.episodeId) } as PatientCommunication)),
  };
}
export async function profile(actor: Actor, episodeId: unknown) {
  await authorize(actor); const episode = await findEpisode(episodeId);
  const past = await pool.query<{ id: number; status: string }>('select id,status from gamma_knife_episodes where patient_id=$1 order by created_at desc', [episode.patientId]);
  const revisions = await pool.query('select h.revision,h.action,h.snapshot,h.created_at as "createdAt",u.full_name as actor from gamma_knife_history h join users u on u.id=h.actor_id where h.episode_id=$1 order by h.revision desc', [episode.id]);
  const config = await readConfig();
  const linkedBookingIds = [episode.data.treatmentAppointment?.bookingId, episode.data.followupAppointment?.bookingId].filter((value): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0);
  const examTypeIds = [config.treatmentExamTypeId, config.followupExamTypeId].filter((value): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0);
  const appointments = await pool.query(`select id,booking_date::text as date,booking_time::text as time,status,exam_type_id as "examTypeId"
    from appointments_v2.bookings where patient_id=$1 and (id=any($2::bigint[]) or (exam_type_id=any($3::bigint[]) and status='scheduled' and voided_at is null))
    order by booking_date desc,id desc limit 100`, [episode.patientId, linkedBookingIds, examTypeIds]);
  const workflow = await workflowRecords(episode.id);
  const historicalTreatment = await historicalTreatments(episode.id);
  const patient = await getPatientById(episode.patientId);
  const correctionRequests = await pool.query(`select r.id,r.episode_id as "episodeId",r.patient_id as "patientId",r.requested_fields as "requestedFields",r.reason,r.status,
    requester.full_name as "requestedBy",r.created_at as "createdAt",decider.full_name as "decidedBy",r.decision_reason as "decisionReason",r.decided_at as "decidedAt",
    update_actor.full_name as "patientUpdateCompletedBy",r.patient_update_completed_at as "patientUpdateCompletedAt"
    from gamma_knife_patient_identity_correction_requests r join users requester on requester.id=r.requested_by_user_id left join users decider on decider.id=r.decided_by_user_id
    left join users update_actor on update_actor.id=r.patient_update_completed_by_user_id
    where r.episode_id=$1 order by r.created_at desc,r.id desc`, [episode.id]);
  const postClosureCorrections = await pool.query(`select c.id,c.kind,c.affected_record as "affectedRecord",c.reason,c.previous_content as "previousContent",c.corrected_content as "correctedContent",u.full_name as author,c.created_at as "createdAt"
    from gamma_knife_post_closure_corrections c join users u on u.id=c.created_by_user_id where c.episode_id=$1 order by c.created_at desc,c.id desc`, [episode.id]);
  const reassessmentReady = workflow.reassessments.some(item => item.status === 'requested');
  const granted = await permissions(actor);
  return { episode, patientDemographics: { id: Number(patient.id), mrn: patient.mrn, arabicFullName: patient.arabic_full_name, englishFullName: patient.english_full_name, nationalId: patient.national_id, identifierType: patient.identifier_type, identifierValue: patient.identifier_value, identifiers: patient.identifiers ?? [], ageYears: patient.age_years, demographicsEstimated: patient.demographics_estimated, sex: patient.sex, dateOfBirth: patient.estimated_date_of_birth, phone1: patient.phone_1, phone2: patient.phone_2, address: patient.address }, correctionRequests: correctionRequests.rows.map(row => ({ ...row, id: Number(row.id), episodeId: Number(row.episodeId), patientId: Number(row.patientId) })), postClosureCorrections: postClosureCorrections.rows.map(row => ({ ...row, id: Number(row.id) })), history: revisions.rows.filter(h => granted.includes('documents') || !String(h.action).startsWith('document_')), episodes: past.rows.map(e => ({ ...e, id: Number(e.id) })), documents: granted.includes('documents') ? await documentsForEpisode(episode.id) : [], appointments: appointments.rows.map(a => ({ ...a, id: Number(a.id), examTypeId: Number(a.examTypeId) })), ...workflow, historicalTreatment, config, permissions: granted, canAccessCore: hasModuleAccess(await resolveModuleAccess(actor.sub), 'core'), nextAction: reassessmentReady ? 'Record MDT decision for post-treatment reassessment' : nextAction(episode) };
}
export async function investigationAssignees(actor: Actor) {
  await authorize(actor);
  const granted = await permissions(actor);
  if (!granted.some(permission => ['clinical','mdt','documents','scheduling'].includes(permission))) throw new HttpError(403, 'Gamma Knife workflow permission required.');
  const result = await pool.query(`select id,full_name as name from users where is_active=true and gamma_knife_permissions @> array['access']::text[]
    and gamma_knife_permissions && array['clinical','mdt','documents','scheduling']::text[] order by full_name,id`);
  return result.rows.map(row => ({ ...row, id: Number(row.id) }));
}

function operationalPriority(value: unknown): 'low' | 'normal' | 'high' | 'urgent' {
  if (!['low','normal','high','urgent'].includes(String(value))) throw new HttpError(400, 'Choose a valid task priority.');
  return String(value) as 'low' | 'normal' | 'high' | 'urgent';
}

async function validateOperationalOwner(client: PoolClient, value: unknown): Promise<number | null> {
  if (value == null || String(value).trim() === '') return null;
  const ownerId = id(value);
  const found = await client.query("select 1 from users where id=$1 and is_active=true and gamma_knife_permissions @> array['access']::text[]", [ownerId]);
  if (!found.rows.length) throw new HttpError(400, 'Choose an active Gamma Knife team member as the task owner.');
  return ownerId;
}

export async function createReadinessItem(actor: Actor, episodeId: unknown, input: unknown) {
  const body = record(input); const label = text(body.label, 'Checklist item', true, 250);
  const reason = text(body.reason, 'Reason for adding checklist item', true, 1000);
  const dueDate = body.dueDate == null || String(body.dueDate).trim() === '' ? null : date(body.dueDate);
  const priority = operationalPriority(body.priority ?? 'normal');
  return transaction(async client => {
    await authorize(actor, 'scheduling', client);
    const episode = await findEpisode(episodeId, client, true); checkEpisodeRevision(episode, body.revision);
    if (!episode.active) throw new HttpError(409, 'A closed episode cannot receive an operational readiness item.');
    const ownerId = await validateOperationalOwner(client, body.responsibleUserId);
    const key = `custom_${randomBytes(10).toString('hex')}`;
    const inserted = await client.query(`insert into gamma_knife_readiness_items(episode_id,item_key,label,required,responsible_user_id,due_date,priority,notes,created_by_user_id,updated_by_user_id)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) returning id`, [episode.id, key, label, body.required !== false, ownerId, dueDate, priority, text(body.notes, 'Checklist note', false, 2000), actor.sub]);
    if (body.required !== false && episode.status === 'preparation' && episode.data.preparation?.ready) episode.data.preparation.ready = false;
    await episodeWorkflowHistory(client, episode, actor, 'readiness_item_created', reason, { itemId: Number(inserted.rows[0]!.id), label, required: body.required !== false, episodeStatusPreserved: episode.status });
    return { id: Number(inserted.rows[0]!.id), episode };
  });
}

export async function updateReadinessItem(actor: Actor, episodeId: unknown, itemId: unknown, input: unknown) {
  const body = record(input); const status = String(body.status);
  if (!['pending','in_progress','completed'].includes(status)) throw new HttpError(400, 'Choose a valid checklist status.');
  const dueDate = body.dueDate == null || String(body.dueDate).trim() === '' ? null : date(body.dueDate);
  const priority = operationalPriority(body.priority ?? 'normal');
  return transaction(async client => {
    await authorize(actor, 'scheduling', client);
    const episode = await findEpisode(episodeId, client, true); checkEpisodeRevision(episode, body.revision);
    if (!episode.active) throw new HttpError(409, 'A closed episode cannot change operational readiness.');
    const beforeResult = await client.query('select * from gamma_knife_readiness_items where id=$1 and episode_id=$2 for update', [id(itemId), episode.id]);
    if (!beforeResult.rows.length) throw new HttpError(404, 'Readiness item not found.');
    const before = beforeResult.rows[0] as Record<string, unknown>;
    const required = body.required === undefined ? before.required === true : body.required === true;
    const ownerId = body.responsibleUserId === undefined ? (before.responsible_user_id == null ? null : Number(before.responsible_user_id)) : await validateOperationalOwner(client, body.responsibleUserId);
    const updated = await client.query(`update gamma_knife_readiness_items set required=$2,status=$3,responsible_user_id=$4,due_date=$5,priority=$6,notes=$7,
      completed_at=case when $3='completed' then coalesce(completed_at,now()) else null end,
      completed_by_user_id=case when $3='completed' then coalesce(completed_by_user_id,$8) else null end,
      updated_by_user_id=$8,updated_at=now() where id=$1 returning *`, [id(itemId), required, status, ownerId, dueDate, priority, text(body.notes, 'Checklist note', false, 2000), actor.sub]);
    const reasonRequired = status !== before.status || (body.required !== undefined && required !== (before.required === true));
    const reason = text(body.reason, 'Readiness change reason', reasonRequired, 1000);
    if (required && status !== 'completed' && episode.status === 'preparation' && episode.data.preparation?.ready) episode.data.preparation.ready = false;
    await episodeWorkflowHistory(client, episode, actor, 'readiness_item_updated', reason, { before, after: updated.rows[0], episodeStatusPreserved: episode.status });
    return { episode, itemId: Number(itemId) };
  });
}

export async function recordPatientCommunication(actor: Actor, episodeId: unknown, input: unknown) {
  const body = record(input); const kind = String(body.kind);
  const allowed = ['telephone_attempt','successful_contact','appointment_confirmed','unreachable','postponement_requested','treatment_declined','followup_reminder'];
  if (!allowed.includes(kind)) throw new HttpError(400, 'Choose a valid patient communication outcome.');
  const outcome = text(body.outcome, 'Communication outcome', true, 250);
  const notes = text(body.notes, 'Communication notes', false, 4000);
  const nextAction = text(body.nextAction, 'Next action', false, 250);
  const nextActionDate = body.nextActionDate == null || String(body.nextActionDate).trim() === '' ? null : date(body.nextActionDate);
  return transaction(async client => {
    await authorize(actor, 'scheduling', client);
    const episode = await findEpisode(episodeId, client, true); checkEpisodeRevision(episode, body.revision);
    const inserted = await client.query(`insert into gamma_knife_patient_communications(episode_id,kind,outcome,notes,next_action,next_action_date,created_by_user_id)
      values($1,$2,$3,$4,nullif($5,''),$6,$7) returning id,created_at as "createdAt"`, [episode.id, kind, outcome, notes, nextAction, nextActionDate, actor.sub]);
    await episodeWorkflowHistory(client, episode, actor, 'patient_communication_recorded', outcome, { communicationId: Number(inserted.rows[0]!.id), kind, notes, nextAction, nextActionDate });
    return { episode, communicationId: Number(inserted.rows[0]!.id), createdAt: inserted.rows[0]!.createdAt };
  });
}

export async function recordNextFollowupDate(actor: Actor, episodeId: unknown, input: unknown) {
  const body = record(input);
  const plannedDate = date(body.nextFollowupDate);
  const reason = text(body.reason, 'Clinical follow-up plan reason', true, 1000);
  return transaction(async client => {
    await authorize(actor, 'clinical', client);
    const episode = await findEpisode(episodeId, client, true);
    checkEpisodeRevision(episode, body.revision);
    if (!episode.active || episode.status !== 'followup') throw new HttpError(409, 'A clinical next-follow-up date can be recorded only for an active follow-up episode.');
    const previous = episode.data.nextFollowupDate ?? null;
    episode.data.nextFollowupDate = plannedDate;
    await episodeWorkflowHistory(client, episode, actor, 'next_followup_date_recorded', reason, { previousDate: previous, nextFollowupDate: plannedDate });
    return { episode, nextFollowupDate: plannedDate };
  });
}

export async function assignOperationalTask(actor: Actor, episodeId: unknown, input: unknown) {
  const body = record(input); const rawTaskKey = text(body.taskKey, 'Task', true, 120);
  const taskKey = rawTaskKey === 'followup' ? 'followup_booking' : rawTaskKey;
  const fixedTaskKeys = ['treatment','upcoming_treatment','clinical_assessment','mdt_decision','treatment_scheduling','followup_booking','entered_in_error'];
  const dynamicTask = /^(investigation|readiness|treatment_report|interrupted_course|missing_report|identity_correction|scheduling_conflict|appointment_reconciliation):(\d+)$/.exec(taskKey);
  if (!fixedTaskKeys.includes(taskKey) && !dynamicTask) throw new HttpError(400, 'Choose a current Gamma Knife operational task.');
  const dueDate = body.dueDate == null || String(body.dueDate).trim() === '' ? null : date(body.dueDate);
  const priority = operationalPriority(body.priority ?? 'normal');
  const assignmentStatus = body.status == null || body.status === '' ? 'open' : String(body.status);
  if (!['open','in_progress','resolved','cancelled'].includes(assignmentStatus)) throw new HttpError(400, 'Choose a valid operational task status.');
  return transaction(async client => {
    await authorize(actor, 'scheduling', client);
    const episode = await findEpisode(episodeId, client, true); checkEpisodeRevision(episode, body.revision);
    if (dynamicTask) {
      const table = dynamicTask[1] === 'investigation' ? 'gamma_knife_investigations' : dynamicTask[1] === 'readiness' ? 'gamma_knife_readiness_items' : ['treatment_report','interrupted_course','missing_report'].includes(dynamicTask[1]!) ? 'gamma_knife_treatment_courses' : dynamicTask[1] === 'identity_correction' ? 'gamma_knife_patient_identity_correction_requests' : null;
      const key = dynamicTask[1] === 'scheduling_conflict' ? 'appointments_v2.bookings' : table;
      const idColumn = 'id';
      const found = dynamicTask[1] === 'appointment_reconciliation'
        ? { rows: episode.data.appointmentReconciliation?.some(item => item.bookingId === Number(dynamicTask[2]) && item.status === 'required') ? [{}] : [] }
        : key === 'appointments_v2.bookings'
        ? await client.query('select 1 from appointments_v2.bookings b where b.id=$1 and b.patient_id=$2', [Number(dynamicTask[2]), episode.patientId])
        : key ? await client.query(`select 1 from ${key} where ${idColumn}=$1 and episode_id=$2 and ${dynamicTask[1] === 'investigation' ? "status='requested'" : dynamicTask[1] === 'readiness' ? "status<>'completed'" : dynamicTask[1] === 'identity_correction' ? "(status='pending' or (status='approved' and patient_update_completed_at is null))" : dynamicTask[1] === 'interrupted_course' ? "status='interrupted'" : dynamicTask[1] === 'missing_report' || dynamicTask[1] === 'treatment_report' ? "status='completed' and not documentation_finalized" : 'true'}`, [Number(dynamicTask[2]), episode.id]) : { rows: [] };
      if (!found.rows.length) throw new HttpError(404, 'This operational task no longer exists.');
    } else {
      const currentTask = taskKey === 'clinical_assessment' ? episode.active && ['referrals','clinical_review'].includes(episode.status)
        : taskKey === 'mdt_decision' ? episode.active && (episode.status === 'mdt' || episode.data.mdtReviewRequired === true)
        : taskKey === 'treatment_scheduling' ? episode.active && episode.status === 'preparation'
        : taskKey === 'followup_booking' ? episode.active && episode.status === 'followup'
        : taskKey === 'entered_in_error' ? episode.closureClassification === 'entered_in_error' && !episode.replacementEpisodeId
        : episode.active;
      if (!currentTask) throw new HttpError(404, 'This operational task is no longer active.');
    }
    const ownerId = await validateOperationalOwner(client, body.ownerUserId);
    const saved = await client.query(`insert into gamma_knife_operation_task_assignments(episode_id,task_key,owner_user_id,due_date,priority,updated_by_user_id,status)
      values($1,$2,$3,$4,$5,$6,$7) on conflict(episode_id,task_key) do update set owner_user_id=excluded.owner_user_id,due_date=excluded.due_date,priority=excluded.priority,status=excluded.status,updated_by_user_id=excluded.updated_by_user_id,updated_at=now()
      returning id`, [episode.id, taskKey, ownerId, dueDate, priority, actor.sub, assignmentStatus]);
    await episodeWorkflowHistory(client, episode, actor, 'operation_task_assigned', text(body.reason, 'Task assignment reason', false, 1000), { taskKey, ownerId, dueDate, priority, status: assignmentStatus });
    return { episode, assignmentId: Number(saved.rows[0]!.id) };
  });
}

export async function operationsDashboard(actor: Actor, input: { limit?: unknown; offsets?: Record<string, unknown>; responsibleUserId?: unknown; status?: unknown; priority?: unknown; dueAfter?: unknown; dueBefore?: unknown } = {}) {
  await authorize(actor, 'scheduling');
  const todayDate = getTripoliToday();
  const dashboardConfig = await readConfig();
  const limit = Math.max(1, Math.min(100, Number.isInteger(Number(input.limit)) ? Number(input.limit) : 25));
  const ownerId = input.responsibleUserId == null || input.responsibleUserId === '' ? null : id(input.responsibleUserId);
  const statusFilter = input.status == null || input.status === '' ? null : text(input.status, 'Task status', true, 20);
  if (statusFilter && !['open','in_progress','resolved','cancelled'].includes(statusFilter)) throw new HttpError(400, 'Choose a valid operational task status.');
  const priority = input.priority == null || input.priority === '' ? null : operationalPriority(input.priority);
  const dueAfter = input.dueAfter == null || input.dueAfter === '' ? null : date(input.dueAfter);
  const dueBefore = input.dueBefore == null || input.dueBefore === '' ? null : date(input.dueBefore);
  const offsets = input.offsets ?? {};
  const page = async (name: string, sourceSql: string, orderSql: string) => {
    const offsetValue = Math.max(0, Math.min(100_000, Number.isInteger(Number(offsets[name])) ? Number(offsets[name]) : 0));
    const result = await pool.query<Record<string, unknown>>(`with source_rows as (${sourceSql}), filtered as (
      select q.* from source_rows q where $1::date is not null and $2::int>=0 and ($3::bigint is null or q."ownerUserId"=$3)
        and ($4::text is null or q."assignmentStatus"=$4) and ($5::text is null or q.priority=$5)
        and ($6::date is null or q."dueDate"::date>=$6::date) and ($7::date is null or q."dueDate"::date<=$7::date)
    ), totals as (select count(*)::int as total from filtered)
      select page.*,totals.total from totals left join lateral (select * from filtered order by ${orderSql} limit $8 offset $9) page on true`,
      [todayDate, dashboardConfig.reminderDays, ownerId, statusFilter, priority, dueAfter, dueBefore, limit, offsetValue]);
    const total = Number(result.rows[0]?.total ?? 0);
    const rows = result.rows.filter(row => row.episodeId != null).map(({ total: _total, ...row }) => ({ ...row, episodeId: Number(row.episodeId), episodeRevision: Number(row.episodeRevision), ownerUserId: row.ownerUserId == null ? null : Number(row.ownerUserId), bookingId: row.bookingId == null ? null : Number(row.bookingId) })) as OperationsTask[];
    return { rows, pagination: { limit, offset: offsetValue, total } };
  };
  const taskQueue = async (kind: 'today' | 'upcoming' | 'awaiting' | 'followup' | 'exceptions') => {
    let sourceSql = '';
    let orderSql = '';
    if (kind === 'today' || kind === 'upcoming') {
      const upcoming = kind === 'upcoming';
      sourceSql = `select e.id as "episodeId",e.revision as "episodeRevision",a.owner_user_id as "ownerUserId",p.arabic_full_name as "patientArabicName",p.english_full_name as "patientEnglishName",coalesce(nullif(p.english_full_name,''),p.arabic_full_name) as "patientName",p.mrn,
          '${upcoming ? 'upcoming_treatment' : 'treatment'}'::text as "taskKey",'${upcoming ? 'Upcoming treatment' : 'Today treatment'}'::text as task,owner.full_name as owner,a.due_date::text as "dueDate",coalesce(a.priority,'normal') as priority,coalesce(a.status,'open') as "assignmentStatus",b.status as status,b.id as "bookingId",b.booking_date::text as "appointmentDate",b.booking_time::text as "appointmentTime",coalesce((e.data->'preparation'->>'ready')='true',false) as ready,
          case when coalesce((e.data->'treatmentAppointment'->>'confirmed')::boolean,false)=false then 'Confirm appointment with patient' when coalesce((e.data->'preparation'->>'ready')::boolean,false)=false then 'Review preparation checklist' else 'Review treatment case' end as "nextAction"
        from gamma_knife_episodes e join patients p on p.id=e.patient_id join appointments_v2.bookings b on b.id=(e.data->'treatmentAppointment'->>'bookingId')::bigint and b.patient_id=e.patient_id
        left join gamma_knife_operation_task_assignments a on a.episode_id=e.id and a.task_key='${upcoming ? 'upcoming_treatment' : 'treatment'}' left join users owner on owner.id=a.owner_user_id
        where e.active and b.${upcoming ? `booking_date>$1::date and b.booking_date<=$1::date+14 and b.status='scheduled'` : `booking_date=$1::date and b.status in ('scheduled','arrived','waiting')`} and b.voided_at is null`;
      orderSql = upcoming ? '"appointmentDate", "appointmentTime" nulls last, mrn, "episodeId"' : '"appointmentTime" nulls last, mrn, "episodeId"';
    } else if (kind === 'awaiting') {
      sourceSql = `with tasks as (
        select e.id as episode_id,'clinical_assessment'::text as task_key,'Pending clinical assessment'::text as task,e.status::text as status,null::bigint as owner_id,null::date as due_date,'normal'::text as priority from gamma_knife_episodes e where e.active and e.status in ('referrals','clinical_review')
        union all select e.id,'mdt_decision','Awaiting MDT decision',e.status,null::bigint,null::date,'high' from gamma_knife_episodes e where e.active and (e.status='mdt' or e.data->>'mdtReviewRequired'='true')
        union all select e.id,'investigation:'||i.id::text,'Outstanding investigation: '||i.requested_text,i.status,i.responsible_user_id,i.due_date,i.priority from gamma_knife_investigations i join gamma_knife_episodes e on e.id=i.episode_id where e.active and i.status='requested'
        union all select e.id,'readiness:'||r.id::text,r.label,r.status,r.responsible_user_id,r.due_date,r.priority from gamma_knife_readiness_items r join gamma_knife_episodes e on e.id=r.episode_id where e.active and r.required and r.status<>'completed'
        union all select e.id,'treatment_scheduling','Allocate treatment appointment',e.status,null::bigint,null::date,'high' from gamma_knife_episodes e where e.active and e.status='preparation' and (e.data->'treatmentAppointment'->>'postponed'='true' or not exists(select 1 from appointments_v2.bookings b where b.id=(e.data->'treatmentAppointment'->>'bookingId')::bigint and b.status in ('scheduled','arrived','waiting') and b.voided_at is null))
        union all select e.id,'treatment_report:'||c.id::text,'Finalize treatment report',c.status,null::bigint,null::date,'high' from gamma_knife_treatment_courses c join gamma_knife_episodes e on e.id=c.episode_id where c.status='completed' and not c.documentation_finalized
        union all select e.id,'followup_booking','Allocate follow-up appointment',e.status,null::bigint,null::date,'normal' from gamma_knife_episodes e where e.active and e.status='followup' and (e.data->'followupAppointment'->>'postponed'='true' or not exists(select 1 from appointments_v2.bookings b where b.id=(e.data->'followupAppointment'->>'bookingId')::bigint and b.status in ('scheduled','arrived','waiting') and b.voided_at is null))
      ) select e.id as "episodeId",e.revision as "episodeRevision",coalesce(a.owner_user_id,t.owner_id)::bigint as "ownerUserId",p.arabic_full_name as "patientArabicName",p.english_full_name as "patientEnglishName",coalesce(nullif(p.english_full_name,''),p.arabic_full_name) as "patientName",p.mrn,t.task_key as "taskKey",t.task,coalesce(owner.full_name,assigned.full_name) as owner,coalesce(a.due_date,t.due_date)::text as "dueDate",coalesce(a.priority,t.priority) as priority,coalesce(a.status,'open') as "assignmentStatus",t.status,null::bigint as "bookingId",null::text as "appointmentDate",null::text as "appointmentTime",false as ready,null::text as "nextAction"
        from tasks t join gamma_knife_episodes e on e.id=t.episode_id join patients p on p.id=e.patient_id left join gamma_knife_operation_task_assignments a on a.episode_id=e.id and a.task_key=t.task_key left join users owner on owner.id=t.owner_id left join users assigned on assigned.id=a.owner_user_id`;
      orderSql = `case priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end,"dueDate" nulls last,"episodeId"`;
    } else if (kind === 'followup') {
      sourceSql = `select e.id as "episodeId",e.revision as "episodeRevision",a.owner_user_id as "ownerUserId",p.arabic_full_name as "patientArabicName",p.english_full_name as "patientEnglishName",coalesce(nullif(p.english_full_name,''),p.arabic_full_name) as "patientName",p.mrn,'followup_booking'::text as "taskKey",
        case when b.id is not null then 'Follow-up scheduled' when planned.date_value<$1::date::text then 'Overdue follow-up' when planned.date_value<=($1::date+$2::int)::text then 'Follow-up due soon' when planned.date_value is null then 'Follow-up date not recorded' else 'Planned follow-up' end as task,
        owner.full_name as owner,coalesce(b.booking_date::text,planned.date_value) as "dueDate",coalesce(a.priority,'normal') as priority,coalesce(a.status,'open') as "assignmentStatus",
        case when b.id is not null then 'scheduled' when planned.date_value<$1::date::text then 'overdue' when planned.date_value<=($1::date+$2::int)::text then 'due_soon' when planned.date_value is null then 'date_not_recorded' else 'scheduled' end as status,
        b.id as "bookingId",b.booking_date::text as "appointmentDate",b.booking_time::text as "appointmentTime"
        from gamma_knife_episodes e join patients p on p.id=e.patient_id left join appointments_v2.bookings b on b.id=(e.data->'followupAppointment'->>'bookingId')::bigint and b.patient_id=e.patient_id and b.status='scheduled' and b.voided_at is null
        left join gamma_knife_operation_task_assignments a on a.episode_id=e.id and a.task_key='followup_booking' left join users owner on owner.id=a.owner_user_id
        cross join lateral (select nullif(e.data->>'nextFollowupDate','') as date_value) planned where e.active and e.status='followup'`;
      orderSql = '"dueDate" nulls last,"episodeId"';
    } else {
      sourceSql = `with exception_rows as (
        select e.id as episode_id,'entered_in_error'::text as task_key,'Entered-in-error referral needs resolution'::text as task,'open'::text as status from gamma_knife_episodes e where e.closure_classification='entered_in_error' and e.replacement_episode_id is null
        union all select e.id,'interrupted_course:'||c.id::text,'Treatment course interrupted','interrupted' from gamma_knife_treatment_courses c join gamma_knife_episodes e on e.id=c.episode_id where c.status='interrupted'
        union all select e.id,'missing_report:'||c.id::text,'Completed treatment is missing finalized documentation','missing_report' from gamma_knife_treatment_courses c join gamma_knife_episodes e on e.id=c.episode_id where c.status='completed' and not c.documentation_finalized
        union all select e.id,'identity_correction:'||r.id::text,case when r.status='pending' then 'Identity correction request awaiting review' else 'Approved identity correction awaiting Core update confirmation' end,r.status from gamma_knife_patient_identity_correction_requests r join gamma_knife_episodes e on e.id=r.episode_id where r.status='pending' or (r.status='approved' and r.patient_update_completed_at is null)
        union all select e.id,'appointment_reconciliation:'||(x->>'bookingId'),'Reconcile linked RISpro appointment: '||coalesce(x->>'reason','review required'),'open' from gamma_knife_episodes e cross join lateral jsonb_array_elements(coalesce(e.data->'appointmentReconciliation','[]'::jsonb)) x where x->>'status'='required'
        union all select distinct e.id,'scheduling_conflict:'||other.id::text,'Same patient has overlapping appointments','conflict' from gamma_knife_episodes e cross join lateral (values((e.data->'treatmentAppointment'->>'bookingId')::bigint),((e.data->'followupAppointment'->>'bookingId')::bigint)) linked(booking_id) join appointments_v2.bookings b on b.id=linked.booking_id join appointments_v2.bookings other on other.patient_id=e.patient_id and other.id<>b.id and other.booking_date=b.booking_date and b.booking_time is not null and other.booking_time=b.booking_time and other.status='scheduled' and other.voided_at is null where e.active and b.status='scheduled' and b.voided_at is null
      ) select e.id as "episodeId",e.revision as "episodeRevision",a.owner_user_id as "ownerUserId",p.arabic_full_name as "patientArabicName",p.english_full_name as "patientEnglishName",coalesce(nullif(p.english_full_name,''),p.arabic_full_name) as "patientName",p.mrn,x.task_key as "taskKey",x.task,owner.full_name as owner,a.due_date::text as "dueDate",coalesce(a.priority,'high') as priority,coalesce(a.status,'open') as "assignmentStatus",x.status,null::bigint as "bookingId",null::text as "appointmentDate",null::text as "appointmentTime"
        from exception_rows x join gamma_knife_episodes e on e.id=x.episode_id join patients p on p.id=e.patient_id left join gamma_knife_operation_task_assignments a on a.episode_id=e.id and a.task_key=x.task_key left join users owner on owner.id=a.owner_user_id`;
      orderSql = 'case priority when \'urgent\' then 0 when \'high\' then 1 when \'normal\' then 2 else 3 end,"dueDate" nulls last,"episodeId"';
    }
    const result = await page(kind === 'today' ? 'todayTreatments' : kind === 'upcoming' ? 'upcomingTreatments' : kind === 'awaiting' ? 'awaitingAction' : kind === 'followup' ? 'followUp' : 'exceptions', sourceSql, orderSql);
    return result;
  };
  const counts = await pool.query(`select
    (select count(*) from gamma_knife_episodes e join appointments_v2.bookings b on b.id=(e.data->'treatmentAppointment'->>'bookingId')::bigint and b.patient_id=e.patient_id where e.active and b.booking_date=$1::date and b.status in ('scheduled','arrived','waiting') and b.voided_at is null) as "scheduledToday",
    (select count(*) from gamma_knife_episodes e where e.active and ((e.status='preparation' and (e.data->'treatmentAppointment'->>'postponed'='true' or not exists(select 1 from appointments_v2.bookings b where b.id=(e.data->'treatmentAppointment'->>'bookingId')::bigint and b.patient_id=e.patient_id and b.status in ('scheduled','arrived','waiting') and b.voided_at is null))) or (e.status='followup' and (e.data->'followupAppointment'->>'postponed'='true' or not exists(select 1 from appointments_v2.bookings b where b.id=(e.data->'followupAppointment'->>'bookingId')::bigint and b.patient_id=e.patient_id and b.status in ('scheduled','arrived','waiting') and b.voided_at is null))))) as "awaitingScheduling",
    (select count(*) from gamma_knife_episodes e where e.active and e.status in ('preparation','treatment') and ((e.data->'preparation'->>'ready') is distinct from 'true' or exists(select 1 from gamma_knife_readiness_items r where r.episode_id=e.id and r.required and r.status<>'completed'))) as "notReady",
    (select count(*) from gamma_knife_episodes e where e.active and (e.status='mdt' or e.data->>'mdtReviewRequired'='true')) as "pendingMdt",
    (select count(*) from gamma_knife_investigations i join gamma_knife_episodes e on e.id=i.episode_id where e.active and i.status='requested') as "outstandingInvestigations",
    (select count(*) from gamma_knife_treatment_courses where status='completed' and not documentation_finalized) as "unfinalizedTreatmentReports",
    (select count(*) from gamma_knife_episodes e where e.active and e.status='followup' and ((nullif(e.data->>'nextFollowupDate','') < $1::date::text and not exists(select 1 from appointments_v2.bookings b where b.id=(e.data->'followupAppointment'->>'bookingId')::bigint and b.patient_id=e.patient_id and b.booking_date>=$1::date and b.status='scheduled' and b.voided_at is null)) or exists(select 1 from appointments_v2.bookings b where b.id=(e.data->'followupAppointment'->>'bookingId')::bigint and b.patient_id=e.patient_id and b.booking_date<$1::date and b.status='scheduled' and b.voided_at is null))) as "overdueFollowups",
    (select count(*) from gamma_knife_patient_identity_correction_requests where status='pending' or (status='approved' and patient_update_completed_at is null)) as "pendingCorrectionRequests"`, [todayDate]);
  const [todayQueue, upcomingQueue, awaitingQueue, followupQueue, exceptionQueue] = await Promise.all([taskQueue('today'),taskQueue('upcoming'),taskQueue('awaiting'),taskQueue('followup'),taskQueue('exceptions')]);
  return { counts: Object.fromEntries(Object.entries(counts.rows[0] as Record<string,unknown>).map(([key,value]) => [key,Number(value)])),
    pagination: { todayTreatments: todayQueue.pagination, upcomingTreatments: upcomingQueue.pagination, awaitingAction: awaitingQueue.pagination, followUp: followupQueue.pagination, exceptions: exceptionQueue.pagination },
    queues: { todayTreatments: todayQueue.rows, upcomingTreatments: upcomingQueue.rows, awaitingAction: awaitingQueue.rows, followUp: followupQueue.rows, exceptions: exceptionQueue.rows } };
}
export async function scheduleIdentityRisk(actor: Actor, episodeId: unknown, requestedPurpose: unknown) {
  await authorize(actor, 'scheduling');
  const purpose = requestedPurpose === 'followup' ? 'followup' : requestedPurpose === 'treatment' ? 'treatment' : null;
  if (!purpose) throw new HttpError(400, 'Choose a valid appointment purpose.');
  const episode = await findEpisode(episodeId);
  const [{ examTypeId, modalityId }, risk, mode] = await Promise.all([
    appointmentPurposeSettings(pool, purpose),
    resolvePatientIdentityRisk(episode.patientId),
    resolvePatientIdentityVerificationMode(),
  ]);
  const modality = await pool.query<{ safety_warning_enabled: boolean; safety_warning_en: string | null; safety_warning_ar: string | null; safety_workflow_type: string | null }>(
    'select safety_warning_enabled,safety_warning_en,safety_warning_ar,safety_workflow_type from modalities where id=$1', [modalityId]);
  const safety = modality.rows[0];
  return {
    required: isPatientIdentityVerificationRequired(risk, mode), method: 'primary_identifier', maskedIdentifier: maskPatientIdentifier(risk.patient.primaryIdentifierValue),
    appointmentPurpose: purpose, examTypeId, modalityId,
    safety: { enabled: Boolean(safety?.safety_warning_enabled), warningEn: safety?.safety_warning_en ?? null, warningAr: safety?.safety_warning_ar ?? null, workflowType: safety?.safety_workflow_type ?? null },
  };
}

export async function verifyScheduleIdentity(actor: Actor, episodeId: unknown, input: unknown) {
  await authorize(actor, 'scheduling');
  const body = record(input);
  const episode = await findEpisode(episodeId);
  const verified = await verifyPatientIdentityEvidence({ patientId: episode.patientId, userId: Number(actor.sub), method: 'primary_identifier', evidence: text(body.evidence, 'Primary identifier', true, 120) });
  return { proof: verified.proof, verifiedAt: verified.assertion.verifiedAt };
}

function assertSchedulePurposeStage(episode: Episode, purpose: 'treatment' | 'followup') {
  requireStage(episode, purpose === 'treatment' ? ['preparation', 'treatment'] : ['followup']);
  if (purpose === 'treatment' && (episode.data.referralReviewRequired || episode.data.mdtReviewRequired)) throw new HttpError(409, 'Complete the required clinical and MDT review of the corrected referral before scheduling treatment.');
}

async function appointmentPurposeSettings(client: Db, purpose: 'treatment' | 'followup') {
  const config = await readConfig(client);
  const examTypeId = purpose === 'treatment' ? config.treatmentExamTypeId : config.followupExamTypeId;
  if (!examTypeId) throw new HttpError(409, 'Configure the RISpro exam type for this appointment purpose first.');
  const exam = await client.query<{ id: number; modality_id: number }>('select id,modality_id from exam_types where id=$1 and is_active=true', [examTypeId]);
  if (!exam.rows[0]) throw new HttpError(409, 'The configured Gamma Knife appointment type is unavailable.');
  return { examTypeId: Number(exam.rows[0].id), modalityId: Number(exam.rows[0].modality_id) };
}

export async function scheduleEpisodeAppointment(actor: Actor, episodeId: unknown, input: unknown) {
  await authorize(actor, 'scheduling');
  const body = record(input); const purpose = body.purpose;
  if (purpose !== 'treatment' && purpose !== 'followup') throw new HttpError(400, 'Choose a valid appointment purpose.');
  const bookingDate = date(body.bookingDate); const bookingTime = body.bookingTime == null || body.bookingTime === '' ? null : text(body.bookingTime, 'Appointment time', true, 20);
  const initial = await findEpisode(episodeId);
  if (!initial.active) throw new HttpError(409, 'A closed episode cannot receive a new appointment.');
  assertSchedulePurposeStage(initial, purpose);
  const { examTypeId, modalityId } = await appointmentPurposeSettings(pool, purpose);
  const payload: CreateBookingPayload = {
    patientId: initial.patientId, modalityId, examTypeId, bookingDate, bookingTime,
    notes: `Gamma Knife ${purpose} appointment`,
    patientIdentityVerificationProof: body.patientIdentityVerificationProof == null ? null : text(body.patientIdentityVerificationProof, 'Identity verification', true, 5000),
    patientIdentitySelectionSource: 'search',
    modalitySafetyAcknowledged: body.modalitySafetyAcknowledged === true,
    mriPrimaryScreening: mriPrimaryScreening(body.mriPrimaryScreening),
    capacityResolutionMode: 'standard',
    override: body.override as CreateBookingPayload['override'],
  };
  const result = await createBooking(payload, Number(actor.sub), actor.role, typeof body.policySetKey === 'string' ? body.policySetKey : 'default', undefined,
    { requirePatientIdentityVerification: true, selectionSource: 'search' },
    async (client, created) => {
      await authorize(actor, 'scheduling', client);
      const episode = await findEpisode(episodeId, client, true); checkEpisodeRevision(episode, body.revision);
      if (!episode.active) throw new HttpError(409, 'A closed episode cannot receive a new appointment.');
      assertSchedulePurposeStage(episode, purpose);
      const key = purpose === 'treatment' ? 'treatmentAppointment' : 'followupAppointment';
      const existingId = episode.data[key]?.bookingId;
      if (existingId) {
        const existing = await client.query("select 1 from appointments_v2.bookings where id=$1 and status in ('scheduled','arrived','waiting') and voided_at is null", [existingId]);
        if (existing.rows.length) throw new HttpError(409, 'A current appointment is already linked. Reschedule that appointment instead.');
      }
      episode.data[key] = { bookingId: created.booking.id, confirmed: false, postponed: false };
      if (purpose === 'treatment') await client.query("update gamma_knife_treatment_courses set booking_id=$2,updated_at=now() where episode_id=$1 and status in ('planned','in_progress','interrupted')", [episode.id, created.booking.id]);
      if (body.confirmed === true) await client.query("insert into gamma_knife_patient_communications(episode_id,kind,outcome,created_by_user_id) values($1,'appointment_confirmed','Appointment confirmed during scheduling.',$2)", [episode.id, actor.sub]);
      episode.data[key].confirmed = body.confirmed === true;
      await episodeWorkflowHistory(client, episode, actor, 'appointment_created_and_linked', '', { purpose, bookingId: created.booking.id, examTypeId });
    });
  return { booking: result.booking, decision: result.decisionSnapshot, episodeId: Number(episodeId) };
}

export async function rescheduleEpisodeAppointment(actor: Actor, episodeId: unknown, input: unknown) {
  await authorize(actor, 'scheduling');
  const body = record(input); const purpose = body.purpose;
  if (purpose !== 'treatment' && purpose !== 'followup') throw new HttpError(400, 'Choose a valid appointment purpose.');
  const bookingId = id(body.bookingId); const bookingDate = date(body.bookingDate);
  const bookingTime = body.bookingTime == null || body.bookingTime === '' ? null : text(body.bookingTime, 'Appointment time', true, 20);
  const reason = text(body.reason, 'Rescheduling reason', true, 1000);
  const episode = await findEpisode(episodeId); assertSchedulePurposeStage(episode, purpose);
  const { examTypeId } = await appointmentPurposeSettings(pool, purpose);
  const bookingSnapshot = await pool.query<{ booking_date: string; booking_time: string | null; updated_at: string }>("select booking_date::text,booking_time::text,updated_at::text from appointments_v2.bookings where id=$1 and patient_id=$2 and exam_type_id=$3 and status='scheduled' and voided_at is null", [bookingId, episode.patientId, examTypeId]);
  if (!bookingSnapshot.rows[0] || Number(episode.data[purpose === 'treatment' ? 'treatmentAppointment' : 'followupAppointment']?.bookingId) !== bookingId) throw new HttpError(409, 'The linked RISpro appointment changed. Reload the episode before rescheduling.');
  const result = await rescheduleBooking(bookingId, bookingDate, bookingTime, examTypeId, null, null, Number(actor.sub), actor.role,
    body.override as CreateBookingPayload['override'], 'standard', null, null, reason, null, undefined, undefined,
    typeof body.policySetKey === 'string' ? body.policySetKey : 'default', undefined, false, false, false,
    async (client, rescheduled) => {
      await authorize(actor, 'scheduling', client);
      const current = await findEpisode(episodeId, client, true); checkEpisodeRevision(current, body.revision);
      if (!current.active) throw new HttpError(409, 'A closed episode cannot be rescheduled.');
      assertSchedulePurposeStage(current, purpose);
      const key = purpose === 'treatment' ? 'treatmentAppointment' : 'followupAppointment';
      if (Number(current.data[key]?.bookingId) !== bookingId) throw new HttpError(409, 'The appointment is no longer linked to this episode.');
      const owner = await client.query("select 1 from appointments_v2.bookings where id=$1 and patient_id=$2 and exam_type_id=$3 and status='scheduled' and voided_at is null", [bookingId, current.patientId, examTypeId]);
      if (!owner.rows.length) throw new HttpError(409, 'The linked appointment no longer matches this patient and Gamma Knife purpose.');
      current.data[key] = { bookingId, confirmed: body.confirmed === true, postponed: false };
      if (body.confirmed === true) await client.query("insert into gamma_knife_patient_communications(episode_id,kind,outcome,created_by_user_id) values($1,'appointment_confirmed','Appointment confirmed during rescheduling.',$2)", [current.id, actor.sub]);
      await episodeWorkflowHistory(client, current, actor, 'appointment_rescheduled', reason, { purpose, bookingId, previousDate: rescheduled.previousDate, previousTime: rescheduled.previousTime, bookingDate, bookingTime, confirmed: body.confirmed === true });
    }, bookingSnapshot.rows[0]!.updated_at);
  return { booking: result.booking, episodeId: Number(episodeId) };
}

export async function createTreatmentCourse(actor: Actor, episodeId: unknown, input: unknown) {
  const body = record(input); const immobilization = String(body.immobilization);
  if (!['frame','mask'].includes(immobilization)) throw new HttpError(400, 'Choose frame or mask immobilization.');
  const plannedFractionCount = Number(body.plannedFractionCount);
  if (!Number.isInteger(plannedFractionCount) || plannedFractionCount < 1 || plannedFractionCount > 100) throw new HttpError(400, 'Enter a planned fraction count from 1 to 100.');
  const gammaPlanReference = text(body.gammaPlanReference, 'GammaPlan course reference', true, 200);
  const targetReferences = body.targetReferences == null ? [] : strings(body.targetReferences, 'Target references');
  try {
    return await transaction(async client => {
      await authorize(actor, 'treatment', client);
      const episode = await findEpisode(episodeId, client, true); checkEpisodeRevision(episode, body.revision);
      if (!episode.active) throw new HttpError(409, 'Episode is closed.');
      if (episode.data.referralReviewRequired || episode.data.mdtReviewRequired) throw new HttpError(409, 'Complete the required clinical and MDT review of the corrected referral before proceeding.');
        if (!episode.data.preparation?.ready) throw new HttpError(409, 'Complete and confirm treatment preparation before creating a treatment course.');
        const requiredChecklist = await client.query("select 1 from gamma_knife_readiness_items where episode_id=$1 and required and status<>'completed' limit 1", [episode.id]);
        if (requiredChecklist.rows.length) throw new HttpError(409, 'Complete all required operational readiness checklist items before creating a treatment course.');
      const existing = await client.query<{ id: string; status: string; prior_course_id: number | null; reassessment_id: number | null }>('select id,status,prior_course_id,reassessment_id from gamma_knife_treatment_courses where episode_id=$1 order by course_number desc limit 1', [episode.id]);
      let priorCourseId: number | null = null; let reassessmentId: number | null = null; let replacedCancelledCourseId: number | null = null;
      if (existing.rows.length) {
        const previous = existing.rows[0]!;
        if (previous.status === 'cancelled') {
          const delivered = await client.query("select 1 from gamma_knife_treatment_fractions where course_id=$1 and status='delivered' limit 1", [previous.id]);
          if (delivered.rows.length) throw new HttpError(409, 'A cancelled course with delivered fractions cannot be replaced as an undelivered plan.');
          replacedCancelledCourseId = Number(previous.id);
          if (previous.prior_course_id != null) {
            priorCourseId = id(body.priorCourseId); reassessmentId = id(body.reassessmentId);
            if (priorCourseId !== Number(previous.prior_course_id) || reassessmentId !== Number(previous.reassessment_id)) throw new HttpError(409, 'A cancelled repeat plan must be replaced under the same completed prior course and approved reassessment.');
          } else {
            if (body.priorCourseId != null || body.reassessmentId != null) throw new HttpError(400, 'A replacement for the first plan does not use repeat-treatment references.');
            if (episode.data.mdt?.decision !== 'approved' || !['preparation','treatment'].includes(episode.status)) throw new HttpError(409, 'The replacement first course requires the original MDT approval and current preparation workflow.');
          }
        } else {
          priorCourseId = id(body.priorCourseId); reassessmentId = id(body.reassessmentId);
          if (Number(previous.id) !== priorCourseId || previous.status !== 'completed') throw new HttpError(409, 'A repeat course must link to a completed prior course.');
        }
        if (priorCourseId != null) {
        const reassessment = await client.query(`select r.status,d.decision from gamma_knife_reassessments r
          join lateral (select decision from gamma_knife_reassessment_decisions where reassessment_id=r.id order by revision desc limit 1) d on true
          where r.id=$1 and r.episode_id=$2 and r.course_id=$3 for update of r`, [reassessmentId, episode.id, priorCourseId]);
        if (!reassessment.rows.length || reassessment.rows[0]!.status !== 'decided' || reassessment.rows[0]!.decision !== 'approved') throw new HttpError(409, 'An approved reassessment linked to the completed course is required before creating a repeat course.');
        const prior = await client.query("select 1 from gamma_knife_treatment_courses where id=$1 and episode_id=$2 and status='completed'", [priorCourseId, episode.id]);
        if (!prior.rows.length) throw new HttpError(409, 'A completed prior treatment course is required before creating a repeat course.');
        }
      } else if (body.priorCourseId != null || body.reassessmentId != null || episode.data.mdt?.decision !== 'approved' || !['preparation','treatment'].includes(episode.status)) {
        throw new HttpError(409, 'The first course requires the recorded MDT approval and preparation workflow.');
      }
      const number = await client.query<{ course_number: number }>('select coalesce(max(course_number),0)+1 as course_number from gamma_knife_treatment_courses where episode_id=$1', [episode.id]);
      const row = await client.query(`insert into gamma_knife_treatment_courses(episode_id,course_number,prior_course_id,reassessment_id,immobilization,planned_fraction_count,gamma_plan_reference,target_references,status,booking_id,created_by)
        values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'planned',$9,$10) returning *`, [episode.id, number.rows[0]!.course_number, priorCourseId, reassessmentId, immobilization, plannedFractionCount, gammaPlanReference, JSON.stringify(targetReferences), episode.data.treatmentAppointment?.bookingId ?? null, actor.sub]);
      const course = row.rows[0]!;
      if (reassessmentId) {
        episode.status = 'preparation';
        episode.data.preparation = { consent: false, imaging: false, clinicalReady: false, notes: '', instructions: '', actions: '', ready: false };
        delete episode.data.treatmentAppointment;
      }
      await treatmentHistory(client, Number(course.id), actor, replacedCancelledCourseId ? 'course_replacement_created' : 'course_created', { course, replacesCancelledCourseId: replacedCancelledCourseId });
      await episodeWorkflowHistory(client, episode, actor, replacedCancelledCourseId ? 'course_replacement_created' : 'course_created', '', { courseId: Number(course.id), priorCourseId, reassessmentId, replacesCancelledCourseId: replacedCancelledCourseId });
      return { course, episode, ...await workflowRecords(episode.id, client) };
    });
  } catch (error) {
    if ((error as { constraint?: string }).constraint === 'gamma_knife_one_open_treatment_course') throw new HttpError(409, 'An unfinished treatment course already exists for this episode. Resume or correct it before creating another.');
    if ((error as { constraint?: string }).constraint === 'gamma_knife_treatment_courses_reassessment_id_key') throw new HttpError(409, 'This reassessment has already created a treatment course.');
    throw error;
  }
}
export async function addTreatmentFraction(actor: Actor, episodeId: unknown, courseId: unknown, input: unknown) {
  const body = record(input); const fractionNumber = Number(body.plannedFractionNumber); const fractionStatus = String(body.status);
  if (!Number.isInteger(fractionNumber) || fractionNumber < 1 || fractionNumber > 100 || !['delivered','interrupted','not_delivered'].includes(fractionStatus)) throw new HttpError(400, 'Choose a valid planned fraction number and event status.');
  const eventDate = date(body.eventDate); if (eventDate > getTripoliToday()) throw new HttpError(400, 'A treatment event cannot have a future date.');
  const gammaPlanReference = text(body.gammaPlanReference, 'GammaPlan fraction reference', fractionStatus === 'delivered', 200);
  const notes = text(body.notes, 'Fraction notes', false, 4000);
  return transaction(async client => {
    await authorize(actor, 'treatment', client);
    const episode = await findEpisode(episodeId, client, true); checkEpisodeRevision(episode, body.revision);
    if (!episode.active || episode.status !== 'treatment' || !episode.data.preparation?.ready) throw new HttpError(409, 'Confirm treatment readiness before recording a fraction event.');
    const found = await client.query<{ id: string; status: string; planned_fraction_count: number }>('select id,status,planned_fraction_count from gamma_knife_treatment_courses where id=$1 and episode_id=$2 for update', [id(courseId), episode.id]);
    if (!found.rows.length || !['planned','in_progress'].includes(found.rows[0]!.status)) throw new HttpError(409, 'Only an active course can receive a fraction event. Resume an interrupted course first.');
    if (fractionNumber > Number(found.rows[0]!.planned_fraction_count)) throw new HttpError(400, 'Fraction number exceeds the planned course count. Correct the course plan first if GammaPlan has changed it.');
    const operatorResult = await client.query<{ full_name: string }>('select full_name from users where id=$1', [actor.sub]);
    const operatorName = text(body.operatorName ?? operatorResult.rows[0]?.full_name, 'Operator name', true, 200);
    const inserted = await client.query(`insert into gamma_knife_treatment_fractions(course_id,planned_fraction_number,status,event_date,operator_name,operator_id,gamma_plan_reference,notes,created_by)
      values($1,$2,$3,$4,$5,$6,$7,$8,$6) returning *`, [id(courseId), fractionNumber, fractionStatus, eventDate, operatorName, actor.sub, gammaPlanReference || null, notes]);
    const fraction = inserted.rows[0]!;
    const nextStatus = fractionStatus === 'interrupted' ? 'interrupted' : 'in_progress';
    await client.query('update gamma_knife_treatment_courses set status=$2,updated_at=now() where id=$1', [id(courseId), nextStatus]);
    await treatmentHistory(client, id(courseId), actor, `fraction_${fractionStatus}`, fraction, '', Number(fraction.id));
    await episodeWorkflowHistory(client, episode, actor, `fraction_${fractionStatus}`, '', { courseId: id(courseId), fractionId: Number(fraction.id) });
    return { fraction, episode, ...await workflowRecords(episode.id, client) };
  });
}
export async function changeTreatmentCourse(actor: Actor, episodeId: unknown, courseId: unknown, actionName: string, input: unknown) {
  const body = record(input); let reason = text(body.reason, 'Correction reason');
  let expectedRevision = Number(body.revision);
  let appointmentReconciliation: Awaited<ReturnType<typeof reconcileEpisodeAppointments>> | null = null;
  if (actionName === 'complete') {
    await authorize(actor, 'treatment');
    reason = text(body.reason, 'GammaPlan completion confirmation', true);
    const validateCompletion = async (client: PoolClient, episode: Episode) => {
      if (!episode.active || episode.status !== 'treatment' || !episode.data.preparation?.ready) throw new HttpError(409, 'Treatment readiness must be current before course completion is recorded.');
      const found = await client.query("select id,status,planned_fraction_count from gamma_knife_treatment_courses where id=$1 and episode_id=$2 for update", [id(courseId), episode.id]);
      if (!found.rows[0] || found.rows[0].status !== 'in_progress' || body.confirmed !== true) throw new HttpError(409, 'An in-progress course and explicit GammaPlan completion confirmation are required.');
      const delivered = await client.query("select count(distinct planned_fraction_number)::int as count from gamma_knife_treatment_fractions where course_id=$1 and status='delivered'", [id(courseId)]);
      if (Number(delivered.rows[0]?.count) < Number(found.rows[0].planned_fraction_count)) throw new HttpError(409, 'The course has fewer delivered fraction records than its planned fraction count. Reconcile the plan against GammaPlan or keep the course open as interrupted.');
      const completedAt = date(body.completedAt);
      if (completedAt > getTripoliToday()) throw new HttpError(400, 'Course completion date cannot be in the future.');
    };
    appointmentReconciliation = await reconcileEpisodeAppointments(actor, episodeId, expectedRevision, ['treatment'], reason, validateCompletion);
    expectedRevision = appointmentReconciliation.revision;
  }
  return transaction(async client => {
    await authorize(actor, 'treatment', client);
    const episode = await findEpisode(episodeId, client, true); checkEpisodeRevision(episode, expectedRevision);
    if (appointmentReconciliation) await recordAppointmentReconciliation(client, episode, actor, appointmentReconciliation.pending);
    const found = await client.query('select * from gamma_knife_treatment_courses where id=$1 and episode_id=$2 for update', [id(courseId), episode.id]);
    if (!found.rows.length) throw new HttpError(404, 'Treatment course not found.');
    const course = found.rows[0] as Record<string, unknown>;
    if (actionName === 'correct') {
      reason = text(body.reason, 'Course correction reason', true);
      const immobilization = body.immobilization === undefined ? String(course.immobilization) : String(body.immobilization);
      const fractions = body.plannedFractionCount === undefined ? Number(course.planned_fraction_count) : Number(body.plannedFractionCount);
      if (!['frame','mask'].includes(immobilization) || !Number.isInteger(fractions) || fractions < 1 || fractions > 100) throw new HttpError(400, 'Correct the course immobilization and fraction count with valid values.');
      const references = body.targetReferences === undefined ? course.target_references as string[] : strings(body.targetReferences, 'Target references');
      const gammaPlanReference = body.gammaPlanReference === undefined ? course.gamma_plan_reference : text(body.gammaPlanReference, 'GammaPlan course reference', true, 200);
      const outside = await client.query('select 1 from gamma_knife_treatment_fractions where course_id=$1 and planned_fraction_number>$2 limit 1', [id(courseId), fractions]);
      if (outside.rows.length) throw new HttpError(409, 'Correct fraction records above the revised course count before reducing the plan.');
      await client.query('update gamma_knife_treatment_courses set immobilization=$2,planned_fraction_count=$3,gamma_plan_reference=$4,target_references=$5::jsonb,updated_at=now() where id=$1', [id(courseId), immobilization, fractions, gammaPlanReference, JSON.stringify(references)]);
    } else if (actionName === 'interrupt') {
      reason = text(body.reason, 'Interruption reason', true);
      if (!['planned','in_progress'].includes(String(course.status))) throw new HttpError(409, 'Only a planned or in-progress course can be interrupted.');
      await client.query("update gamma_knife_treatment_courses set status='interrupted',updated_at=now() where id=$1", [id(courseId)]);
    } else if (actionName === 'resume') {
      reason = text(body.reason, 'Resume reason', true);
      if (course.status !== 'interrupted') throw new HttpError(409, 'Only an interrupted course can be resumed.');
      if (episode.status !== 'treatment' || !episode.data.preparation?.ready) throw new HttpError(409, 'Reconfirm treatment readiness before resuming this course.');
      await client.query("update gamma_knife_treatment_courses set status='in_progress',updated_at=now() where id=$1", [id(courseId)]);
    } else if (actionName === 'cancel') {
      reason = text(body.reason, 'Course cancellation reason', true);
      const delivered = await client.query("select 1 from gamma_knife_treatment_fractions where course_id=$1 and status='delivered' limit 1", [id(courseId)]);
      if (delivered.rows.length || !['planned','interrupted'].includes(String(course.status))) throw new HttpError(409, 'A course with delivered fractions cannot be cancelled. Keep it open as interrupted or complete it explicitly from GammaPlan.');
      await client.query("update gamma_knife_treatment_courses set status='cancelled',updated_at=now() where id=$1", [id(courseId)]);
    } else if (actionName === 'complete') {
      reason = text(body.reason, 'GammaPlan completion confirmation', true);
      if (body.confirmed !== true || !['in_progress'].includes(String(course.status))) throw new HttpError(409, 'An in-progress course and explicit GammaPlan completion confirmation are required.');
      if (episode.status !== 'treatment' || !episode.data.preparation?.ready) throw new HttpError(409, 'Treatment readiness must be current before course completion is recorded.');
      const delivered = await client.query("select count(distinct planned_fraction_number)::int as count from gamma_knife_treatment_fractions where course_id=$1 and status='delivered'", [id(courseId)]);
      if (Number(delivered.rows[0]?.count) < Number(course.planned_fraction_count)) throw new HttpError(409, 'The course has fewer delivered fraction records than its planned fraction count. Reconcile the plan against GammaPlan or keep the course open as interrupted.');
      const completedAt = date(body.completedAt); if (completedAt > getTripoliToday()) throw new HttpError(400, 'Course completion date cannot be in the future.');
      await client.query(`update gamma_knife_treatment_courses set status='completed',completion_confirmed=true,completion_reason=$2,completed_at=$3,completed_by=$4,updated_at=now() where id=$1`, [id(courseId), reason, completedAt, actor.sub]);
      const deliveredRows = await client.query<{ operator_name: string }>("select distinct operator_name from gamma_knife_treatment_fractions where course_id=$1 and status='delivered' order by operator_name", [id(courseId)]);
      const deliveredCount = Number(delivered.rows[0]!.count);
      episode.data.treatment = { date: completedAt, immobilization: course.immobilization as Treatment['immobilization'], fractions: deliveredCount, team: deliveredRows.rows.map(row => row.operator_name), completed: true, reportId: null, finalized: false };
      episode.status = 'followup';
    } else throw new HttpError(400, 'Unknown treatment course action.');
    const updated = await client.query('select * from gamma_knife_treatment_courses where id=$1', [id(courseId)]);
    await treatmentHistory(client, id(courseId), actor, `course_${actionName}`, { before: course, after: updated.rows[0] }, reason);
    await episodeWorkflowHistory(client, episode, actor, `course_${actionName}`, reason, { courseId: id(courseId), appointmentReconciliationRequired: appointmentReconciliation?.pending.map(item => item.bookingId) ?? [] });
    return { course: updated.rows[0], episode, ...await workflowRecords(episode.id, client), reconciliationRequired: Boolean(appointmentReconciliation?.pending.length), reconciliationPending: appointmentReconciliation?.pending.map(item => item.bookingId) ?? [] };
  });
}
export async function correctTreatmentFraction(actor: Actor, episodeId: unknown, courseId: unknown, fractionId: unknown, input: unknown) {
  const body = record(input); const reason = text(body.reason, 'Fraction correction reason', true);
  const status = String(body.status); if (!['delivered','interrupted','not_delivered'].includes(status)) throw new HttpError(400, 'Choose a valid fraction event status.');
  const eventDate = date(body.eventDate); if (eventDate > getTripoliToday()) throw new HttpError(400, 'A treatment event cannot have a future date.');
  const gammaPlanReference = text(body.gammaPlanReference, 'GammaPlan fraction reference', status === 'delivered', 200);
  return transaction(async client => {
    await authorize(actor, 'treatment', client); const episode = await findEpisode(episodeId, client, true); checkEpisodeRevision(episode, body.revision);
    const found = await client.query('select f.* from gamma_knife_treatment_fractions f join gamma_knife_treatment_courses c on c.id=f.course_id where f.id=$1 and c.id=$2 and c.episode_id=$3 for update of f', [id(fractionId), id(courseId), episode.id]);
    if (!found.rows.length) throw new HttpError(404, 'Fraction event not found.');
    const before = found.rows[0] as Record<string, unknown>;
    const courseStatus = await client.query<{ status: string }>('select status from gamma_knife_treatment_courses where id=$1 and episode_id=$2 for update', [id(courseId), episode.id]);
    if (courseStatus.rows[0]?.status === 'completed' && status !== before.status) throw new HttpError(409, 'A completed course delivery state cannot be changed by fraction correction. Preserve the completed record and request clinical review if delivery evidence is disputed.');
    const operatorName = text(body.operatorName, 'Operator name', true, 200);
    const notes = text(body.notes, 'Fraction notes', false, 4000);
    const saved = await client.query(`update gamma_knife_treatment_fractions set status=$2,event_date=$3,operator_name=$4,gamma_plan_reference=$5,notes=$6 where id=$1 returning *`, [id(fractionId), status, eventDate, operatorName, gammaPlanReference || null, notes]);
    await treatmentHistory(client, id(courseId), actor, 'fraction_corrected', { before, after: saved.rows[0] }, reason, id(fractionId));
    await episodeWorkflowHistory(client, episode, actor, 'fraction_corrected', reason, { courseId: id(courseId), fractionId: id(fractionId) });
    return { fraction: saved.rows[0], episode, ...await workflowRecords(episode.id, client) };
  });
}
export async function requestReassessment(actor: Actor, episodeId: unknown, input: unknown) {
  const body = record(input); const reason = String(body.reason);
  if (!['progression','complication','uncertain_response','other'].includes(reason)) throw new HttpError(400, 'Choose a reassessment reason.');
  const reasonDetail = text(body.reasonDetail, 'Clinical concern', true, 4000);
  return transaction(async client => {
    await authorize(actor, 'clinical', client); const episode = await findEpisode(episodeId, client, true); checkEpisodeRevision(episode, body.revision);
    if (!episode.active) throw new HttpError(409, 'A closed episode cannot be returned to MDT.');
    const course = await client.query("select id from gamma_knife_treatment_courses where id=$1 and episode_id=$2 and status='completed' for share", [id(body.courseId), episode.id]);
    if (!course.rows.length) throw new HttpError(409, 'Choose a completed course for reassessment.');
    const inserted = await client.query(`insert into gamma_knife_reassessments(episode_id,course_id,reason,reason_detail,requested_by) values($1,$2,$3,$4,$5) returning *`, [episode.id, id(body.courseId), reason, reasonDetail, actor.sub]);
    const reassessment = inserted.rows[0]!;
    await reassessmentHistory(client, Number(reassessment.id), actor, 'reassessment_requested', reassessment);
    await episodeWorkflowHistory(client, episode, actor, 'reassessment_requested', reasonDetail, { reassessmentId: Number(reassessment.id), courseId: id(body.courseId) });
    return { reassessment, episode };
  });
}
export async function decideReassessment(actor: Actor, episodeId: unknown, reassessmentId: unknown, input: unknown) {
  const body = record(input); const decision = String(body.decision);
  if (!['approved','additional_information','deferred','not_suitable'].includes(decision)) throw new HttpError(400, 'Choose a supported MDT decision.');
  const consultants = strings(body.consultants, 'Responsible consultants'); if (!consultants.length) throw new HttpError(400, 'At least one responsible consultant is required.');
  const assessment = text(body.assessment, 'MDT assessment', true); const notes = text(body.notes, 'MDT discussion');
  const requested = text(body.investigations, 'Requested investigations', decision === 'additional_information');
  const reason = text(body.reason, 'Correction reason');
  return transaction(async client => {
    await authorize(actor, 'mdt', client); const episode = await findEpisode(episodeId, client, true); checkEpisodeRevision(episode, body.revision);
    const found = await client.query('select * from gamma_knife_reassessments where id=$1 and episode_id=$2 for update', [id(reassessmentId), episode.id]);
    if (!found.rows.length || !['requested','awaiting_information'].includes(String(found.rows[0]!.status))) throw new HttpError(409, 'This reassessment is not awaiting an MDT decision.');
    if (found.rows[0]!.status === 'awaiting_information') {
      const pending = await client.query("select 1 from gamma_knife_investigations where reassessment_id=$1 and status='requested' limit 1", [id(reassessmentId)]);
      if (pending.rows.length) throw new HttpError(409, 'Receive or cancel the reassessment investigations before returning it to MDT.');
    }
    const last = await client.query<{ revision: number }>('select coalesce(max(revision),0)+1 as revision from gamma_knife_reassessment_decisions where reassessment_id=$1', [id(reassessmentId)]);
    if (Number(last.rows[0]!.revision) > 1) text(reason, 'Reason for correcting previous MDT decision', true);
    const inserted = await client.query(`insert into gamma_knife_reassessment_decisions(reassessment_id,revision,decision,assessment,notes,consultants,reason,assessment_revision,actor_id)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`, [id(reassessmentId), last.rows[0]!.revision, decision, assessment, notes, consultants, reason, episode.data.assessmentRevision ?? null, actor.sub]);
    const nextStatus = decision === 'additional_information' ? 'awaiting_information' : 'decided';
    await client.query('update gamma_knife_reassessments set status=$2,revision=revision+1,updated_at=now() where id=$1', [id(reassessmentId), nextStatus]);
    if (decision === 'additional_information') {
      const task = await client.query(`insert into gamma_knife_investigations(episode_id,reassessment_id,requested_text,status,created_by) values($1,$2,$3,'requested',$4) returning *`, [episode.id, id(reassessmentId), requested, actor.sub]);
      await investigationHistory(client, Number(task.rows[0]!.id), actor, 'investigation_requested', task.rows[0]);
      episode.data.investigationsPending = true;
    }
    await reassessmentHistory(client, id(reassessmentId), actor, 'reassessment_decision', { reassessment: found.rows[0], decision: inserted.rows[0] }, reason);
    await episodeWorkflowHistory(client, episode, actor, 'reassessment_decision', reason, { reassessmentId: id(reassessmentId), decision });
    return { reassessmentId: id(reassessmentId), decision: inserted.rows[0], episode };
  });
}
export async function createInvestigation(actor: Actor, episodeId: unknown, input: unknown) {
  const body = record(input); const requestedText = text(body.requestedText, 'Requested investigation', true, 4000);
  const dueDate = body.dueDate == null || body.dueDate === '' ? null : date(body.dueDate);
  const priority = operationalPriority(body.priority ?? 'normal');
  return transaction(async client => {
    await authorize(actor, 'mdt', client); const episode = await findEpisode(episodeId, client, true); checkEpisodeRevision(episode, body.revision);
    if (!episode.active) throw new HttpError(409, 'A task cannot be added to a closed episode.');
    const reassessmentId = body.reassessmentId == null ? null : id(body.reassessmentId);
    if (reassessmentId) {
      const reassessment = await client.query("select id from gamma_knife_reassessments where id=$1 and episode_id=$2 and status in ('requested','awaiting_information')", [reassessmentId, episode.id]);
      if (!reassessment.rows.length) throw new HttpError(409, 'The selected reassessment is no longer active.');
    }
    const responsible = body.responsibleUserId == null || body.responsibleUserId === '' ? null : id(body.responsibleUserId);
    let name: string | null = null;
    if (responsible) {
      const assigned = await client.query<{ full_name: string }>(`select full_name from users where id=$1 and is_active=true and gamma_knife_permissions @> array['access']::text[] and gamma_knife_permissions && array['clinical','mdt','documents','scheduling']::text[]`, [responsible]);
      if (!assigned.rows.length) throw new HttpError(400, 'Assign the investigation to an active Gamma Knife team member.'); name = assigned.rows[0]!.full_name;
    }
    const inserted = await client.query(`insert into gamma_knife_investigations(episode_id,reassessment_id,requested_text,responsible_user_id,responsible_name_snapshot,due_date,priority,created_by)
      values($1,$2,$3,$4,$5,$6,$7,$8) returning *`, [episode.id, reassessmentId, requestedText, responsible, name, dueDate, priority, actor.sub]);
    const task = inserted.rows[0]!; await investigationHistory(client, Number(task.id), actor, 'investigation_requested', task);
    episode.data.investigationsPending = true;
    await episodeWorkflowHistory(client, episode, actor, 'investigation_requested', '', { investigationId: Number(task.id), reassessmentId });
    return { investigation: task, episode };
  });
}
export async function updateInvestigation(actor: Actor, episodeId: unknown, investigationId: unknown, input: unknown) {
  const body = record(input); const actionName = String(body.action);
  if (!['assign','correct','receive','reopen','cancel'].includes(actionName)) throw new HttpError(400, 'Choose a supported investigation update.');
  const reason = text(body.reason, 'Correction reason', actionName !== 'receive');
  return transaction(async client => {
    const granted = await permissions(actor, client);
    const coordinationOnly = granted.includes('scheduling') && (actionName === 'assign' || actionName === 'correct');
    if (!granted.includes('access') || (!granted.includes('mdt') && !granted.includes('documents') && !coordinationOnly)) throw new HttpError(403, 'Gamma Knife assignment and MDT, documents, or scheduling permission required.');
    if (coordinationOnly && !['assign','correct'].includes(actionName)) throw new HttpError(403, 'Scheduling permission cannot receive or cancel a clinical investigation.');
    if (body.evidenceDocumentId != null && body.evidenceDocumentId !== '' && !granted.includes('documents')) throw new HttpError(403, 'Documents permission is required to link investigation evidence.');
    const episode = await findEpisode(episodeId, client, true); checkEpisodeRevision(episode, body.revision);
    if (!episode.active) throw new HttpError(409, 'Episode is closed.');
    const found = await client.query('select * from gamma_knife_investigations where id=$1 and episode_id=$2 for update', [id(investigationId), episode.id]);
    if (!found.rows.length) throw new HttpError(404, 'Investigation not found.'); const before = found.rows[0] as Record<string, unknown>;
    if (actionName === 'cancel' && before.status !== 'requested') throw new HttpError(409, 'Only a requested investigation can be cancelled.');
    if (actionName === 'receive' && before.status !== 'requested') throw new HttpError(409, 'Only a requested investigation can be received.');
    if (actionName === 'reopen' && before.status === 'requested') throw new HttpError(409, 'This investigation is already outstanding.');
    let requestedText = String(before.requested_text); let responsibleUserId = before.responsible_user_id == null ? null : Number(before.responsible_user_id); let responsibleName = before.responsible_name_snapshot as string | null;
    let dueDate = before.due_date ? String(before.due_date).slice(0,10) : null; let priority = String(before.priority ?? 'normal'); let status = String(before.status); let evidenceDocumentId = before.evidence_document_id == null ? null : Number(before.evidence_document_id); let receivedNote = before.received_note as string | null;
    if (actionName === 'correct') {
      requestedText = text(body.requestedText, 'Requested investigation', true, 4000);
      dueDate = body.dueDate === undefined ? dueDate : body.dueDate == null || body.dueDate === '' ? null : date(body.dueDate);
      priority = body.priority === undefined ? priority : operationalPriority(body.priority);
    }
    if (actionName === 'assign' || body.responsibleUserId !== undefined) {
      responsibleUserId = body.responsibleUserId == null || body.responsibleUserId === '' ? null : id(body.responsibleUserId);
      if (responsibleUserId) {
        const assigned = await client.query<{ full_name: string }>(`select full_name from users where id=$1 and is_active=true and gamma_knife_permissions @> array['access']::text[] and gamma_knife_permissions && array['clinical','mdt','documents','scheduling']::text[]`, [responsibleUserId]);
        if (!assigned.rows.length) throw new HttpError(400, 'Assign the investigation to an active Gamma Knife team member.'); responsibleName = assigned.rows[0]!.full_name;
      } else responsibleName = null;
    }
    if (actionName === 'receive') {
      evidenceDocumentId = body.evidenceDocumentId == null || body.evidenceDocumentId === '' ? null : id(body.evidenceDocumentId);
      receivedNote = text(body.receivedNote, 'Receipt note', !evidenceDocumentId, 4000) || null;
      if (evidenceDocumentId) {
        const document = await client.query(`select 1 from gamma_knife_documents where episode_id=$1 and document_id=$2 and category='investigation' and removed_at is null`, [episode.id, evidenceDocumentId]);
        if (!document.rows.length) throw new HttpError(400, 'Evidence must be an active investigation document attached to this episode.');
      }
      status = 'received';
    }
    if (actionName === 'cancel') status = 'cancelled';
    if (actionName === 'reopen') { status = 'requested'; evidenceDocumentId = null; receivedNote = null; }
    const saved = await client.query(`update gamma_knife_investigations set requested_text=$2,responsible_user_id=$3,responsible_name_snapshot=$4,due_date=$5,priority=$6,status=$7,evidence_document_id=$8,received_note=$9,updated_at=now() where id=$1 returning *`, [id(investigationId), requestedText, responsibleUserId, responsibleName, dueDate, priority, status, evidenceDocumentId, receivedNote]);
    await investigationHistory(client, id(investigationId), actor, `investigation_${actionName}`, { before, after: saved.rows[0] }, reason);
    const open = await client.query("select count(*)::int as count from gamma_knife_investigations where episode_id=$1 and status='requested'", [episode.id]);
    episode.data.investigationsPending = Number(open.rows[0]!.count) > 0;
    const reassessmentId = before.reassessment_id == null ? null : Number(before.reassessment_id);
    if (reassessmentId) {
      const pending = await client.query("select 1 from gamma_knife_investigations where reassessment_id=$1 and status='requested' limit 1", [reassessmentId]);
      if (!pending.rows.length) await client.query("update gamma_knife_reassessments set status='requested',updated_at=now() where id=$1 and status='awaiting_information'", [reassessmentId]);
    }
    if (!episode.data.investigationsPending && episode.status === 'clinical_review') episode.data.assessmentStatus = 'draft';
    await episodeWorkflowHistory(client, episode, actor, `investigation_${actionName}`, reason, { investigationId: id(investigationId), reassessmentId });
    return { investigation: saved.rows[0], episode, ...await workflowRecords(episode.id, client) };
  });
}
export async function changeEpisode(actor: Actor, episodeId: unknown, action: string, input: unknown) {
  const requiredPermission = actionPermission[action];
  if (!requiredPermission) throw new HttpError(400, 'Unknown Gamma Knife action.');
  const body = record(input);
  if (action === 'postpone') {
    const reason = text(body.reason, 'Postponement reason', true);
    const validate = async (_client: PoolClient, episode: Episode) => {
      if (!episode.active) throw new HttpError(409, 'Episode is closed.');
      requireStage(episode, ['preparation','treatment']);
    };
    await authorize(actor, 'scheduling');
    const reconciliation = await reconcileEpisodeAppointments(actor, episodeId, Number(body.revision), ['treatment'], reason, validate);
    return transaction(async client => {
      await authorize(actor, 'scheduling', client);
      const episode = await findEpisode(episodeId, client, true);
      checkEpisodeRevision(episode, reconciliation.revision);
      await validate(client, episode);
      await recordAppointmentReconciliation(client, episode, actor, reconciliation.pending);
      if (episode.data.treatmentAppointment) { episode.data.treatmentAppointment.postponed = true; episode.data.treatmentAppointment.confirmed = false; }
      episode.data.postponementReason = reason;
      if (episode.data.preparation) episode.data.preparation.ready = false;
      await episodeWorkflowHistory(client, episode, actor, 'treatment_postponed', reason, { stagePreserved: episode.status, appointmentReconciliationRequired: reconciliation.pending.map(item => item.bookingId) });
      return { episode, token: undefined, reconciliationRequired: reconciliation.pending.length > 0, reconciliationPending: reconciliation.pending.map(item => item.bookingId) };
    });
  }
  return transaction(async client => {
    await authorize(actor, requiredPermission, client);
    const episode = await findEpisode(episodeId, client, true);
    if (episode.revision !== Number(body.revision)) throw new HttpError(409, 'Episode changed. Reload and review before saving.');
    const correctNotSuitable = action === 'mdt' && episode.status === 'closed' && episode.data.mdt?.decision === 'not_suitable' && !episode.data.treatment?.completed;
    if (!episode.active && !correctNotSuitable && !['qr_revoke','document_visibility'].includes(action)) throw new HttpError(409, 'Episode is closed.');
    const data = episode.data; let reason = text(body.reason, 'Correction reason'); let token: string | undefined; let historyDetails: Record<string, unknown> = {};
    if (action === 'clinical' || action === 'submit') {
      requireStage(episode, ['referrals','clinical_review','mdt']);
      if (data.investigationsPending) throw new HttpError(409, 'Receive requested investigations before clinical review.');
      if (data.assessmentStatus === 'finalized') text(reason, 'Reason for correcting finalized assessment', true);
      data.clinical = clinical(body.clinical, action === 'submit', episode.diagnosisCategory);
      data.assessmentStatus = action === 'clinical' ? 'draft' : body.status === 'finalized' ? 'finalized' : body.status === 'provisional' ? 'provisional' : (() => { throw new HttpError(400, 'Choose Provisional or Finalized.'); })();
      data.assessmentRevision = episode.revision + 1;
      if (action === 'submit') data.referralReviewRequired = false;
      episode.status = action === 'submit' ? 'mdt' : 'clinical_review';
    } else if (action === 'mdt') {
      requireStage(episode, correctNotSuitable ? ['closed'] : ['mdt','preparation','treatment']);
      if (data.assessmentStatus !== 'finalized') throw new HttpError(409, 'Finalize the clinical assessment before the official MDT decision.');
      if (!['approved','additional_information','deferred','not_suitable'].includes(String(body.decision))) throw new HttpError(400, 'Invalid MDT decision.');
      const consultants = strings(body.consultants, 'Responsible consultants');
      if (!consultants.length) throw new HttpError(400, 'At least one responsible consultant is required.');
      if (data.mdt) text(reason, 'Reason for correcting the previous MDT decision', true);
      episode.active = body.decision !== 'not_suitable';
      episode.closureClassification = body.decision === 'not_suitable' ? 'not_suitable' : null;
      data.mdtReviewRequired = false;
      if (data.preparation) data.preparation.ready = false;
      if (body.decision !== 'approved' && data.treatmentAppointment) { data.treatmentAppointment.confirmed = false; data.treatmentAppointment.postponed = true; }
      data.mdt = { decision: body.decision as NonNullable<typeof data.mdt>['decision'], consultants, assessment: text(body.assessment, 'MDT assessment', true), notes: text(body.notes, 'Discussion'), investigations: text(body.investigations, 'Requested investigations', body.decision === 'additional_information'), assessmentRevision: data.assessmentRevision! };
      if (body.decision === 'approved') episode.status = 'preparation';
      if (body.decision === 'deferred') episode.status = 'mdt';
      if (body.decision === 'additional_information') {
        data.investigationsPending = true; episode.status = 'clinical_review';
        const requested = text(body.investigations, 'Requested investigations', true, 4000);
        const existingTask = await client.query("select 1 from gamma_knife_investigations where episode_id=$1 and reassessment_id is null and status='requested' and lower(requested_text)=lower($2) limit 1", [episode.id, requested]);
        if (!existingTask.rows.length) {
          const task = await client.query(`insert into gamma_knife_investigations(episode_id,requested_text,status,created_by) values($1,$2,'requested',$3) returning *`, [episode.id, requested, actor.sub]);
          await investigationHistory(client, Number(task.rows[0]!.id), actor, 'investigation_requested', task.rows[0]);
        }
      }
      if (body.decision === 'not_suitable') { episode.status = 'closed'; episode.active = false; }
    } else if (action === 'investigations') {
      if (!data.investigationsPending) throw new HttpError(409, 'No investigations are awaiting receipt.');
      const structuredPending = await client.query("select 1 from gamma_knife_investigations where episode_id=$1 and status='requested' limit 1", [episode.id]);
      if (structuredPending.rows.length) throw new HttpError(409, 'Update each outstanding investigation separately so its owner and receipt are retained.');
      reason = text(body.reason, 'Received information', true); data.investigationsPending = false; data.assessmentStatus = 'draft'; episode.status = 'clinical_review';
    } else if (action === 'preparation') {
      requireStage(episode, ['preparation','treatment']);
      const ready = body.ready === true;
      if (ready && (data.referralReviewRequired || data.mdtReviewRequired)) throw new HttpError(409, 'Complete the required clinical and MDT review of the corrected referral before proceeding.');
      if (ready) {
        const pendingChecklist = await client.query("select count(*)::int as count from gamma_knife_readiness_items where episode_id=$1 and required and status<>'completed'", [episode.id]);
        if (Number(pendingChecklist.rows[0]!.count) > 0) throw new HttpError(409, 'Complete all required operational readiness checklist items before marking this patient ready.');
      }
      data.preparation = { consent: body.consent === true, imaging: body.imaging === true, clinicalReady: body.clinicalReady === true, notes: text(body.notes, 'Preparation notes', ready), instructions: text(body.instructions, 'Patient preparation instructions'), actions: text(body.actions, 'Patient required actions'), ready };
      if (ready && (!data.preparation.consent || !data.preparation.imaging || !data.preparation.clinicalReady)) throw new HttpError(409, 'Confirm consent, required imaging, and clinical readiness.');
      // Readiness is an operational gate, not a clinical stage transition in reverse.
      // Once the episode reaches treatment, clearing readiness must not rewrite its
      // stage or the status of any treatment course/fraction.
      if (ready && episode.status === 'preparation') episode.status = 'treatment';
    } else if (action === 'appointment') {
      const purpose = body.purpose;
      if (purpose !== 'treatment' && purpose !== 'followup') throw new HttpError(400, 'Invalid appointment purpose.');
      requireStage(episode, purpose === 'treatment' ? ['preparation','treatment'] : ['followup']);
      if (purpose === 'treatment' && (data.referralReviewRequired || data.mdtReviewRequired)) throw new HttpError(409, 'Complete the required clinical and MDT review of the corrected referral before proceeding.');
      const config = await readConfig(client); const expectedExam = purpose === 'treatment' ? config.treatmentExamTypeId : config.followupExamTypeId;
      if (!expectedExam) throw new HttpError(409, 'Configure the RISpro exam type for this appointment purpose first.');
      const booking = await client.query('select id from appointments_v2.bookings where id=$1 and patient_id=$2 and exam_type_id=$3 and status=\'scheduled\' and voided_at is null for share', [id(body.bookingId), episode.patientId, expectedExam]);
      if (!booking.rows.length) throw new HttpError(409, 'Select this patient’s active RISpro booking with the configured exam type.');
      const key = purpose === 'treatment' ? 'treatmentAppointment' : 'followupAppointment';
      if (data[key]) text(reason, 'Reason for replacing appointment link', true);
      data[key] = { bookingId: id(body.bookingId), confirmed: body.confirmed === true, postponed: false };
      if (body.confirmed === true) await client.query("insert into gamma_knife_patient_communications(episode_id,kind,outcome,created_by_user_id) values($1,'appointment_confirmed','Appointment confirmed when linked to this episode.',$2)", [episode.id, actor.sub]);
      if (purpose === 'treatment') await client.query("update gamma_knife_treatment_courses set booking_id=$2,updated_at=now() where episode_id=$1 and status in ('planned','in_progress','interrupted')", [episode.id, id(body.bookingId)]);
    } else if (action === 'confirm_appointment') {
      const key = body.purpose === 'treatment' ? 'treatmentAppointment' : body.purpose === 'followup' ? 'followupAppointment' : null;
      if (!key || !data[key] || data[key].postponed) throw new HttpError(409, 'Link a current appointment first.');
      data[key].confirmed = true;
      await client.query("insert into gamma_knife_patient_communications(episode_id,kind,outcome,created_by_user_id) values($1,'appointment_confirmed','Appointment confirmed with the patient.',$2)", [episode.id, actor.sub]);
    } else if (action === 'completion') {
      throw new HttpError(409, 'Use a treatment course and record each delivered or interrupted fraction before explicitly completing the course from GammaPlan.');
    } else if (action === 'report') {
      requireStage(episode, ['followup']);
      const latestCourse = await client.query<{ id: string }>("select id from gamma_knife_treatment_courses where episode_id=$1 and status='completed' order by course_number desc limit 1", [episode.id]);
      if (!latestCourse.rows[0]) throw new HttpError(409, 'Record treatment completion first.');
      const selectedCourseId = body.courseId == null || body.courseId === '' ? Number(latestCourse.rows[0].id) : id(body.courseId);
      const selectedCourse = await client.query<{ documentation_finalized: boolean; id: string }>("select id,documentation_finalized from gamma_knife_treatment_courses where episode_id=$1 and id=$2 and status='completed' for update", [episode.id, selectedCourseId]);
      if (!selectedCourse.rows[0]) throw new HttpError(409, 'Choose a completed treatment course from this episode.');
      if (selectedCourse.rows[0].documentation_finalized) text(reason, 'Reason for replacing finalized report', true);
      const found = await client.query('select document_id from gamma_knife_documents where episode_id=$1 and document_id=$2 and category=\'treatment_report\' and removed_at is null', [episode.id, id(body.documentId)]);
      if (!found.rows.length) throw new HttpError(400, 'Upload a treatment report for this episode first.');
      await client.query('update gamma_knife_treatment_courses set report_document_id=$2,documentation_finalized=true,updated_at=now() where id=$1', [selectedCourseId, id(body.documentId)]);
      if (Number(latestCourse.rows[0].id) === selectedCourseId) {
        if (!data.treatment) throw new HttpError(409, 'The active course summary is missing; refresh the episode before finalizing the report.');
        data.treatment.reportId = id(body.documentId); data.treatment.finalized = true;
      }
    } else if (action === 'followup') {
      requireStage(episode, ['followup']);
      const latestCourse = await client.query<{ id: string; completed_at: string }>("select id,completed_at::text as completed_at from gamma_knife_treatment_courses where episode_id=$1 and status='completed' order by course_number desc limit 1", [episode.id]);
      const visit: Followup = { id: randomBytes(16).toString('hex'), date: date(body.date), condition: text(body.condition, 'Clinical condition', true), imaging: text(body.imaging, 'Imaging'), response: text(body.response, 'Response'), complications: text(body.complications, 'Complications'), severity: text(body.severity, 'Severity', Boolean(body.complications), 100), actions: text(body.actions, 'Actions', Boolean(body.complications)), nextBookingId: data.followupAppointment?.bookingId ?? null, courseId: latestCourse.rows[0] ? Number(latestCourse.rows[0].id) : null };
      if (visit.date > getTripoliToday() || (latestCourse.rows[0] && visit.date < latestCourse.rows[0].completed_at)) throw new HttpError(400, 'Follow-up date must be between treatment completion and today.');
      data.followups = [...data.followups ?? [], visit];
    } else if (action === 'followup_correct' || action === 'followup_void') {
      requireStage(episode, ['followup']); reason = text(body.reason, 'Follow-up correction reason', true);
      const visits = [...data.followups ?? []];
      const visitId = text(body.visitId, 'Follow-up ID');
      const indexValue = Number(body.visitIndex);
      const index = visitId ? visits.findIndex(item => item.id === visitId) : Number.isInteger(indexValue) && indexValue >= 0 && indexValue < visits.length ? indexValue : -1;
      if (index < 0 || !visits[index]) throw new HttpError(404, 'Follow-up record not found.');
      const before = { ...visits[index]! };
      if (action === 'followup_correct') {
        if (before.voided) throw new HttpError(409, 'An entry marked as entered in error cannot be edited.');
        const corrected: Followup = { ...before, date: date(body.date), condition: text(body.condition, 'Clinical condition', true), imaging: text(body.imaging, 'Imaging'), response: text(body.response, 'Response'), complications: text(body.complications, 'Complications'), severity: text(body.severity, 'Severity', Boolean(body.complications), 100), actions: text(body.actions, 'Actions', Boolean(body.complications)) };
        let completedDate = data.treatment?.date ?? '';
        if (corrected.courseId) {
          const course = await client.query<{ completed_at: string }>("select completed_at::text from gamma_knife_treatment_courses where id=$1 and episode_id=$2 and status='completed'", [corrected.courseId, episode.id]);
          if (course.rows[0]) completedDate = course.rows[0].completed_at;
        }
        if (corrected.date > getTripoliToday() || (completedDate && corrected.date < completedDate)) throw new HttpError(400, 'Follow-up date must be between treatment completion and today.');
        visits[index] = corrected;
        historyDetails = { visitIndex: index, previousVisit: before, correctedVisit: corrected };
      } else {
        if (before.voided) throw new HttpError(409, 'This follow-up is already marked as entered in error.');
        const voided = { ...before, voided: true, voidedReason: reason, voidedBy: actor.sub };
        visits[index] = voided;
        historyDetails = { visitIndex: index, previousVisit: before, enteredInError: voided };
      }
      data.followups = visits;
    } else if (action === 'close') {
      requireStage(episode, ['followup']);
      const openCourses = await client.query("select 1 from gamma_knife_treatment_courses where episode_id=$1 and status in ('planned','in_progress','interrupted') limit 1", [episode.id]);
      const unfinalizedCourses = await client.query("select 1 from gamma_knife_treatment_courses where episode_id=$1 and status='completed' and not documentation_finalized limit 1", [episode.id]);
      if (openCourses.rows.length || unfinalizedCourses.rows.length || !data.treatment?.finalized) throw new HttpError(409, 'Complete or resolve every treatment course and finalize its treatment report before closing follow-up.');
      reason = text(body.reason, 'Follow-up closure reason', true); data.closureReason = reason; episode.active = false; episode.status = 'closed';
      episode.closureClassification = 'completed';
    } else if (action === 'document_visibility') {
      const documentId = id(body.documentId);
      const found = await client.query('select category from gamma_knife_documents where episode_id=$1 and document_id=$2 and removed_at is null', [episode.id, documentId]);
      if (!found.rows.length) throw new HttpError(404, 'Document not found.');
      if (body.released === true && (await readConfig(client)).documentVisibility[found.rows[0].category as typeof CATEGORIES[number]] !== 'routine') throw new HttpError(409, 'Only routine documents can be released while SMS verification is deferred.');
      await client.query('update gamma_knife_documents set released=$3 where episode_id=$1 and document_id=$2', [episode.id, documentId, body.released === true]);
    } else if (action === 'document_correct') {
      reason = text(body.reason, 'Document correction reason', true);
      const documentId = id(body.documentId); const selectedCategory = body.category === undefined ? undefined : category(body.category);
      const found = await client.query('select g.category,d.original_filename as name from gamma_knife_documents g join documents d on d.id=g.document_id where g.episode_id=$1 and g.document_id=$2 and g.removed_at is null for update of g', [episode.id, documentId]);
      if (!found.rows.length) throw new HttpError(404, 'Document not found.');
      const linkedReport = await client.query('select 1 from gamma_knife_treatment_courses where episode_id=$1 and report_document_id=$2 limit 1', [episode.id, documentId]);
      if ((data.treatment?.reportId === documentId || linkedReport.rows.length > 0) && selectedCategory && selectedCategory !== 'treatment_report') throw new HttpError(409, 'The linked treatment report must remain categorized as a treatment report.');
      const displayName = body.originalFilename === undefined ? String(found.rows[0].name) : path.win32.basename(path.posix.basename(text(body.originalFilename, 'Document filename', true, 200))).replace(/[\u0000-\u001f\u007f]/g, '_').normalize('NFC');
      const nextCategory = selectedCategory ?? found.rows[0].category;
      await client.query('update gamma_knife_documents set category=$3,released=false where episode_id=$1 and document_id=$2', [episode.id, documentId, nextCategory]);
      await client.query('update documents set original_filename=$2 where id=$1', [documentId, displayName]);
      historyDetails = { documentId, before: { category: found.rows[0].category, name: found.rows[0].name }, after: { category: nextCategory, name: displayName } };
    } else if (action === 'document_remove') {
      const documentId = id(body.documentId);
      reason = text(body.reason, 'Reason for removing document', true);
      const linkedReport = await client.query('select 1 from gamma_knife_treatment_courses where episode_id=$1 and report_document_id=$2 limit 1', [episode.id, documentId]);
      if (data.treatment?.reportId === documentId || linkedReport.rows.length > 0) throw new HttpError(409, 'Replace the linked treatment report with a corrected document before removing it.');
      const found = await client.query('select document_id from gamma_knife_documents where episode_id=$1 and document_id=$2 and removed_at is null for update', [episode.id, documentId]);
      if (!found.rows.length) throw new HttpError(404, 'Document not found.');
      await client.query('update gamma_knife_documents set removed_at=now(),removed_by_user_id=$3,removal_reason=$4,released=false where episode_id=$1 and document_id=$2', [episode.id, documentId, actor.sub, reason]);
      historyDetails = { documentId, removed: true };
    } else if (action === 'qr_replace') {
      if (!(await readConfig(client)).qrEnabled) throw new HttpError(409, 'Patient QR access is disabled.');
      token = randomBytes(32).toString('base64url'); episode.qrActive = true;
      await client.query('update gamma_knife_episodes set qr_hash=$2 where id=$1', [episode.id, tokenHash(token)]);
    } else if (action === 'qr_revoke') {
      episode.qrActive = false; await client.query('update gamma_knife_episodes set qr_hash=null where id=$1', [episode.id]);
    }
    episode.revision++;
    await client.query('update gamma_knife_episodes set status=$2,active=$3,closure_classification=$4,replacement_episode_id=$5,data=$6::jsonb,revision=$7,updated_at=now() where id=$1', [episode.id, episode.status, episode.active, episode.closureClassification ?? null, episode.replacementEpisodeId ?? null, JSON.stringify(data), episode.revision]);
    await history(client, episode, actor, action, reason, Object.keys(historyDetails).length ? historyDetails : ['document_visibility','document_remove'].includes(action) ? { documentId: id(body.documentId), released: action === 'document_visibility' && body.released === true } : {});
    return { episode, ...(token ? { token } : {}), reconciliationRequired: false };
  });
}

export async function uploadEpisodeDocument(actor: Actor, episodeId: unknown, input: unknown) {
  const body = record(input); const selectedCategory = category(body.category);
  const source = body.source === undefined ? 'manual_upload' : String(body.source);
  if (source !== 'manual_upload' && source !== 'naps2_webscan') throw new HttpError(400, 'Unsupported Gamma Knife document source.');
  const pageCount = body.pageCount == null ? null : Number(body.pageCount);
  if (pageCount !== null && (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > 10000)) throw new HttpError(400, 'Invalid scanned page count.');
  const idempotencyKey = source === 'naps2_webscan' ? text(body.idempotencyKey, 'Scan upload retry key', true, 150) : null;
  if (idempotencyKey && !new RegExp(`^gamma-knife-episode:${id(episodeId)}:[0-9a-f-]{36}$`).test(idempotencyKey)) throw new HttpError(400, 'Invalid scan upload retry key.');
  return transaction(async client => {
    await authorize(actor, 'documents', client); const episode = await findEpisode(episodeId, client, true);
    if (!episode.active) throw new HttpError(409, 'Episode is closed.');
    const originalName = text(body.originalFilename, 'Filename', true, 200);
    const displayName = path.win32.basename(path.posix.basename(originalName)).replace(/[\u0000-\u001f\u007f]/g, '_').normalize('NFC');
    const fileContentBase64 = text(body.fileContentBase64, 'File content', true, 70 * 1024 * 1024);
    const contentHash = createHash('sha256').update(Buffer.from(fileContentBase64, 'base64')).digest('hex');
    if (idempotencyKey) {
      await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [idempotencyKey]);
      const existing = await client.query(`select d.id,d.patient_id,d.content_sha256,g.episode_id,g.category
        from documents d left join gamma_knife_documents g on g.document_id=d.id where d.idempotency_key=$1 for update of d`, [idempotencyKey]);
      if (existing.rows.length) {
        const row = existing.rows[0]!;
        if (Number(row.patient_id) !== episode.patientId || Number(row.episode_id) !== episode.id || row.category !== selectedCategory || row.content_sha256 !== contentHash) throw new HttpError(409, 'This scan retry key is already linked to different document content or an episode.');
        return { id: Number(row.id), revision: episode.revision };
      }
    }
    if (episode.revision !== Number(body.revision)) throw new HttpError(409, 'Episode changed. Reload before upload.');
    const duplicate = await client.query('select 1 from gamma_knife_documents g join documents d on d.id=g.document_id where g.episode_id=$1 and g.removed_at is null and d.content_sha256=$2 limit 1', [episode.id, contentHash]);
    if (duplicate.rows.length) throw new HttpError(409, 'This document is already attached to the episode.');
    const payload: DocumentUploadPayload = { patientId: episode.patientId, documentType: 'gamma_knife', originalFilename: originalName, mimeType: text(body.mimeType, 'File type', true, 100), fileContentBase64, source, pageCount, scannerName: source === 'naps2_webscan' ? 'NAPS2 WebScan' : null, idempotencyKey };
    const document = await uploadDocument(payload, actor.sub, client);
    // Keep the shared store's safe on-disk name; preserve the patient's readable label separately.
    await client.query('update documents set original_filename=$2,content_sha256=$3 where id=$1', [document.id, displayName, contentHash]);
    await client.query('insert into gamma_knife_documents(document_id,episode_id,category,created_by) values($1,$2,$3,$4)', [document.id, episode.id, selectedCategory, actor.sub]);
    episode.revision++;
    await client.query('update gamma_knife_episodes set revision=$2,updated_at=now() where id=$1', [episode.id, episode.revision]);
    await history(client, episode, actor, 'document_upload', '', { documentId: Number(document.id), category: selectedCategory, name: displayName, source });
    return { id: Number(document.id), revision: episode.revision };
  });
}
export async function episodeDocument(actor: Actor, episodeId: unknown, documentId: unknown) {
  await authorize(actor, 'documents'); await findEpisode(episodeId);
  const link = await pool.query('select document_id from gamma_knife_documents where episode_id=$1 and document_id=$2 and removed_at is null', [id(episodeId), id(documentId)]);
  if (!link.rows.length) throw new HttpError(404, 'Document not found.');
  return getDocumentById(id(documentId), pool, { allowGammaKnife: true });
}
export async function publicEpisode(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new HttpError(404, 'Patient link is unavailable.');
  const config = await readConfig(); if (!config.qrEnabled) throw new HttpError(404, 'Patient link is unavailable.');
  const found = await pool.query<{ id: number }>('select id from gamma_knife_episodes where qr_hash=$1', [tokenHash(token)]);
  if (!found.rows[0]) throw new HttpError(404, 'Patient link is unavailable.');
  const episode = await findEpisode(found.rows[0].id);
  const activeCourse = await pool.query("select 1 from gamma_knife_treatment_courses where episode_id=$1 and status in ('planned','in_progress','interrupted') limit 1", [episode.id]);
  const courseAwaitingTreatment = activeCourse.rows.length > 0;
  const appointments = [];
  for (const [purpose, link] of [['treatment', episode.data.treatmentAppointment], ['followup', episode.data.followupAppointment]] as const) {
    if (!link?.confirmed || link.postponed) continue;
    if (purpose === 'treatment' && (episode.data.mdt?.decision !== 'approved' || (episode.data.treatment?.completed && !courseAwaitingTreatment))) continue;
    const booking = await pool.query(`select booking_date::text as date,booking_time::text as time from appointments_v2.bookings where id=$1 and patient_id=$2 and status='scheduled' and voided_at is null and booking_date >= (now() at time zone 'Africa/Tripoli')::date`, [link.bookingId, episode.patientId]);
    if (booking.rows[0]) appointments.push({ purpose, ...booking.rows[0] });
  }
  const documents = (await documentsForEpisode(episode.id)).filter(d => d.released && d.visibility === 'routine').map(d => ({ id: d.id, name: d.name }));
  const preparing = episode.status === 'preparation' || episode.status === 'treatment';
  return { episodeId: episode.id, progress: STATUS_LABELS[episode.status], appointments, instructions: preparing ? episode.data.preparation?.instructions ?? '' : '', actions: preparing ? episode.data.preparation?.actions ?? '' : '', documents, sensitiveDocumentsAvailable: false };
}
export async function publicDocument(token: string, documentId: unknown) {
  const view = await publicEpisode(token); const document = view.documents.find(d => d.id === id(documentId));
  if (!document) throw new HttpError(404, 'Document is unavailable.');
  const stored = await getDocumentById(document.id, pool, { allowGammaKnife: true });
  const content = await readDocumentContent(stored);
  // Recheck token/release/policy after reading storage, before returning any bytes.
  if (!(await publicEpisode(token)).documents.some(d => d.id === document.id)) throw new HttpError(404, 'Document is unavailable.');
  return { document: stored, content };
}
