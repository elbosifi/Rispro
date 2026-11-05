import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import type { PoolClient } from 'pg';
import { pool } from '../../db/pool.js';
import { HttpError } from '../../utils/http-error.js';
import { getTripoliToday } from '../../utils/date.js';
import { logAuditEntry } from '../../services/audit-service.js';
import { uploadDocument, getDocumentById, readDocumentContent, type DocumentUploadPayload } from '../../services/document-service.js';
import type { AuthenticatedUserContext } from '../../types/http.js';
import { CATEGORIES, PERMISSIONS, STATUS_LABELS, nextAction, type Config, type Episode, type EpisodeDocument, type Investigation, type Permission, type Reassessment, type Followup, type Treatment, type TreatmentCourse, type TreatmentFraction } from './gamma-knife-types.js';
import { actionPermission, category, clinical, config as validateConfig, date, id, record, requireStage, strings, text } from './gamma-knife-validation.js';

type Db = PoolClient | typeof pool;
export type Actor = AuthenticatedUserContext;
const SELECT = `select e.id, e.patient_id as "patientId", e.diagnosis, e.diagnosis_category as "diagnosisCategory", e.status, e.active, e.revision, e.data,
  coalesce(nullif(p.english_full_name,''),p.arabic_full_name) as "patientName", p.arabic_full_name as "patientArabicName", p.english_full_name as "patientEnglishName", p.mrn, e.updated_at as "updatedAt", (e.qr_hash is not null) as "qrActive",
  (select b.booking_date::text from appointments_v2.bookings b where b.id=(e.data->'followupAppointment'->>'bookingId')::bigint
    and b.patient_id=e.patient_id and b.status='scheduled' and b.voided_at is null
    and not exists(select 1 from jsonb_array_elements(coalesce(e.data->'followups','[]'::jsonb)) v where (v->>'date')::date >= b.booking_date)
  ) as "followupDate"
  from gamma_knife_episodes e join patients p on p.id=e.patient_id`;
function episodeRow(row: Episode): Episode { return { ...row, id: Number(row.id), patientId: Number(row.patientId) }; }
export function tokenHash(token: string): string { return createHash('sha256').update(token).digest('hex'); }

export async function permissions(actor: Actor, db: Db = pool): Promise<Permission[]> {
  const result = await db.query<{ gamma_knife_permissions: Permission[] }>('select gamma_knife_permissions from users where id=$1 and is_active=true', [actor.sub]);
  return result.rows[0]?.gamma_knife_permissions ?? [];
}
export async function authorize(actor: Actor, permission: Permission = 'access', db: Db = pool): Promise<void> {
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
      await client.query('update users set gamma_knife_permissions=$2::text[] where id=$1', [id(user.id), granted]);
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
  await client.query('insert into gamma_knife_history(episode_id,revision,action,snapshot,actor_id) values($1,$2,$3,$4::jsonb,$5)', [episode.id, episode.revision, action, JSON.stringify({ diagnosis: episode.diagnosis, status: episode.status, active: episode.active, qrActive: episode.qrActive, data: episode.data, reason, details }), actor.sub]);
  await logAuditEntry({ entityType: 'gamma_knife_episode', entityId: episode.id, actionType: action, changedByUserId: actor.sub, newValues: { revision: episode.revision, status: episode.status } }, client);
}
function checkEpisodeRevision(episode: Episode, value: unknown) {
  if (episode.revision !== Number(value)) throw new HttpError(409, 'Episode changed. Reload and review before saving.');
}
async function episodeWorkflowHistory(client: PoolClient, episode: Episode, actor: Actor, action: string, reason: string, details: Record<string, unknown> = {}) {
  episode.revision++;
  await client.query('update gamma_knife_episodes set status=$2,active=$3,data=$4::jsonb,revision=$5,updated_at=now() where id=$1', [episode.id, episode.status, episode.active, JSON.stringify(episode.data), episode.revision]);
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
      const patient = await client.query("select id from patients where id=$1 and coalesce(nullif(trim(phone_1),''),nullif(trim(phone_2),''),'') <> '' for key share", [id(body.patientId)]);
      if (!patient.rows.length) throw new HttpError(400, 'An existing patient with contact information is required.');
      const inserted = await client.query<{ id: number }>('insert into gamma_knife_episodes(patient_id,diagnosis,diagnosis_category,data,created_by) values($1,$2,$3,$4::jsonb,$5) returning id', [id(body.patientId), text(body.diagnosis, 'Provisional diagnosis', true, 1000), diagnosisCategory, JSON.stringify({ checklist: definition.checklist }), actor.sub]);
      const episode = await findEpisode(inserted.rows[0]!.id, client);
      await history(client, episode, actor, 'referral'); return episode;
    });
  } catch (error) {
    if ((error as { code?: string; constraint?: string }).constraint === 'gamma_knife_one_active_episode') throw new HttpError(409, 'This patient already has an active Gamma Knife episode.');
    throw error;
  }
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
    responsible_user_id as "responsibleUserId",responsible_name_snapshot as "responsibleName",due_date::text as "dueDate",i.status,
    evidence_document_id as "evidenceDocumentId",received_note as "receivedNote",i.created_at as "createdAt"
    from gamma_knife_investigations i where i.episode_id=$1 order by (i.status='requested') desc,i.due_date nulls last,i.created_at,i.id`, [episodeId]);
  const investigationHistoryRows = await db.query(`select h.investigation_id as "investigationId",h.action,h.reason,h.snapshot,u.full_name as actor,h.created_at as "createdAt"
    from gamma_knife_investigation_history h join gamma_knife_investigations i on i.id=h.investigation_id join users u on u.id=h.actor_id
    where i.episode_id=$1 order by h.created_at,h.id`, [episodeId]);
  const courseRows = courses.rows.map(row => ({ ...row, id: Number(row.id), episodeId: Number(row.episodeId), courseNumber: Number(row.courseNumber), priorCourseId: row.priorCourseId == null ? null : Number(row.priorCourseId), reassessmentId: row.reassessmentId == null ? null : Number(row.reassessmentId), plannedFractionCount: Number(row.plannedFractionCount), fractions: fractions.rows.filter(f => Number(f.courseId) === Number(row.id)).map(f => ({ ...f, id: Number(f.id), createdBy: Number(f.createdBy) })), history: courseHistory.rows.filter(h => Number(h.courseId) === Number(row.id)).map(h => ({ action: h.action, reason: h.reason, snapshot: h.snapshot, actor: h.actor, createdAt: h.createdAt })) } as TreatmentCourse));
  return {
    courses: courseRows,
    reassessments: reassessments.rows.map(row => ({ id: Number(row.id), episodeId: Number(row.episodeId), courseId: Number(row.courseId), reason: row.reason, reasonDetail: row.reasonDetail, status: row.status, decision: row.decision ? { decision: row.decision, assessment: row.assessment, notes: row.notes, consultants: row.consultants, reason: row.decisionReason, revision: Number(row.revision), createdAt: row.decisionAt } : null, decisionHistory: reassessmentDecisions.rows.filter(item => Number(item.reassessmentId) === Number(row.id)).map(item => ({ decision: item.decision, assessment: item.assessment, notes: item.notes, consultants: item.consultants, reason: item.reason, revision: Number(item.revision), createdAt: item.createdAt })) } as Reassessment)),
    investigations: investigations.rows.map(row => ({ ...row, id: Number(row.id), episodeId: Number(row.episodeId), reassessmentId: row.reassessmentId == null ? null : Number(row.reassessmentId), responsibleUserId: row.responsibleUserId == null ? null : Number(row.responsibleUserId), evidenceDocumentId: row.evidenceDocumentId == null ? null : Number(row.evidenceDocumentId), history: investigationHistoryRows.rows.filter(h => Number(h.investigationId) === Number(row.id)).map(h => ({ action: h.action, reason: h.reason, snapshot: h.snapshot, actor: h.actor, createdAt: h.createdAt })) } as Investigation)),
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
  const reassessmentReady = workflow.reassessments.some(item => item.status === 'requested');
  const granted = await permissions(actor);
  return { episode, history: revisions.rows, episodes: past.rows.map(e => ({ ...e, id: Number(e.id) })), documents: granted.includes('documents') ? await documentsForEpisode(episode.id) : [], appointments: appointments.rows.map(a => ({ ...a, id: Number(a.id), examTypeId: Number(a.examTypeId) })), ...workflow, config, permissions: granted, gammaKnifeOnly: Boolean(actor.gammaKnifeOnly), nextAction: reassessmentReady ? 'Record MDT decision for post-treatment reassessment' : nextAction(episode) };
}
export async function investigationAssignees(actor: Actor) {
  await authorize(actor);
  const result = await pool.query(`select id,full_name as name from users where is_active=true and gamma_knife_permissions @> array['access']::text[]
    and gamma_knife_permissions && array['clinical','mdt','documents']::text[] order by full_name,id`);
  return result.rows.map(row => ({ ...row, id: Number(row.id) }));
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
      const existing = await client.query<{ id: string; status: string }>('select id,status from gamma_knife_treatment_courses where episode_id=$1 order by course_number desc limit 1', [episode.id]);
      let priorCourseId: number | null = null; let reassessmentId: number | null = null;
      if (existing.rows.length) {
        priorCourseId = id(body.priorCourseId); reassessmentId = id(body.reassessmentId);
        if (Number(existing.rows[0]!.id) !== priorCourseId || existing.rows[0]!.status !== 'completed') throw new HttpError(409, 'A repeat course must link to a completed prior course.');
        const reassessment = await client.query(`select r.status,d.decision from gamma_knife_reassessments r
          join lateral (select decision from gamma_knife_reassessment_decisions where reassessment_id=r.id order by revision desc limit 1) d on true
          where r.id=$1 and r.episode_id=$2 and r.course_id=$3 for update of r`, [reassessmentId, episode.id, priorCourseId]);
        if (!reassessment.rows.length || reassessment.rows[0]!.status !== 'decided' || reassessment.rows[0]!.decision !== 'approved') throw new HttpError(409, 'An approved reassessment linked to the completed course is required before creating a repeat course.');
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
      await treatmentHistory(client, Number(course.id), actor, 'course_created', course);
      await episodeWorkflowHistory(client, episode, actor, 'course_created', '', { courseId: Number(course.id), priorCourseId, reassessmentId });
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
  return transaction(async client => {
    await authorize(actor, 'treatment', client);
    const episode = await findEpisode(episodeId, client, true); checkEpisodeRevision(episode, body.revision);
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
    await episodeWorkflowHistory(client, episode, actor, `course_${actionName}`, reason, { courseId: id(courseId) });
    return { course: updated.rows[0], episode, ...await workflowRecords(episode.id, client) };
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
      const assigned = await client.query<{ full_name: string }>(`select full_name from users where id=$1 and is_active=true and gamma_knife_permissions @> array['access']::text[] and gamma_knife_permissions && array['clinical','mdt','documents']::text[]`, [responsible]);
      if (!assigned.rows.length) throw new HttpError(400, 'Assign the investigation to an active Gamma Knife team member.'); name = assigned.rows[0]!.full_name;
    }
    const inserted = await client.query(`insert into gamma_knife_investigations(episode_id,reassessment_id,requested_text,responsible_user_id,responsible_name_snapshot,due_date,created_by)
      values($1,$2,$3,$4,$5,$6,$7) returning *`, [episode.id, reassessmentId, requestedText, responsible, name, dueDate, actor.sub]);
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
    if (!granted.includes('access') || (!granted.includes('mdt') && !granted.includes('documents'))) throw new HttpError(403, 'Gamma Knife assignment and MDT or documents permission required.');
    if (body.evidenceDocumentId != null && body.evidenceDocumentId !== '' && !granted.includes('documents')) throw new HttpError(403, 'Documents permission is required to link investigation evidence.');
    const episode = await findEpisode(episodeId, client, true); checkEpisodeRevision(episode, body.revision);
    if (!episode.active) throw new HttpError(409, 'Episode is closed.');
    const found = await client.query('select * from gamma_knife_investigations where id=$1 and episode_id=$2 for update', [id(investigationId), episode.id]);
    if (!found.rows.length) throw new HttpError(404, 'Investigation not found.'); const before = found.rows[0] as Record<string, unknown>;
    if (actionName === 'cancel' && before.status !== 'requested') throw new HttpError(409, 'Only a requested investigation can be cancelled.');
    if (actionName === 'receive' && before.status !== 'requested') throw new HttpError(409, 'Only a requested investigation can be received.');
    if (actionName === 'reopen' && before.status === 'requested') throw new HttpError(409, 'This investigation is already outstanding.');
    let requestedText = String(before.requested_text); let responsibleUserId = before.responsible_user_id == null ? null : Number(before.responsible_user_id); let responsibleName = before.responsible_name_snapshot as string | null;
    let dueDate = before.due_date ? String(before.due_date).slice(0,10) : null; let status = String(before.status); let evidenceDocumentId = before.evidence_document_id == null ? null : Number(before.evidence_document_id); let receivedNote = before.received_note as string | null;
    if (actionName === 'correct') {
      requestedText = text(body.requestedText, 'Requested investigation', true, 4000);
      dueDate = body.dueDate === undefined ? dueDate : body.dueDate == null || body.dueDate === '' ? null : date(body.dueDate);
    }
    if (actionName === 'assign' || body.responsibleUserId !== undefined) {
      responsibleUserId = body.responsibleUserId == null || body.responsibleUserId === '' ? null : id(body.responsibleUserId);
      if (responsibleUserId) {
        const assigned = await client.query<{ full_name: string }>(`select full_name from users where id=$1 and is_active=true and gamma_knife_permissions @> array['access']::text[] and gamma_knife_permissions && array['clinical','mdt','documents']::text[]`, [responsibleUserId]);
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
    const saved = await client.query(`update gamma_knife_investigations set requested_text=$2,responsible_user_id=$3,responsible_name_snapshot=$4,due_date=$5,status=$6,evidence_document_id=$7,received_note=$8,updated_at=now() where id=$1 returning *`, [id(investigationId), requestedText, responsibleUserId, responsibleName, dueDate, status, evidenceDocumentId, receivedNote]);
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
      episode.status = action === 'submit' ? 'mdt' : 'clinical_review';
    } else if (action === 'mdt') {
      requireStage(episode, correctNotSuitable ? ['closed'] : ['mdt','preparation','treatment']);
      if (data.assessmentStatus !== 'finalized') throw new HttpError(409, 'Finalize the clinical assessment before the official MDT decision.');
      if (!['approved','additional_information','deferred','not_suitable'].includes(String(body.decision))) throw new HttpError(400, 'Invalid MDT decision.');
      const consultants = strings(body.consultants, 'Responsible consultants');
      if (!consultants.length) throw new HttpError(400, 'At least one responsible consultant is required.');
      if (data.mdt) text(reason, 'Reason for correcting the previous MDT decision', true);
      episode.active = body.decision !== 'not_suitable';
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
      data.preparation = { consent: body.consent === true, imaging: body.imaging === true, clinicalReady: body.clinicalReady === true, notes: text(body.notes, 'Preparation notes', ready), instructions: text(body.instructions, 'Patient preparation instructions'), actions: text(body.actions, 'Patient required actions'), ready };
      if (ready && (!data.preparation.consent || !data.preparation.imaging || !data.preparation.clinicalReady)) throw new HttpError(409, 'Confirm consent, required imaging, and clinical readiness.');
      episode.status = ready ? 'treatment' : 'preparation';
    } else if (action === 'appointment') {
      const purpose = body.purpose;
      if (purpose !== 'treatment' && purpose !== 'followup') throw new HttpError(400, 'Invalid appointment purpose.');
      requireStage(episode, purpose === 'treatment' ? ['preparation','treatment'] : ['followup']);
      const config = await readConfig(client); const expectedExam = purpose === 'treatment' ? config.treatmentExamTypeId : config.followupExamTypeId;
      if (!expectedExam) throw new HttpError(409, 'Configure the RISpro exam type for this appointment purpose first.');
      const booking = await client.query('select id from appointments_v2.bookings where id=$1 and patient_id=$2 and exam_type_id=$3 and status=\'scheduled\' and voided_at is null for share', [id(body.bookingId), episode.patientId, expectedExam]);
      if (!booking.rows.length) throw new HttpError(409, 'Select this patient’s active RISpro booking with the configured exam type.');
      const key = purpose === 'treatment' ? 'treatmentAppointment' : 'followupAppointment';
      if (data[key]) text(reason, 'Reason for replacing appointment link', true);
      data[key] = { bookingId: id(body.bookingId), confirmed: body.confirmed === true, postponed: false };
      if (purpose === 'treatment') await client.query("update gamma_knife_treatment_courses set booking_id=$2,updated_at=now() where episode_id=$1 and status in ('planned','in_progress','interrupted')", [episode.id, id(body.bookingId)]);
    } else if (action === 'confirm_appointment') {
      const key = body.purpose === 'treatment' ? 'treatmentAppointment' : body.purpose === 'followup' ? 'followupAppointment' : null;
      if (!key || !data[key] || data[key].postponed) throw new HttpError(409, 'Link a current appointment first.');
      data[key].confirmed = true;
    } else if (action === 'postpone') {
      requireStage(episode, ['preparation','treatment']); reason = text(body.reason, 'Postponement reason', true);
      if (data.treatmentAppointment) { data.treatmentAppointment.postponed = true; data.treatmentAppointment.confirmed = false; }
      data.postponementReason = reason;
      if (data.preparation) data.preparation.ready = false;
      episode.status = 'preparation';
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
    await client.query('update gamma_knife_episodes set status=$2,active=$3,data=$4::jsonb,revision=$5,updated_at=now() where id=$1', [episode.id, episode.status, episode.active, JSON.stringify(data), episode.revision]);
    await history(client, episode, actor, action, reason, Object.keys(historyDetails).length ? historyDetails : ['document_visibility','document_remove'].includes(action) ? { documentId: id(body.documentId), released: action === 'document_visibility' && body.released === true } : {});
    return { episode, ...(token ? { token } : {}) };
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
  await authorize(actor); await findEpisode(episodeId);
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
