import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { pool } from '../../db/pool.js';
import { seedTestData, cleanupTestData, type TestData } from '../appointments-v2/tests/integration/helpers.js';
import { addPostClosureCorrection, changeTreatmentCourse, createEpisode, createTreatmentCourse, decidePatientIdentityCorrection, editReferral, findEpisode, markEpisodeEnteredInError, operationsDashboard, readConfig, requestPatientIdentityCorrection, reverseEpisodeClosure, updateEpisodePatientContact, withdrawEpisode } from './gamma-knife-service.js';
import { deletePatient, mergePatients } from '../../services/patient-service.js';
import { PERMISSIONS, type Config, type Episode } from './gamma-knife-types.js';
import type { Role } from '../../types/domain.js';

const prefix = `gkcorrection_${Date.now().toString(36)}_`;
let fixtures: TestData[] = [];
let config: Config;
const episodeIds: number[] = [];
const actor = (fixture: TestData) => ({ sub: fixture.userId, role: 'supervisor' as const });
const actorAs = (fixture: TestData, role: Role) => ({ sub: fixture.userId, role });

describe('Gamma Knife operational corrections and cancelled-course replacement', { concurrency: false }, () => {
  before(async () => {
    const db = await pool.query<{ name: string }>('select current_database() as name');
    assert.match(db.rows[0]!.name, /test|e2e/i);
    config = await readConfig();
    for (const suffix of ['edit', 'replacement', 'withdraw', 'course', 'merge_target', 'merge_source', 'blocked_merge', 'treated_merge', 'delete', 'treated_merge_target', 'attribution_source', 'attribution_target', 'entry_error', 'operations']) {
      const fixture = await seedTestData('appointments_v2', `${prefix}${suffix}_`);
      fixtures.push(fixture);
      await pool.query('update users set gamma_knife_permissions=$2::text[] where id=$1', [fixture.userId, PERMISSIONS]);
    }
  });

  after(async () => {
    if (episodeIds.length) {
      await pool.query('delete from gamma_knife_patient_identity_correction_requests where episode_id=any($1::bigint[])', [episodeIds]);
      await pool.query('delete from gamma_knife_post_closure_corrections where episode_id=any($1::bigint[])', [episodeIds]);
      await pool.query('delete from gamma_knife_patient_attribution_corrections where episode_id=any($1::bigint[])', [episodeIds]);
      await pool.query('delete from gamma_knife_treatment_history where course_id in (select id from gamma_knife_treatment_courses where episode_id=any($1::bigint[]))', [episodeIds]);
      await pool.query('delete from gamma_knife_treatment_fractions where course_id in (select id from gamma_knife_treatment_courses where episode_id=any($1::bigint[]))', [episodeIds]);
      await pool.query('update gamma_knife_treatment_courses set prior_course_id=null,reassessment_id=null where episode_id=any($1::bigint[])', [episodeIds]);
      await pool.query('delete from gamma_knife_treatment_courses where episode_id=any($1::bigint[])', [episodeIds]);
      await pool.query('delete from gamma_knife_readiness_items where episode_id=any($1::bigint[])', [episodeIds]);
      await pool.query('delete from gamma_knife_patient_communications where episode_id=any($1::bigint[])', [episodeIds]);
      await pool.query('delete from gamma_knife_operation_task_assignments where episode_id=any($1::bigint[])', [episodeIds]);
      await pool.query('delete from gamma_knife_history where episode_id=any($1::bigint[])', [episodeIds]);
      await pool.query('update gamma_knife_episodes set replacement_episode_id=null where id=any($1::bigint[])', [episodeIds]);
      await pool.query('delete from gamma_knife_episodes where id=any($1::bigint[])', [episodeIds]);
    }
    for (const suffix of ['operations', 'entry_error', 'attribution_target', 'attribution_source', 'treated_merge_target', 'delete', 'treated_merge', 'blocked_merge', 'merge_source', 'merge_target', 'course', 'withdraw', 'replacement', 'edit']) await cleanupTestData(`${prefix}${suffix}_`);
    await pool.end();
  });

  it('corrects a referral with stale-revision checks and retains the earlier clinical assessment and MDT', async () => {
    const fixture = fixtures[0]!;
    let episode = await createEpisode(actor(fixture), { patientId: fixture.patientId, diagnosis: 'Initial synthetic diagnosis', diagnosisCategory: config.diagnoses[0]!.name, referralDetails: 'Initial referral details' });
    episodeIds.push(episode.id);
    const data = { ...episode.data, clinical: { history: 'Preserved clinical history', examination: 'Preserved examination', imaging: 'Preserved MRI', assessment: 'Preserved assessment', priorTreatment: '', diagnosisDetails: '' }, assessmentStatus: 'finalized' as const, mdt: { decision: 'approved' as const, consultants: ['Synthetic consultant'], assessment: 'Prior approved decision', notes: '', investigations: '', assessmentRevision: 1 } };
    await pool.query("update gamma_knife_episodes set data=$2::jsonb,revision=revision+1 where id=$1", [episode.id, JSON.stringify(data)]);
    episode = await findEpisode(episode.id);
    const oldRevision = episode.revision;
    const changed = await editReferral(actor(fixture), episode.id, { revision: oldRevision, diagnosis: 'Corrected synthetic diagnosis', diagnosisCategory: config.diagnoses[1]!.name, details: 'Corrected referral details', administrativeNotes: 'Corrected administrative note', source: 'External clinic', referringPhysician: 'Synthetic referrer', reason: 'The registration form contained the wrong provisional category.' });
    episode = changed.episode;
    assert.equal(episode.diagnosis, 'Corrected synthetic diagnosis');
    assert.equal(episode.diagnosisCategory, config.diagnoses[1]!.name);
    assert.equal(episode.data.clinical?.assessment, 'Preserved assessment');
    assert.equal(episode.data.mdt?.assessment, 'Prior approved decision');
    assert.equal(episode.data.referralReviewRequired, true);
    assert.equal(episode.data.mdtReviewRequired, true);
    await assert.rejects(() => editReferral(actor(fixture), episode.id, { revision: oldRevision, diagnosis: 'Stale value', diagnosisCategory: config.diagnoses[0]!.name, reason: 'Stale revision test.' }), (error: unknown) => Boolean(error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 409));
  });

  it('marks an incorrect registration in error, links an identifier-confirmed replacement, and blocks unsafe reversal', async () => {
    const originalFixture = fixtures[12]!;
    let original = await createEpisode(actor(originalFixture), { patientId: originalFixture.patientId, diagnosis: 'Synthetic incorrect referral', diagnosisCategory: config.diagnoses[0]!.name });
    episodeIds.push(original.id);
    await pool.query('update gamma_knife_episodes set qr_hash=$2 where id=$1', [original.id, `synthetic-qr-token-hash-${original.id}`]);
    original = await findEpisode(original.id);
    const closed = await markEpisodeEnteredInError(actor(originalFixture), original.id, { revision: original.revision, confirmed: true, reason: 'The original registration selected the wrong patient record.' });
    original = closed.episode;
    assert.equal(original.active, false);
    assert.equal(original.closureClassification, 'entered_in_error');
    assert.equal(original.qrActive, false);
    const correctFixture = fixtures[1]!;
    const patient = await pool.query<{ mrn: string; arabic_full_name: string; english_full_name: string | null }>('select mrn,arabic_full_name,english_full_name from patients where id=$1', [correctFixture.patientId]);
    const selected = patient.rows[0]!;
    await assert.rejects(() => createEpisode(actor(correctFixture), { patientId: correctFixture.patientId, diagnosis: 'Corrected synthetic diagnosis', diagnosisCategory: config.diagnoses[0]!.name, replacementForEpisodeId: original.id, confirmationPatientMrn: selected.mrn, confirmationPatientName: 'Wrong synthetic name' }));
    const replacement = await createEpisode(actor(correctFixture), { patientId: correctFixture.patientId, diagnosis: 'Corrected synthetic diagnosis', diagnosisCategory: config.diagnoses[0]!.name, replacementForEpisodeId: original.id, confirmationPatientMrn: selected.mrn, confirmationPatientName: selected.english_full_name ?? selected.arabic_full_name });
    episodeIds.push(replacement.id);
    original = await findEpisode(original.id);
    assert.equal(original.replacementEpisodeId, replacement.id);
    await assert.rejects(() => reverseEpisodeClosure(actor(originalFixture), original.id, { revision: original.revision, reason: 'Attempt to reopen after replacement.' }), (error: unknown) => Boolean(error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 409));
  });

  it('withdraws a genuine referral and permits an audited administrator reversal when no replacement exists', async () => {
    const fixture = fixtures[2]!;
    let episode = await createEpisode(actor(fixture), { patientId: fixture.patientId, diagnosis: 'Synthetic genuine referral', diagnosisCategory: config.diagnoses[0]!.name });
    episodeIds.push(episode.id);
    episode = (await withdrawEpisode(actor(fixture), episode.id, { revision: episode.revision, confirmed: true, reason: 'The patient transferred care to another provider.' })).episode;
    assert.equal(episode.closureClassification, 'withdrawn');
    episode = (await reverseEpisodeClosure(actor(fixture), episode.id, { revision: episode.revision, reason: 'The transfer cancellation was entered for the wrong referral.' })).episode;
    assert.equal(episode.active, true);
    assert.equal(episode.status, 'referrals');
    assert.equal(episode.closureClassification, null);
    assert.equal((await pool.query("select count(*)::int as count from gamma_knife_history where episode_id=$1 and action in ('referral_withdrawn','episode_closure_reversed')", [episode.id])).rows[0]!.count, 2);
  });

  it('serves paginated live operations queues and includes actionable referral work', async () => {
    const fixture = fixtures[13]!;
    const episode = await createEpisode(actor(fixture), { patientId: fixture.patientId, diagnosis: 'Synthetic operations queue diagnosis', diagnosisCategory: config.diagnoses[0]!.name });
    episodeIds.push(episode.id);
    const dashboard = await operationsDashboard(actor(fixture), { limit: 100, offset: 0 });
    assert.equal(dashboard.pagination.limit, 100);
    assert.equal(dashboard.pagination.offset, 0);
    assert.equal(dashboard.queues.awaitingAction.some(row => row.episodeId === episode.id && row.taskKey === 'clinical_assessment'), true);
    assert.equal(typeof dashboard.counts.scheduledToday, 'number');
    assert.equal(typeof dashboard.counts.pendingCorrectionRequests, 'number');
  });

  it('replaces a cancelled undelivered first course as a new numbered course and retains the cancelled plan', async () => {
    const fixture = fixtures[3]!;
    let episode = await createEpisode(actor(fixture), { patientId: fixture.patientId, diagnosis: 'Synthetic treatment diagnosis', diagnosisCategory: config.diagnoses[0]!.name });
    episodeIds.push(episode.id);
    const approved = { ...episode.data, assessmentStatus: 'finalized' as const, mdt: { decision: 'approved' as const, consultants: ['Synthetic consultant'], assessment: 'Existing MDT approval', notes: '', investigations: '', assessmentRevision: 1 }, preparation: { consent: true, imaging: true, clinicalReady: true, notes: 'Synthetic preparation', instructions: '', actions: '', ready: true } };
    await pool.query("update gamma_knife_episodes set status='preparation',data=$2::jsonb,revision=revision+1 where id=$1", [episode.id, JSON.stringify(approved)]);
    await pool.query("update gamma_knife_readiness_items set status='completed',completed_at=now(),completed_by_user_id=$2,updated_by_user_id=$2 where episode_id=$1", [episode.id, fixture.userId]);
    episode = await findEpisode(episode.id);
    const first = await createTreatmentCourse(actor(fixture), episode.id, { revision: episode.revision, immobilization: 'frame', plannedFractionCount: 1, gammaPlanReference: 'GP-SYNTHETIC-ORIGINAL' });
    episode = first.episode;
    const cancelled = await changeTreatmentCourse(actor(fixture), episode.id, first.course.id, 'cancel', { revision: episode.revision, reason: 'The planned target reference was incorrect.' });
    episode = cancelled.episode;
    const replacement = await createTreatmentCourse(actor(fixture), episode.id, { revision: episode.revision, immobilization: 'mask', plannedFractionCount: 1, gammaPlanReference: 'GP-SYNTHETIC-CORRECTED' });
    assert.equal(Number(replacement.course.course_number), 2);
    const rows = await pool.query<{ status: string; course_number: number }>('select status,course_number from gamma_knife_treatment_courses where episode_id=$1 order by course_number', [episode.id]);
    assert.deepEqual(rows.rows.map(row => [row.course_number, row.status]), [[1, 'cancelled'], [2, 'planned']]);
    assert.equal((await pool.query("select count(*)::int as count from gamma_knife_treatment_history where course_id=$1 and action='course_replacement_created'", [replacement.course.id])).rows[0]!.count, 1);
  });

  it('corrects contact details with the patient audit, routes sensitive identity changes for review, and appends a post-closure addendum', async () => {
    const fixture = fixtures[4]!;
    let episode = await createEpisode(actor(fixture), { patientId: fixture.patientId, diagnosis: 'Synthetic demographic referral', diagnosisCategory: config.diagnoses[0]!.name });
    episodeIds.push(episode.id);
    episode = (await updateEpisodePatientContact(actor(fixture), episode.id, { revision: episode.revision, phone1: '0912345678', phone2: '0923456789', address: 'Corrected synthetic address', reason: 'Patient confirmed corrected contact details.' })).episode;
    const patient = await pool.query<{ phone_1: string; address: string }>('select phone_1,address from patients where id=$1', [fixture.patientId]);
    assert.equal(patient.rows[0]!.phone_1, '0912345678');
    assert.equal(patient.rows[0]!.address, 'Corrected synthetic address');
    assert.equal((await pool.query("select count(*)::int as count from audit_log where entity_type='patient' and entity_id=$1 and action_type='contact_details_update'", [fixture.patientId])).rows[0]!.count > 0, true);
    const request = await requestPatientIdentityCorrection(actor(fixture), episode.id, { revision: episode.revision, requestedFields: { englishFullName: 'Corrected Name (Synthetic)' }, reason: 'Identity spelling needs authorized review.' });
    episode = request.episode;
    const decided = await decidePatientIdentityCorrection(actor(fixture), episode.id, request.request.id, { revision: episode.revision, decision: 'approved', reason: 'Identity documents were reviewed.' });
    assert.equal(decided.request.status, 'approved');
    const patientAfterApproval = await pool.query<{ english_full_name: string }>('select english_full_name from patients where id=$1', [fixture.patientId]);
    assert.notEqual(patientAfterApproval.rows[0]!.english_full_name, 'Corrected Name (Synthetic)');
    episode = (await withdrawEpisode(actor(fixture), episode.id, { revision: decided.episode.revision, confirmed: true, reason: 'Synthetic referral was transferred.' })).episode;
    await addPostClosureCorrection(actor(fixture), episode.id, { revision: episode.revision, kind: 'clinical_addendum', affectedRecord: 'clinical assessment #1', reason: 'Add missing source context.', previousContent: { assessment: 'Prior assessment' }, correctedContent: { addendum: 'Additional context from the source note.' } });
    assert.equal((await pool.query("select count(*)::int as count from gamma_knife_post_closure_corrections where episode_id=$1", [episode.id])).rows[0]!.count, 1);
  });

  it('blocks patient deletion when Gamma Knife history exists', async () => {
    const fixture = fixtures[8]!;
    const episode = await createEpisode(actor(fixture), { patientId: fixture.patientId, diagnosis: 'Synthetic delete guard', diagnosisCategory: config.diagnoses[0]!.name });
    episodeIds.push(episode.id);
    await assert.rejects(() => deletePatient(fixture.patientId, fixture.userId), (error: unknown) => Boolean(error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 409 && String((error as { message?: string }).message).includes('Gamma Knife episode history')));
    assert.equal((await pool.query('select count(*)::int as count from patients where id=$1', [fixture.patientId])).rows[0]!.count, 1);
  });

  it('requires elevated wrong-patient correction for treated records and links a confirmed replacement without reassigning history', async () => {
    const source = fixtures[10]!;
    const corrected = fixtures[11]!;
    let episode = await createEpisode(actor(source), { patientId: source.patientId, diagnosis: 'Synthetic wrong-patient attribution', diagnosisCategory: config.diagnoses[0]!.name });
    episodeIds.push(episode.id);
    await pool.query(`insert into gamma_knife_treatment_courses(episode_id,course_number,immobilization,planned_fraction_count,status,completion_confirmed,completion_reason,completed_at,completed_by,created_by)
      values($1,1,'frame',1,'completed',true,'Synthetic completed course',current_date,$2,$2)`, [episode.id, source.userId]);
    episode = await findEpisode(episode.id);
    const patient = await pool.query<{ mrn: string; arabic_full_name: string; english_full_name: string | null }>('select mrn,arabic_full_name,english_full_name from patients where id=$1', [corrected.patientId]);
    const selected = patient.rows[0]!;
    await assert.rejects(() => markEpisodeEnteredInError(actorAs(source, 'receptionist'), episode.id, { revision: episode.revision, confirmed: true, correctedPatientId: corrected.patientId, confirmationPatientMrn: selected.mrn, confirmationPatientName: selected.english_full_name ?? selected.arabic_full_name, reason: 'Coordinator lacks authority to close treated records.' }), (error: unknown) => Boolean(error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 403));
    episode = (await markEpisodeEnteredInError(actor(source), episode.id, { revision: episode.revision, confirmed: true, correctedPatientId: corrected.patientId, confirmationPatientMrn: selected.mrn, confirmationPatientName: selected.english_full_name ?? selected.arabic_full_name, reason: 'A treatment episode was registered to the wrong patient; preserve attribution and route a corrected referral.' })).episode;
    assert.equal(episode.active, false);
    assert.equal(episode.patientId, source.patientId);
    const correction = await pool.query<{ original_patient_id: number; corrected_patient_id: number }>('select original_patient_id,corrected_patient_id from gamma_knife_patient_attribution_corrections where episode_id=$1', [episode.id]);
    assert.equal(Number(correction.rows[0]!.original_patient_id), source.patientId);
    assert.equal(Number(correction.rows[0]!.corrected_patient_id), corrected.patientId);
    assert.equal((await pool.query("select count(*)::int as count from gamma_knife_treatment_courses where episode_id=$1 and status='completed'", [episode.id])).rows[0]!.count, 1);
    const replacement = await createEpisode(actor(corrected), { patientId: corrected.patientId, diagnosis: 'Synthetic corrected attribution referral', diagnosisCategory: config.diagnoses[0]!.name, replacementForEpisodeId: episode.id, confirmationPatientMrn: selected.mrn, confirmationPatientName: selected.english_full_name ?? selected.arabic_full_name });
    episodeIds.push(replacement.id);
    assert.equal((await findEpisode(episode.id)).replacementEpisodeId, replacement.id);
  });

  it('merges closed non-treated episode history and correction requests onto the surviving patient', async () => {
    const target = fixtures[4]!;
    const source = fixtures[5]!;
    let episode = await createEpisode(actor(source), { patientId: source.patientId, diagnosis: 'Synthetic closed duplicate', diagnosisCategory: config.diagnoses[0]!.name });
    episodeIds.push(episode.id);
    episode = (await withdrawEpisode(actor(source), episode.id, { revision: episode.revision, confirmed: true, reason: 'Synthetic duplicate referral resolved.' })).episode;
    const request = await requestPatientIdentityCorrection(actor(source), episode.id, { revision: episode.revision, requestedFields: { englishFullName: 'Reviewed after merge' }, reason: 'Verify the merged identity.' });
    await mergePatients({ targetPatientId: target.patientId, sourcePatientId: source.patientId, confirmationText: 'MERGE' }, target.userId);
    const linkedEpisode = await pool.query<{ patient_id: number }>('select patient_id from gamma_knife_episodes where id=$1', [episode.id]);
    const linkedRequest = await pool.query<{ patient_id: number }>('select patient_id from gamma_knife_patient_identity_correction_requests where id=$1', [request.request.id]);
    assert.equal(Number(linkedEpisode.rows[0]!.patient_id), target.patientId);
    assert.equal(Number(linkedRequest.rows[0]!.patient_id), target.patientId);
    assert.equal((await pool.query('select count(*)::int as count from gamma_knife_history where episode_id=$1', [episode.id])).rows[0]!.count > 0, true);
  });

  it('blocks merges for active and treated Gamma Knife episodes', async () => {
    const active = fixtures[6]!;
    const activeEpisode = await createEpisode(actor(active), { patientId: active.patientId, diagnosis: 'Synthetic active merge guard', diagnosisCategory: config.diagnoses[0]!.name });
    episodeIds.push(activeEpisode.id);
    await assert.rejects(() => mergePatients({ targetPatientId: fixtures[7]!.patientId, sourcePatientId: active.patientId, confirmationText: 'MERGE' }, fixtures[7]!.userId), (error: unknown) => Boolean(error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 409));

    const treated = fixtures[7]!;
    const treatedEpisode = await createEpisode(actor(treated), { patientId: treated.patientId, diagnosis: 'Synthetic treated merge guard', diagnosisCategory: config.diagnoses[0]!.name });
    episodeIds.push(treatedEpisode.id);
    await pool.query(`insert into gamma_knife_treatment_courses(episode_id,course_number,immobilization,planned_fraction_count,status,completion_confirmed,completion_reason,completed_at,completed_by,created_by)
      values($1,1,'frame',1,'completed',true,'Synthetic completed course',current_date,$2,$2)`, [treatedEpisode.id, treated.userId]);
    await assert.rejects(() => markEpisodeEnteredInError(actor(treated), treatedEpisode.id, { revision: treatedEpisode.revision, confirmed: true, reason: 'A test must not conceal completed treatment.' }), (error: unknown) => Boolean(error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 409));
    await pool.query("update gamma_knife_episodes set active=false,status='closed',revision=revision+1 where id=$1", [treatedEpisode.id]);
    await assert.rejects(() => mergePatients({ targetPatientId: fixtures[9]!.patientId, sourcePatientId: treated.patientId, confirmationText: 'MERGE' }, fixtures[9]!.userId), (error: unknown) => Boolean(error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 409));
  });
});
