import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import bcrypt from 'bcryptjs';
import express from 'express';
import cookieParser from 'cookie-parser';
import { createServer, type Server } from 'node:http';
import { pool } from '../../db/pool.js';
import { errorHandler } from '../../middleware/error-handler.js';
import { requireAuth, restrictGammaKnifeOnlyAccount } from '../../middleware/auth.js';
import { authRouter } from '../../routes/auth.js';
import { gammaKnifeRouter } from './gamma-knife-routes.js';
import { createEpisode } from './gamma-knife-service.js';
import { readConfig, findEpisode } from './gamma-knife-service.js';
import { seedTestData, cleanupTestData, type TestData } from '../appointments-v2/tests/integration/helpers.js';
import { randomUUID } from 'node:crypto';

const prefix = `gkonly_${randomUUID().replaceAll('-', '').slice(0, 8)}_`;
let fixture: TestData;
let actorId = 0;
let mdtActorId = 0;
let episodeId = 0;
let examTypeId = 0;
let bookingId = 0;
let server: Server;
let base = '';
let cookie = '';
let mdtCookie = '';
const permissions = ['access', 'referral', 'clinical'] as const;

async function call(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { Cookie: cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) as Record<string, any> : null };
}

describe('Gamma Knife-only account boundary', { concurrency: false }, () => {
  before(async () => {
    const database = await pool.query<{ name: string }>('select current_database() as name');
    assert.match(database.rows[0]!.name, /test|e2e/i);
    fixture = await seedTestData('appointments_v2', prefix);
    const hash = await bcrypt.hash('Synthetic GK clinician 2026!', 4);
    const user = await pool.query<{ id: number }>(
      `insert into users(username,password_hash,full_name,role,is_active,gamma_knife_only,gamma_knife_permissions)
       values($1,$2,'Synthetic Neurosurgeon','doctor',true,true,$3::text[]) returning id`,
      [`${prefix}neurosurgeon`, hash, permissions]
    );
    actorId = Number(user.rows[0]!.id);
    const mdtHash = await bcrypt.hash('Synthetic MDT clinician 2026!', 4);
    const mdtUser = await pool.query<{ id: number }>(
      `insert into users(username,password_hash,full_name,role,is_active,gamma_knife_only,gamma_knife_permissions)
       values($1,$2,'Synthetic MDT Clinician','doctor',true,true,array['access','mdt']::text[]) returning id`,
      [`${prefix}mdt`, mdtHash]
    );
    mdtActorId = Number(mdtUser.rows[0]!.id);
    const exam = await pool.query<{ id: number }>(
      "insert into exam_types(modality_id,name_ar,name_en,code,is_active) values($1,'اختبار عام','General test',$2,true) returning id",
      [fixture.modalityId, `${prefix}GEN`]
    );
    examTypeId = Number(exam.rows[0]!.id);
    const booking = await pool.query<{ id: number }>(
      `insert into appointments_v2.bookings(patient_id,modality_id,exam_type_id,booking_date,booking_time,case_category,requires_report,status,policy_version_id,capacity_resolution_mode,uses_special_quota,is_walk_in,created_by_user_id)
       values($1,$2,$3,'2045-05-12','09:00','non_oncology',false,'scheduled',$4,'standard',false,false,$5) returning id`,
      [fixture.patientId, fixture.modalityId, examTypeId, fixture.policyVersionId, fixture.userId]
    );
    bookingId = Number(booking.rows[0]!.id);

    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api', restrictGammaKnifeOnlyAccount);
    app.use('/api/auth', authRouter);
    app.use('/api/gamma-knife', gammaKnifeRouter);
    app.get('/api/doctor/me', requireAuth, (_req, res) => res.json({ reachable: true }));
    app.get('/api/core-data', requireAuth, (_req, res) => res.json({ reachable: true }));
    app.post('/api/medical-dictation/test', requireAuth, (_req, res) => res.status(204).end());
    app.use(errorHandler);
    server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server failed to start.');
    base = `http://127.0.0.1:${address.port}`;
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: `${prefix}neurosurgeon`, password: 'Synthetic GK clinician 2026!' })
    });
    assert.equal(login.status, 200);
    const setCookie = login.headers.get('set-cookie');
    assert.ok(setCookie, 'login should set the existing RISpro session cookie');
    cookie = setCookie.split(';', 1)[0]!;
    const mdtLogin = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: `${prefix}mdt`, password: 'Synthetic MDT clinician 2026!' })
    });
    assert.equal(mdtLogin.status, 200);
    mdtCookie = mdtLogin.headers.get('set-cookie')!.split(';', 1)[0]!;
    const loggedIn = await login.json() as { user: { gammaKnifeOnly: boolean } };
    assert.equal(loggedIn.user.gammaKnifeOnly, true);
  });

  after(async () => {
    if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (episodeId) {
      await pool.query('delete from gamma_knife_investigation_history where investigation_id in (select id from gamma_knife_investigations where episode_id=$1)', [episodeId]);
      await pool.query('delete from gamma_knife_investigations where episode_id=$1', [episodeId]);
      await pool.query('delete from gamma_knife_history where episode_id=$1', [episodeId]);
      await pool.query('delete from gamma_knife_episodes where id=$1', [episodeId]);
    }
    if (bookingId) await pool.query('delete from appointments_v2.bookings where id=$1', [bookingId]);
    if (examTypeId) await pool.query('delete from exam_types where id=$1', [examTypeId]);
    // This synthetic clinician authored audit entries during the test. Remove only
    // those disposable-test-database rows before deleting its FK-referenced account.
    if (actorId) await pool.query('delete from audit_log where changed_by_user_id=$1', [actorId]);
    if (actorId) await pool.query('delete from users where id=$1', [actorId]);
    if (mdtActorId) await pool.query('delete from audit_log where changed_by_user_id=$1', [mdtActorId]);
    if (mdtActorId) await pool.query('delete from users where id=$1', [mdtActorId]);
    if (fixture) await cleanupTestData(prefix);
    await pool.end();
  });

  it('logs in with the normal account, permits assigned Gamma Knife and dictation, and blocks Core APIs', async () => {
    const session = await call('/api/auth/me');
    assert.equal(session.status, 200);
    assert.equal(session.body!.user.gammaKnifeOnly, true);
    const identity = await call('/api/gamma-knife/me');
    assert.equal(identity.status, 200);
    assert.deepEqual(identity.body!.permissions, permissions);
    assert.equal((await call('/api/doctor/me')).status, 403);
    assert.equal((await call('/api/core-data')).status, 403);
    assert.equal((await call('/api/medical-dictation/test', 'POST')).status, 204);

    const config = await readConfig();
    const created = await call('/api/gamma-knife/episodes', 'POST', {
      patientId: fixture.patientId,
      diagnosis: 'Synthetic access-boundary referral',
      diagnosisCategory: config.diagnoses[0]!.name
    });
    assert.equal(created.status, 201);
    episodeId = Number(created.body!.episode.id);
    const episode = await findEpisode(episodeId);
    const deniedMdt = await call(`/api/gamma-knife/episodes/${episodeId}/actions/mdt`, 'POST', {
      revision: episode.revision, decision: 'approved', consultants: ['Synthetic consultant'], assessment: 'Synthetic'
    });
    assert.equal(deniedMdt.status, 403);
    const profile = await call(`/api/gamma-knife/episodes/${episodeId}`);
    assert.equal(profile.status, 200);
    assert.ok(!profile.body!.appointments.some((appointment: { id: number }) => Number(appointment.id) === bookingId));
    assert.deepEqual(profile.body!.documents, [], 'document names are not exposed without documents permission');

    const current = await fetch(`${base}/api/gamma-knife/episodes/${episodeId}`, { headers: { Cookie: mdtCookie } });
    const mdtProfile = await current.json() as { episode: { revision: number } };
    const request = await fetch(`${base}/api/gamma-knife/episodes/${episodeId}/investigations`, {
      method: 'POST', headers: { Cookie: mdtCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: mdtProfile.episode.revision, requestedText: 'Synthetic MRI review task' })
    });
    assert.equal(request.status, 201, 'MDT permission can create an investigation task');
    const requestBody = await request.json() as { investigation: { id: number } };
    const afterRequest = await fetch(`${base}/api/gamma-knife/episodes/${episodeId}`, { headers: { Cookie: mdtCookie } });
    const afterRequestBody = await afterRequest.json() as { episode: { revision: number } };
    const receipt = await fetch(`${base}/api/gamma-knife/episodes/${episodeId}/investigations/${requestBody.investigation.id}`, {
      method: 'PATCH', headers: { Cookie: mdtCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: afterRequestBody.episode.revision, action: 'receive', receivedNote: 'Synthetic receipt without attached document.' })
    });
    assert.equal(receipt.status, 200, 'MDT permission can record task receipt without documents permission');
    const latestResponse = await fetch(`${base}/api/gamma-knife/episodes/${episodeId}`, { headers: { Cookie: mdtCookie } });
    const latestProfile = await latestResponse.json() as { episode: { revision: number } };
    const deniedEvidence = await fetch(`${base}/api/gamma-knife/episodes/${episodeId}/investigations/${requestBody.investigation.id}`, {
      method: 'PATCH', headers: { Cookie: mdtCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: latestProfile.episode.revision, action: 'receive', receivedNote: 'Synthetic receipt.', evidenceDocumentId: 1 })
    });
    assert.equal(deniedEvidence.status, 403, 'linking evidence still requires documents permission');
  });

  it('allows logout through the established authentication route', async () => {
    const response = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { Cookie: cookie } });
    assert.equal(response.status, 204);
  });
});
