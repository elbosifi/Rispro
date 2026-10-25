import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import type { PoolClient } from 'pg';
import { pool } from '../../db/pool.js';
import { HttpError } from '../../utils/http-error.js';
import { getTripoliToday } from '../../utils/date.js';
import { logAuditEntry } from '../../services/audit-service.js';
import { uploadDocument, getDocumentById, readDocumentContent, type DocumentUploadPayload } from '../../services/document-service.js';
import type { AuthenticatedUserContext } from '../../types/http.js';
import { CATEGORIES, PERMISSIONS, STATUS_LABELS, nextAction, type Config, type Episode, type EpisodeDocument, type Permission, type Followup, type Treatment } from './gamma-knife-types.js';
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
  const result = await db.query('select d.id,d.original_filename as name,g.category,g.released from gamma_knife_documents g join documents d on d.id=g.document_id where g.episode_id=$1 order by g.created_at desc', [episodeId]);
  return result.rows.map(d => ({ ...d, id: Number(d.id), visibility: config.documentVisibility[d.category as typeof CATEGORIES[number]] } as EpisodeDocument));
}
export async function profile(actor: Actor, episodeId: unknown) {
  await authorize(actor); const episode = await findEpisode(episodeId);
  const past = await pool.query<{ id: number; status: string }>('select id,status from gamma_knife_episodes where patient_id=$1 order by created_at desc', [episode.patientId]);
  const revisions = await pool.query('select h.revision,h.action,h.snapshot,h.created_at as "createdAt",u.full_name as actor from gamma_knife_history h join users u on u.id=h.actor_id where h.episode_id=$1 order by h.revision desc', [episode.id]);
  const appointments = await pool.query(`select id,booking_date::text as date,booking_time::text as time,status,exam_type_id as "examTypeId" from appointments_v2.bookings where patient_id=$1 order by booking_date desc,id desc limit 100`, [episode.patientId]);
  return { episode, history: revisions.rows, episodes: past.rows.map(e => ({ ...e, id: Number(e.id) })), documents: await documentsForEpisode(episode.id), appointments: appointments.rows.map(a => ({ ...a, id: Number(a.id), examTypeId: Number(a.examTypeId) })), config: await readConfig(), permissions: await permissions(actor), nextAction: nextAction(episode) };
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
    const data = episode.data; let reason = text(body.reason, 'Correction reason'); let token: string | undefined;
    if (action === 'clinical' || action === 'submit') {
      requireStage(episode, ['referrals','clinical_review','mdt']);
      if (data.investigationsPending) throw new HttpError(409, 'Receive requested investigations before clinical review.');
      if (data.assessmentStatus === 'finalized') text(reason, 'Reason for correcting finalized assessment', true);
      data.clinical = clinical(body.clinical, action === 'submit');
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
      if (body.decision === 'additional_information') { data.investigationsPending = true; episode.status = 'clinical_review'; }
      if (body.decision === 'not_suitable') { episode.status = 'closed'; episode.active = false; }
    } else if (action === 'investigations') {
      if (!data.investigationsPending) throw new HttpError(409, 'No investigations are awaiting receipt.');
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
      requireStage(episode, ['treatment']);
      if (!data.preparation?.ready || body.confirmed !== true) throw new HttpError(409, 'Readiness and explicit clinical completion confirmation are required.');
      const team = strings(body.team, 'Treatment team'); const fractions = Number(body.fractions);
      const completedDate = date(body.date);
      if (completedDate > getTripoliToday()) throw new HttpError(400, 'Completed treatment cannot have a future date.');
      if (!team.length || !Number.isInteger(fractions) || fractions < 1 || fractions > 100 || !['frame','mask'].includes(String(body.immobilization))) throw new HttpError(400, 'Provide frame/mask, valid fractions, and treatment team.');
      data.treatment = { date: completedDate, immobilization: body.immobilization as Treatment['immobilization'], fractions, team, completed: true, reportId: null, finalized: false };
      episode.status = 'followup';
    } else if (action === 'report') {
      requireStage(episode, ['followup']);
      if (!data.treatment?.completed) throw new HttpError(409, 'Record treatment completion first.');
      if (data.treatment.finalized) text(reason, 'Reason for replacing finalized report', true);
      const found = await client.query('select document_id from gamma_knife_documents where episode_id=$1 and document_id=$2 and category=\'treatment_report\'', [episode.id, id(body.documentId)]);
      if (!found.rows.length) throw new HttpError(400, 'Upload a treatment report for this episode first.');
      data.treatment.reportId = id(body.documentId); data.treatment.finalized = true;
    } else if (action === 'followup') {
      requireStage(episode, ['followup']);
      const visit: Followup = { date: date(body.date), condition: text(body.condition, 'Clinical condition', true), imaging: text(body.imaging, 'Imaging'), response: text(body.response, 'Response'), complications: text(body.complications, 'Complications'), severity: text(body.severity, 'Severity', Boolean(body.complications), 100), actions: text(body.actions, 'Actions', Boolean(body.complications)), nextBookingId: data.followupAppointment?.bookingId ?? null };
      if (visit.date > getTripoliToday() || visit.date < data.treatment!.date) throw new HttpError(400, 'Follow-up date must be between treatment completion and today.');
      data.followups = [...data.followups ?? [], visit];
    } else if (action === 'close') {
      requireStage(episode, ['followup']);
      if (!data.treatment?.finalized) throw new HttpError(409, 'Finalize treatment documentation before closing follow-up.');
      reason = text(body.reason, 'Follow-up closure reason', true); data.closureReason = reason; episode.active = false; episode.status = 'closed';
    } else if (action === 'document_visibility') {
      const documentId = id(body.documentId);
      const found = await client.query('select category from gamma_knife_documents where episode_id=$1 and document_id=$2', [episode.id, documentId]);
      if (!found.rows.length) throw new HttpError(404, 'Document not found.');
      if (body.released === true && (await readConfig(client)).documentVisibility[found.rows[0].category as typeof CATEGORIES[number]] !== 'routine') throw new HttpError(409, 'Only routine documents can be released while SMS verification is deferred.');
      await client.query('update gamma_knife_documents set released=$3 where episode_id=$1 and document_id=$2', [episode.id, documentId, body.released === true]);
    } else if (action === 'qr_replace') {
      if (!(await readConfig(client)).qrEnabled) throw new HttpError(409, 'Patient QR access is disabled.');
      token = randomBytes(32).toString('base64url'); episode.qrActive = true;
      await client.query('update gamma_knife_episodes set qr_hash=$2 where id=$1', [episode.id, tokenHash(token)]);
    } else if (action === 'qr_revoke') {
      episode.qrActive = false; await client.query('update gamma_knife_episodes set qr_hash=null where id=$1', [episode.id]);
    }
    episode.revision++;
    await client.query('update gamma_knife_episodes set status=$2,active=$3,data=$4::jsonb,revision=$5,updated_at=now() where id=$1', [episode.id, episode.status, episode.active, JSON.stringify(data), episode.revision]);
    await history(client, episode, actor, action, reason, action === 'document_visibility' ? { documentId: id(body.documentId), released: body.released === true } : {});
    return { episode, ...(token ? { token } : {}) };
  });
}

export async function uploadEpisodeDocument(actor: Actor, episodeId: unknown, input: unknown) {
  const body = record(input); const selectedCategory = category(body.category);
  return transaction(async client => {
    await authorize(actor, 'documents', client); const episode = await findEpisode(episodeId, client, true);
    if (!episode.active) throw new HttpError(409, 'Episode is closed.');
    if (episode.revision !== Number(body.revision)) throw new HttpError(409, 'Episode changed. Reload before upload.');
    const originalName = text(body.originalFilename, 'Filename', true, 200);
    const displayName = path.win32.basename(path.posix.basename(originalName)).replace(/[\u0000-\u001f\u007f]/g, '_').normalize('NFC');
    const payload: DocumentUploadPayload = { patientId: episode.patientId, documentType: 'gamma_knife', originalFilename: originalName, mimeType: text(body.mimeType, 'File type', true, 100), fileContentBase64: text(body.fileContentBase64, 'File content', true, 70 * 1024 * 1024), source: 'manual_upload' };
    const document = await uploadDocument(payload, actor.sub, client);
    // Keep the shared store's safe on-disk name; preserve the patient's readable label separately.
    await client.query('update documents set original_filename=$2 where id=$1', [document.id, displayName]);
    await client.query('insert into gamma_knife_documents(document_id,episode_id,category,created_by) values($1,$2,$3,$4)', [document.id, episode.id, selectedCategory, actor.sub]);
    episode.revision++;
    await client.query('update gamma_knife_episodes set revision=$2,updated_at=now() where id=$1', [episode.id, episode.revision]);
    await history(client, episode, actor, 'document_upload', '', { documentId: Number(document.id), category: selectedCategory, name: displayName });
    return { id: Number(document.id) };
  });
}
export async function episodeDocument(actor: Actor, episodeId: unknown, documentId: unknown) {
  await authorize(actor); await findEpisode(episodeId);
  const link = await pool.query('select document_id from gamma_knife_documents where episode_id=$1 and document_id=$2', [id(episodeId), id(documentId)]);
  if (!link.rows.length) throw new HttpError(404, 'Document not found.');
  return getDocumentById(id(documentId), pool, { allowGammaKnife: true });
}
export async function publicEpisode(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new HttpError(404, 'Patient link is unavailable.');
  const config = await readConfig(); if (!config.qrEnabled) throw new HttpError(404, 'Patient link is unavailable.');
  const found = await pool.query<{ id: number }>('select id from gamma_knife_episodes where qr_hash=$1', [tokenHash(token)]);
  if (!found.rows[0]) throw new HttpError(404, 'Patient link is unavailable.');
  const episode = await findEpisode(found.rows[0].id);
  const appointments = [];
  for (const [purpose, link] of [['treatment', episode.data.treatmentAppointment], ['followup', episode.data.followupAppointment]] as const) {
    if (!link?.confirmed || link.postponed) continue;
    if (purpose === 'treatment' && (episode.data.mdt?.decision !== 'approved' || episode.data.treatment?.completed)) continue;
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
