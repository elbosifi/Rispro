import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import cookieParser from 'cookie-parser';
import { createServer, type Server } from 'node:http';
import { unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pool } from '../../db/pool.js';
import { errorHandler } from '../../middleware/error-handler.js';
import { documentsRouter } from '../../routes/documents.js';
import { getDocumentAbsolutePath, getDocumentById } from '../../services/document-service.js';
import { getSettingsByCategory, upsertSettings } from '../../services/settings-service.js';
import { gammaKnifeRouter, gammaKnifePublicRouter } from './gamma-knife-routes.js';
import { createTestAuthCookie, seedTestData, cleanupTestData, type TestData } from '../appointments-v2/tests/integration/helpers.js';
import { changeEpisode, createEpisode, findEpisode, publicEpisode, readConfig } from './gamma-knife-service.js';
import { PERMISSIONS, type Config, type Episode } from './gamma-knife-types.js';

const prefix = `GK${randomUUID().replaceAll('-','').slice(0,6)}_`;
let fixture: TestData; let server: Server; let base: string; let previous: Config;
let cookie: string; let outsider: number; let episode: Episode; let followupExam: number;
const episodeIds: number[] = []; const documentIds: number[] = []; const bookingIds: number[] = [];
const actor = () => ({ sub: fixture.userId, role: 'supervisor' as const });
const answers = { history: 'Synthetic history', examination: 'Synthetic examination', imaging: 'Synthetic MRI', assessment: 'Synthetic assessment', priorTreatment: '', diagnosisDetails: '' };
async function request(path: string, body?: unknown, auth = cookie, method = 'POST') {
  const result = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : method, headers: { 'Content-Type': 'application/json', Cookie: auth }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: result.status, body: await result.json() };
}
async function command(action: string, values: object = {}) {
  const result = await request(`/api/gamma-knife/episodes/${episode.id}/actions/${action}`, { revision: episode.revision, ...values });
  assert.equal(result.status, 200, JSON.stringify(result.body)); episode = result.body.episode as Episode; return result.body;
}
async function booking(exam: number, patient = fixture.patientId) {
  const result = await pool.query(`insert into appointments_v2.bookings(patient_id,modality_id,exam_type_id,booking_date,booking_time,case_category,requires_report,status,policy_version_id,capacity_resolution_mode,uses_special_quota,is_walk_in,created_by_user_id)
    values($1,$2,$3,'2045-05-12','09:00','non_oncology',false,'scheduled',$4,'standard',false,false,$5) returning id`, [patient, fixture.modalityId, exam, fixture.policyVersionId, fixture.userId]);
  const value = Number(result.rows[0].id); bookingIds.push(value); return value;
}
async function upload(category: string, name = 'synthetic.pdf') {
  const result = await request(`/api/gamma-knife/episodes/${episode.id}/documents`, { revision: episode.revision, category, originalFilename: name, mimeType: 'application/pdf', fileContentBase64: Buffer.from('%PDF-1.4\nSynthetic test file\n%%EOF').toString('base64') });
  assert.equal(result.status, 201, JSON.stringify(result.body)); documentIds.push(Number(result.body.id)); episode = await findEpisode(episode.id); return Number(result.body.id);
}
describe('Gamma Knife minimal episode workflow and access boundaries', { concurrency: false }, () => {
  before(async () => {
    const target = await pool.query<{ name: string }>('select current_database() as name'); assert.match(target.rows[0]!.name, /test|e2e/i);
    previous = await readConfig(); fixture = await seedTestData('appointments_v2', prefix);
    await pool.query('update users set gamma_knife_permissions=$2::text[] where id=$1', [fixture.userId, PERMISSIONS]);
    const user = await pool.query("insert into users(username,password_hash,full_name,role,is_active) values($1,'unused','Unassigned Gamma Test','doctor',true) returning id", [`${prefix}outsider`.toLowerCase()]); outsider = Number(user.rows[0].id);
    const exam = await pool.query("insert into exam_types(modality_id,name_ar,name_en,code,is_active) values($1,'Follow-up','Follow-up',$2,true) returning id", [fixture.modalityId, `${prefix}FU`]); followupExam = Number(exam.rows[0].id);
    await pool.query("update system_settings set setting_value=$1::jsonb where category='gamma_knife' and setting_key='config'", [JSON.stringify({ ...previous, treatmentExamTypeId: fixture.examTypeId, followupExamTypeId: followupExam })]);
    const app = express(); app.use(express.json({ limit: '75mb' })); app.use(cookieParser()); app.use('/api/gamma-knife', gammaKnifeRouter); app.use('/api/public/gamma-knife', gammaKnifePublicRouter); app.use('/api/documents', documentsRouter); app.use(errorHandler);
    server = createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('No test server'); base = `http://127.0.0.1:${address.port}`; cookie = createTestAuthCookie(fixture.userId);
  });
  after(async () => {
    if (server) await new Promise<void>((resolve,reject) => server.close(error => error ? reject(error) : resolve()));
    if (fixture) {
      for (const documentId of documentIds) { const document = await getDocumentById(documentId, pool, { allowGammaKnife: true }); await unlink(getDocumentAbsolutePath(document)).catch(() => undefined); }
      await pool.query('delete from gamma_knife_documents where episode_id=any($1::bigint[])', [episodeIds]);
      await pool.query('delete from gamma_knife_history where episode_id=any($1::bigint[])', [episodeIds]);
      await pool.query('delete from gamma_knife_episodes where id=any($1::bigint[])', [episodeIds]);
      await pool.query('delete from documents where id=any($1::bigint[])', [documentIds]);
      await pool.query('delete from appointments_v2.bookings where id=any($1::bigint[])', [bookingIds]);
      await pool.query('delete from exam_types where id=$1', [followupExam]);
      await pool.query("update system_settings set setting_value=$1::jsonb where category='gamma_knife' and setting_key='config'", [JSON.stringify(previous)]);
      await cleanupTestData(prefix); await pool.query('delete from users where id=$1', [outsider]);
    }
    await pool.end();
  });
  it('rejects unassigned users and enforces the active-episode uniqueness race', async () => {
    const denied = await request('/api/gamma-knife/episodes', undefined, createTestAuthCookie(outsider, 'doctor')); assert.equal(denied.status, 403);
    const concurrent = await Promise.allSettled([1,2].map(() => createEpisode(actor(), { patientId: fixture.patientId, diagnosis: 'Synthetic provisional diagnosis', diagnosisCategory: previous.diagnoses[0]!.name })));
    const successful = concurrent.filter((r): r is PromiseFulfilledResult<Episode> => r.status === 'fulfilled'); assert.equal(successful.length, 1);
    episode = successful[0]!.value; episodeIds.push(episode.id); assert.equal(concurrent.filter(r => r.status === 'rejected').length, 1);
  });
  it('protects essential clinical fields, stale drafts, and provisional MDT discussion', async () => {
    const missing = await request(`/api/gamma-knife/episodes/${episode.id}/actions/submit`, { revision: episode.revision, clinical: {}, status: 'finalized' }); assert.equal(missing.status, 400);
    await command('clinical', { clinical: answers });
    const stale = await request(`/api/gamma-knife/episodes/${episode.id}/actions/clinical`, { revision: 1, clinical: answers }); assert.equal(stale.status, 409);
    await command('submit', { clinical: answers, status: 'provisional' });
    const provisionalProfile = await request(`/api/gamma-knife/episodes/${episode.id}`); assert.equal(provisionalProfile.body.nextAction, 'Finalize clinical assessment before the MDT decision');
    const provisional = await request(`/api/gamma-knife/episodes/${episode.id}/actions/mdt`, { revision: episode.revision, decision: 'approved', consultants: ['External consultant'], assessment: 'Synthetic MDT' }); assert.equal(provisional.status, 409);
    await command('clinical', { clinical: { ...answers, history: 'Updated draft history' } });
    assert.equal(episode.status, 'clinical_review'); assert.equal(episode.data.assessmentStatus, 'draft');
    await command('submit', { clinical: answers, status: 'finalized' });
  });
  it('uses existing administrator authority, protects assignments and rejects stale settings', async () => {
    assert.equal((await request('/api/gamma-knife/settings', undefined, createTestAuthCookie(outsider,'doctor'))).status, 403);
    await assert.rejects(() => getSettingsByCategory('gamma_knife'));
    await assert.rejects(() => upsertSettings('gamma_knife', [{ key: 'config', value: {} }], fixture.userId));
    await pool.query("update users set role='super_admin' where id=$1", [outsider]);
    try {
      const initial = await request('/api/gamma-knife/settings'); assert.equal(initial.status, 200);
      const changed = { ...initial.body, users: initial.body.users.map((u: { id: number; permissions: string[] }) => Number(u.id) === outsider ? { ...u, permissions: ['access'] } : u) };
      assert.equal((await request('/api/gamma-knife/settings', changed, cookie, 'PUT')).status, 403);
      assert.equal((await request('/api/gamma-knife/settings', initial.body, cookie, 'PUT')).status, 200);
      assert.equal((await request('/api/gamma-knife/settings', initial.body, cookie, 'PUT')).status, 409);
    } finally { await pool.query("update users set role='doctor',gamma_knife_permissions='{}' where id=$1", [outsider]); }
    await pool.query("update users set gamma_knife_permissions='{access}' where id=$1", [outsider]);
    try {
      assert.equal((await request(`/api/gamma-knife/episodes/${episode.id}/actions/clinical`, { revision: episode.revision, clinical: answers }, createTestAuthCookie(outsider,'doctor'))).status, 403);
    } finally { await pool.query("update users set gamma_knife_permissions='{}' where id=$1", [outsider]); }
  });
  it('retains MDT accountability, deferred corrections, investigation requests and clinical return', async () => {
    const noConsultant = await request(`/api/gamma-knife/episodes/${episode.id}/actions/mdt`, { revision: episode.revision, decision: 'approved', consultants: [], assessment: 'MDT' }); assert.equal(noConsultant.status, 400);
    await command('mdt', { decision: 'deferred', consultants: ['External consultant'], assessment: 'Synthetic MDT', notes: 'Discussion' }); assert.equal(episode.status, 'mdt');
    await command('mdt', { decision: 'additional_information', consultants: ['External consultant'], assessment: 'Need additional information', investigations: 'Synthetic imaging request', reason: 'Updated discussion' }); assert.equal(episode.data.investigationsPending, true);
    await command('investigations', { reason: 'Synthetic investigation received' }); assert.equal(episode.data.assessmentStatus, 'draft');
    await command('submit', { clinical: answers, status: 'finalized' });
    await command('mdt', { decision: 'approved', consultants: ['Manual consultant, no account'], assessment: 'Synthetic approved assessment', reason: 'Information reviewed' }); assert.equal(episode.status, 'preparation');
  });
  it('validates separate existing calendar bookings, preparation, postponement, and confirmed completion', async () => {
    const treatmentBooking = await booking(fixture.examTypeId); const followupBooking = await booking(followupExam);
    const wrongPurpose = await request(`/api/gamma-knife/episodes/${episode.id}/actions/appointment`, { revision: episode.revision, purpose: 'treatment', bookingId: followupBooking }); assert.equal(wrongPurpose.status, 409);
    await command('appointment', { purpose: 'treatment', bookingId: treatmentBooking, confirmed: false });
    const notReady = await request(`/api/gamma-knife/episodes/${episode.id}/actions/preparation`, { revision: episode.revision, consent: false, imaging: true, clinicalReady: true, notes: 'Prepared', ready: true }); assert.equal(notReady.status, 409);
    await command('preparation', { consent: true, imaging: true, clinicalReady: true, notes: 'Synthetic preparation', ready: true, instructions: 'Patient-safe instructions' });
    await command('postpone', { reason: 'Synthetic postponement' }); assert.equal(episode.status, 'preparation'); assert.equal(episode.data.treatmentAppointment?.confirmed, false);
    await command('appointment', { purpose: 'treatment', bookingId: treatmentBooking, confirmed: true, reason: 'Rescheduled after review' });
    await command('preparation', { consent: true, imaging: true, clinicalReady: true, notes: 'Readiness rechecked', ready: true, instructions: 'Patient-safe instructions' });
    const qr = await changeEpisode(actor(), episode.id, 'qr_replace', { revision: episode.revision }); episode = qr.episode;
    assert.equal((await publicEpisode(qr.token!)).instructions, 'Patient-safe instructions');
    const unconfirmed = await request(`/api/gamma-knife/episodes/${episode.id}/actions/completion`, { revision: episode.revision, date: '2026-10-25', immobilization: 'frame', fractions: 1, team: ['Synthetic clinician'] }); assert.equal(unconfirmed.status, 409);
    await command('completion', { confirmed: true, date: '2026-10-25', immobilization: 'frame', fractions: 1, team: ['Synthetic clinician'] }); assert.equal(episode.status, 'followup'); assert.equal(episode.data.treatment?.finalized, false);
    assert.equal((await publicEpisode(qr.token!)).instructions, '');
    await command('appointment', { purpose: 'followup', bookingId: followupBooking, confirmed: true });
  });
  it('isolates stored documents from generic access and requires a report for finalization', async () => {
    const missingReport = await request(`/api/gamma-knife/episodes/${episode.id}/actions/report`, { revision: episode.revision, documentId: 99999999 }); assert.equal(missingReport.status, 400);
    const report = await upload('treatment_report'); await command('report', { documentId: report }); assert.equal(episode.data.treatment?.finalized, true);
    assert.equal((await request(`/api/documents/${report}/view`)).status, 404);
    assert.equal((await request(`/api/documents/${report}`, {}, cookie, 'DELETE')).status, 404);
    const listing = await request(`/api/documents?patientId=${fixture.patientId}`); assert.ok(!listing.body.documents.some((d: { id: number }) => Number(d.id) === report));
    await assert.rejects(() => getDocumentById(report));
    const denied = await request(`/api/gamma-knife/episodes/${episode.id}/documents/${report}`, undefined, createTestAuthCookie(outsider,'doctor')); assert.equal(denied.status, 403);
    await command('followup', { date: '2026-10-25', condition: 'Synthetic follow-up', imaging: 'Synthetic imaging', response: 'Recorded response', complications: '' }); assert.equal(episode.data.followups?.length, 1);
  });
  it('publishes only allowed routine documents and immediately invalidates replaced/revoked QR tokens', async () => {
    const instructions = await upload('patient_instructions', 'تعليمات-المريض.pdf'); const sensitive = documentIds[0]!;
    const stored = await getDocumentById(instructions, pool, { allowGammaKnife: true });
    assert.equal(stored.original_filename, 'تعليمات-المريض.pdf'); assert.doesNotMatch(stored.stored_path, /تعليمات/);
    await command('document_visibility', { documentId: instructions, released: true });
    const deniedRelease = await request(`/api/gamma-knife/episodes/${episode.id}/actions/document_visibility`, { revision: episode.revision, documentId: sensitive, released: true }); assert.equal(deniedRelease.status, 409);
    // Even a legacy release flag must not bypass the current sensitive category policy.
    await pool.query('update gamma_knife_documents set released=true where document_id=$1', [sensitive]);
    const issued = await changeEpisode(actor(), episode.id, 'qr_replace', { revision: episode.revision }); episode = issued.episode;
    const publicFetch = (token: string, path = '') => fetch(`${base}/api/public/gamma-knife${path}`, { headers: { Authorization: `Bearer ${token}` } });
    const response = await publicFetch(issued.token!); assert.equal(response.status, 200); assert.match(response.headers.get('cache-control')!, /no-store/); const view = await response.json();
    assert.equal(view.documents.length, 1); assert.equal(view.documents[0].id, instructions); assert.equal(view.documents[0].name, 'تعليمات-المريض.pdf'); assert.equal(view.sensitiveDocumentsAvailable, false); assert.equal(view.episodeId, undefined);
    for (const secret of ['Synthetic history','Synthetic assessment','Manual consultant','stored_path','patientId']) assert.ok(!JSON.stringify(view).includes(secret));
    assert.equal((await publicFetch(issued.token!, `/documents/${sensitive}`)).status, 404);
    assert.equal((await publicFetch(issued.token!, `/documents/${instructions}`)).status, 200);
    const replaced = await changeEpisode(actor(), episode.id, 'qr_replace', { revision: episode.revision }); episode = replaced.episode;
    assert.equal((await publicFetch(issued.token!)).status, 404);
    await command('qr_revoke'); assert.equal((await publicFetch(replaced.token!)).status, 404);
  });
  it('retains mandatory history when general audit is disabled, closes and preserves past episodes', async () => {
    const count = await pool.query('select count(*)::int as count from gamma_knife_history where episode_id=$1', [episode.id]); assert.equal(count.rows[0].count, episode.revision);
    const originalAudit = await pool.query("select setting_value from system_settings where category='audit_and_logging' and setting_key='audit_trail'");
    try {
      await pool.query("update system_settings set setting_value='{\"value\":\"disabled\"}'::jsonb where category='audit_and_logging' and setting_key='audit_trail'");
      await command('close', { reason: 'Synthetic follow-up completed' }); assert.equal(episode.active, false);
      const history = await pool.query('select count(*)::int as count from gamma_knife_history where episode_id=$1', [episode.id]); assert.equal(history.rows[0].count, episode.revision);
    } finally {
      await pool.query("update system_settings set setting_value=$1::jsonb where category='audit_and_logging' and setting_key='audit_trail'", [JSON.stringify(originalAudit.rows[0].setting_value)]);
    }
    let next = await createEpisode(actor(), { patientId: fixture.patientId, diagnosis: 'New synthetic episode', diagnosisCategory: previous.diagnoses[0]!.name }); episodeIds.push(next.id);
    next = (await changeEpisode(actor(), next.id, 'submit', { revision: next.revision, clinical: answers, status: 'finalized' })).episode;
    next = (await changeEpisode(actor(), next.id, 'mdt', { revision: next.revision, decision: 'not_suitable', consultants: ['External consultant'], assessment: 'Synthetic not suitable decision' })).episode;
    assert.equal(next.status, 'closed'); assert.equal(next.active, false);
    next = (await changeEpisode(actor(), next.id, 'mdt', { revision: next.revision, decision: 'deferred', consultants: ['External consultant'], assessment: 'Corrected synthetic decision', reason: 'Correction reviewed by MDT' })).episode;
    assert.equal(next.active, true); assert.equal(next.status, 'mdt');
    next = (await changeEpisode(actor(), next.id, 'mdt', { revision: next.revision, decision: 'not_suitable', consultants: ['External consultant'], assessment: 'Synthetic final decision', reason: 'Final MDT review' })).episode;
    const current = await createEpisode(actor(), { patientId: fixture.patientId, diagnosis: 'Current synthetic episode', diagnosisCategory: previous.diagnoses[0]!.name }); episodeIds.push(current.id);
    await assert.rejects(() => changeEpisode(actor(), next.id, 'mdt', { revision: next.revision, decision: 'deferred', consultants: ['External consultant'], assessment: 'Attempt reopening', reason: 'Must preserve one active episode' }), (error: unknown) => Boolean(error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 409));
    assert.equal((await findEpisode(episode.id)).status, 'closed');
    await assert.rejects(() => changeEpisode(actor(), episode.id, 'clinical', { revision: episode.revision, clinical: answers }));
    await pool.query('update users set gamma_knife_permissions=\'{}\' where id=$1', [fixture.userId]);
    assert.equal((await request('/api/gamma-knife/episodes')).status, 403);
  });
});
