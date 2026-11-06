import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { pool } from '../../db/pool.js';
import { seedTestData, cleanupTestData, type TestData } from '../appointments-v2/tests/integration/helpers.js';
import { addPostClosureCorrection, assignOperationalTask, changeEpisode, changeTreatmentCourse, completePatientIdentityCorrection, createEpisode, createReadinessItem, createTreatmentCourse, decidePatientIdentityCorrection, editReferral, findEpisode, markEpisodeEnteredInError, operationsDashboard, readConfig, reconcileEpisodeAppointment, requestPatientIdentityCorrection, reverseEpisodeClosure, updateEpisodePatientContact, updateReadinessItem, withdrawEpisode } from './gamma-knife-service.js';
import { deletePatient, mergePatients, updatePatient } from '../../services/patient-service.js';
import { cancelBooking } from '../appointments-v2/booking/services/cancel-booking.service.js';
import { PERMISSIONS, type Config, type Episode } from './gamma-knife-types.js';
import type { Role } from '../../types/domain.js';

const prefix = `gkcorrection_${Date.now().toString(36)}_`;
let fixtures: TestData[] = [];
let config: Config;
const episodeIds: number[] = [];
const bookingIds: number[] = [];
const actor = (fixture: TestData) => ({ sub: fixture.userId, role: 'supervisor' as const });
const actorAs = (fixture: TestData, role: Role) => ({ sub: fixture.userId, role });

describe('Gamma Knife operational corrections and cancelled-course replacement', { concurrency: false }, () => {
  before(async () => {
    const db = await pool.query<{ name: string }>('select current_database() as name');
    assert.match(db.rows[0]!.name, /test|e2e/i);
    config = await readConfig();
    for (const suffix of ['edit', 'replacement', 'withdraw', 'course', 'merge_target', 'merge_source', 'blocked_merge', 'treated_merge', 'delete', 'treated_merge_target', 'attribution_source', 'attribution_target', 'entry_error', 'operations', 'readiness', 'attribution_merge_source', 'attribution_merge_target', 'appointment_withdrawal', 'appointment_error', 'appointment_postpone', 'stale_booking']) {
      const fixture = await seedTestData('appointments_v2', `${prefix}${suffix}_`);
      fixtures.push(fixture);
      await pool.query('update users set gamma_knife_permissions=$2::text[] where id=$1', [fixture.userId, PERMISSIONS]);
    }
  });

  after(async () => {
    if (bookingIds.length) await pool.query('delete from appointments_v2.bookings where id=any($1::bigint[])', [bookingIds]);
    const fixtureUserIds = fixtures.map(fixture => fixture.userId);
    if (fixtureUserIds.length) await pool.query('update patient_identifiers set created_by_user_id=null,updated_by_user_id=null where created_by_user_id=any($1::bigint[]) or updated_by_user_id=any($1::bigint[])', [fixtureUserIds]);
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
    for (const suffix of ['stale_booking', 'appointment_postpone', 'appointment_error', 'appointment_withdrawal', 'attribution_merge_target', 'attribution_merge_source', 'readiness', 'operations', 'entry_error', 'attribution_target', 'attribution_source', 'treated_merge_target', 'delete', 'treated_merge', 'blocked_merge', 'merge_source', 'merge_target', 'course', 'withdraw', 'replacement', 'edit']) await cleanupTestData(`${prefix}${suffix}_`);
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

  it('reconciles withdrawal, entered-in-error, and postponement bookings through Appointments V2 with stale-version protection', async () => {
    const createBooking = async (fixture: TestData, dateValue = '2045-05-12') => {
      const result = await pool.query<{ id: number }>(`insert into appointments_v2.bookings(patient_id,modality_id,exam_type_id,booking_date,booking_time,case_category,requires_report,status,policy_version_id,capacity_resolution_mode,uses_special_quota,is_walk_in,created_by_user_id)
        values($1,$2,$3,$4,'09:00','non_oncology',false,'scheduled',$5,'standard',false,false,$6) returning id`, [fixture.patientId, fixture.modalityId, fixture.examTypeId, dateValue, fixture.policyVersionId, fixture.userId]);
      const id = Number(result.rows[0]!.id); bookingIds.push(id); return id;
    };
    const withdrawalFixture = fixtures[17]!;
    let withdrawn = await createEpisode(actor(withdrawalFixture), { patientId: withdrawalFixture.patientId, diagnosis: 'Synthetic booking withdrawal', diagnosisCategory: config.diagnoses[0]!.name });
    episodeIds.push(withdrawn.id);
    const withdrawalBookingId = await createBooking(withdrawalFixture);
    await pool.query("update gamma_knife_episodes set data=jsonb_set(data,'{treatmentAppointment}',$2::jsonb,true),revision=revision+1 where id=$1", [withdrawn.id, JSON.stringify({ bookingId: withdrawalBookingId, confirmed: true })]);
    withdrawn = await findEpisode(withdrawn.id);
    await pool.query("update users set gamma_knife_permissions=array_remove(gamma_knife_permissions,'scheduling') where id=$1", [withdrawalFixture.userId]);
    const withdrawal = await withdrawEpisode(actor(withdrawalFixture), withdrawn.id, { revision: withdrawn.revision, confirmed: true, reason: 'The patient transferred to another service.' });
    assert.equal(withdrawal.reconciliationRequired, true);
    assert.equal((await pool.query<{ status: string }>('select status from appointments_v2.bookings where id=$1', [withdrawalBookingId])).rows[0]!.status, 'scheduled');
    assert.equal((await pool.query<{ status: string }>("select status from gamma_knife_operation_task_assignments where episode_id=$1 and task_key=$2", [withdrawn.id, `appointment_reconciliation:${withdrawalBookingId}`])).rows[0]!.status, 'open');
    await pool.query('update users set gamma_knife_permissions=$2::text[] where id=$1', [withdrawalFixture.userId, PERMISSIONS]);
    const reconciled = await reconcileEpisodeAppointment(actor(withdrawalFixture), withdrawn.id, withdrawalBookingId, { revision: withdrawal.episode.revision, reason: 'Scheduling reviewed and cancelled the booking.' });
    assert.equal(reconciled.reconciliationRequired, false);
    assert.equal((await pool.query<{ status: string }>('select status from appointments_v2.bookings where id=$1', [withdrawalBookingId])).rows[0]!.status, 'cancelled');
    assert.equal((await pool.query<{ status: string }>("select status from gamma_knife_operation_task_assignments where episode_id=$1 and task_key=$2", [withdrawn.id, `appointment_reconciliation:${withdrawalBookingId}`])).rows[0]!.status, 'resolved');

    const errorFixture = fixtures[18]!;
    let enteredInError = await createEpisode(actor(errorFixture), { patientId: errorFixture.patientId, diagnosis: 'Synthetic entered-in-error booking', diagnosisCategory: config.diagnoses[0]!.name });
    episodeIds.push(enteredInError.id);
    const errorBookingId = await createBooking(errorFixture);
    await pool.query("update gamma_knife_episodes set data=jsonb_set(data,'{treatmentAppointment}',$2::jsonb,true),revision=revision+1 where id=$1", [enteredInError.id, JSON.stringify({ bookingId: errorBookingId, confirmed: true })]);
    enteredInError = await findEpisode(enteredInError.id);
    const errorResult = await markEpisodeEnteredInError(actor(errorFixture), enteredInError.id, { revision: enteredInError.revision, confirmed: true, reason: 'This registration selected the wrong patient.' });
    assert.equal(errorResult.reconciliationRequired, false);
    assert.equal((await pool.query<{ status: string }>('select status from appointments_v2.bookings where id=$1', [errorBookingId])).rows[0]!.status, 'cancelled');

    const postponeFixture = fixtures[19]!;
    let postponed = await createEpisode(actor(postponeFixture), { patientId: postponeFixture.patientId, diagnosis: 'Synthetic postponement booking', diagnosisCategory: config.diagnoses[0]!.name });
    episodeIds.push(postponed.id);
    const postponeBookingId = await createBooking(postponeFixture);
    await pool.query("update gamma_knife_episodes set status='treatment',data=jsonb_set(data,'{treatmentAppointment}',$2::jsonb,true),revision=revision+1 where id=$1", [postponed.id, JSON.stringify({ bookingId: postponeBookingId, confirmed: true })]);
    postponed = await findEpisode(postponed.id);
    const postponeResult = await changeEpisode(actor(postponeFixture), postponed.id, 'postpone', { revision: postponed.revision, reason: 'The patient asked to postpone treatment.' });
    assert.equal(postponeResult.episode.status, 'treatment');
    assert.equal(postponeResult.reconciliationRequired, false);
    assert.equal((await pool.query<{ status: string }>('select status from appointments_v2.bookings where id=$1', [postponeBookingId])).rows[0]!.status, 'cancelled');

    const staleFixture = fixtures[20]!;
    const staleBookingId = await createBooking(staleFixture);
    const originalVersion = (await pool.query<{ updated_at: string }>('select updated_at::text from appointments_v2.bookings where id=$1', [staleBookingId])).rows[0]!.updated_at;
    await pool.query("update appointments_v2.bookings set updated_at=updated_at+interval '1 second' where id=$1", [staleBookingId]);
    await assert.rejects(() => cancelBooking(staleBookingId, staleFixture.userId, undefined, originalVersion), (error: unknown) => Boolean(error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 409));
    assert.equal((await pool.query<{ status: string }>('select status from appointments_v2.bookings where id=$1', [staleBookingId])).rows[0]!.status, 'scheduled');
  });

  it('persists task assignments across each operations queue and applies server filters and queue pagination', async () => {
    const fixture = fixtures[13]!;
    let episode = await createEpisode(actor(fixture), { patientId: fixture.patientId, diagnosis: 'Synthetic operations queue diagnosis', diagnosisCategory: config.diagnoses[0]!.name });
    episodeIds.push(episode.id);
    const today = (await pool.query<{ date: string }>("select (now() at time zone 'Africa/Tripoli')::date::text as date")).rows[0]!.date;
    const nextDayDate = new Date(`${today}T12:00:00Z`); nextDayDate.setUTCDate(nextDayDate.getUTCDate() + 1); const tomorrow = nextDayDate.toISOString().slice(0,10);
    const booking = await pool.query<{ id: number }>(`insert into appointments_v2.bookings(patient_id,modality_id,exam_type_id,booking_date,booking_time,case_category,requires_report,status,policy_version_id,capacity_resolution_mode,uses_special_quota,is_walk_in,created_by_user_id)
      values($1,$2,$3,$4,'09:00','non_oncology',false,'scheduled',$5,'standard',false,false,$6) returning id`, [fixture.patientId, fixture.modalityId, fixture.examTypeId, today, fixture.policyVersionId, fixture.userId]);
    const bookingId = Number(booking.rows[0]!.id); bookingIds.push(bookingId);
    await pool.query("update gamma_knife_episodes set status='treatment',data=jsonb_set(data,'{treatmentAppointment}',$2::jsonb,true),revision=revision+1 where id=$1", [episode.id, JSON.stringify({ bookingId, confirmed: false })]);
    episode = await findEpisode(episode.id);
    episode = (await assignOperationalTask(actor(fixture), episode.id, { revision: episode.revision, taskKey: 'treatment', ownerUserId: fixture.userId, dueDate: today, priority: 'urgent', status: 'in_progress' })).episode;
    let dashboard = await operationsDashboard(actor(fixture), { limit: 100, offsets: { todayTreatments: 0 } });
    assert.equal(dashboard.queues.todayTreatments.some(row => row.episodeId === episode.id && row.ownerUserId === fixture.userId && row.priority === 'urgent' && row.dueDate === today && row.assignmentStatus === 'in_progress'), true, JSON.stringify({ today, episodeId: episode.id, rows: dashboard.queues.todayTreatments.filter(row => row.episodeId === episode.id) }));
    await pool.query('update appointments_v2.bookings set booking_date=$2 where id=$1', [bookingId, tomorrow]);
    episode = (await assignOperationalTask(actor(fixture), episode.id, { revision: episode.revision, taskKey: 'upcoming_treatment', ownerUserId: fixture.userId, dueDate: tomorrow, priority: 'high', status: 'open' })).episode;
    dashboard = await operationsDashboard(actor(fixture), { limit: 100, offsets: { upcomingTreatments: 0 } });
    assert.equal(dashboard.queues.upcomingTreatments.some(row => row.episodeId === episode.id && row.ownerUserId === fixture.userId && row.priority === 'high' && row.dueDate === tomorrow), true);
    await pool.query("update gamma_knife_episodes set status='followup',data=jsonb_set(data,'{followupAppointment}',$2::jsonb,true),revision=revision+1 where id=$1", [episode.id, JSON.stringify({ bookingId, confirmed: true })]);
    episode = await findEpisode(episode.id);
    episode = (await assignOperationalTask(actor(fixture), episode.id, { revision: episode.revision, taskKey: 'followup', ownerUserId: fixture.userId, dueDate: tomorrow, priority: 'normal', status: 'in_progress' })).episode;
    dashboard = await operationsDashboard(actor(fixture), { limit: 100, offsets: { followUp: 0 }, responsibleUserId: fixture.userId, status: 'in_progress' });
    assert.equal(dashboard.queues.followUp.some(row => row.episodeId === episode.id && row.taskKey === 'followup_booking' && row.ownerUserId === fixture.userId && row.priority === 'normal' && row.dueDate === tomorrow), true);
    await pool.query("update gamma_knife_episodes set status='referrals',revision=revision+1 where id=$1", [episode.id]);
    episode = await findEpisode(episode.id);
    episode = (await assignOperationalTask(actor(fixture), episode.id, { revision: episode.revision, taskKey: 'clinical_assessment', ownerUserId: fixture.userId, dueDate: today, priority: 'urgent', status: 'open' })).episode;
    dashboard = await operationsDashboard(actor(fixture), { limit: 100, offsets: { awaitingAction: 0 }, responsibleUserId: fixture.userId, priority: 'urgent' });
    assert.equal(dashboard.pagination.awaitingAction.limit, 100);
    assert.equal(dashboard.pagination.awaitingAction.offset, 0);
    assert.equal(dashboard.pagination.awaitingAction.total > 0, true);
    assert.equal(dashboard.queues.awaitingAction.some(row => row.episodeId === episode.id && row.taskKey === 'clinical_assessment' && row.ownerUserId === fixture.userId && row.dueDate === today), true);
    await pool.query("update gamma_knife_episodes set data=jsonb_set(data,'{appointmentReconciliation}',$2::jsonb,true),revision=revision+1 where id=$1", [episode.id, JSON.stringify([{ purpose: 'treatment', bookingId, status: 'required', reason: 'Synthetic appointment exception.' }])]);
    episode = await findEpisode(episode.id);
    episode = (await assignOperationalTask(actor(fixture), episode.id, { revision: episode.revision, taskKey: `appointment_reconciliation:${bookingId}`, ownerUserId: fixture.userId, dueDate: today, priority: 'urgent', status: 'open' })).episode;
    dashboard = await operationsDashboard(actor(fixture), { limit: 100, offsets: { exceptions: 0 }, responsibleUserId: fixture.userId, status: 'open' });
    assert.equal(dashboard.queues.exceptions.some(row => row.episodeId === episode.id && row.taskKey === `appointment_reconciliation:${bookingId}` && row.ownerUserId === fixture.userId && row.priority === 'urgent'), true);
    assert.equal(typeof dashboard.counts.scheduledToday, 'number');
    assert.equal(typeof dashboard.counts.pendingCorrectionRequests, 'number');
  });

  it('keeps checklist changes in the current episode stage through preparation, treatment, follow-up, and closure', async () => {
    const fixture = fixtures[14]!;
    let episode = await createEpisode(actor(fixture), { patientId: fixture.patientId, diagnosis: 'Synthetic checklist state test', diagnosisCategory: config.diagnoses[0]!.name });
    episodeIds.push(episode.id);
    await pool.query("update gamma_knife_episodes set status='preparation',data=jsonb_set(data,'{preparation}', '{\"ready\":true}'::jsonb,true),revision=revision+1 where id=$1", [episode.id]);
    episode = await findEpisode(episode.id);
    const created = await createReadinessItem(actor(fixture), episode.id, { revision: episode.revision, label: 'Synthetic checklist item', required: true, reason: 'Add a required preparation check.' });
    episode = created.episode;
    assert.equal(episode.status, 'preparation');
    const item = await pool.query<{ id: number }>('select id from gamma_knife_readiness_items where episode_id=$1 and item_key like \'custom_%\' order by id desc limit 1', [episode.id]);
    const updateItem = async (status: 'pending'|'in_progress'|'completed', reason: string) => {
      const result = await updateReadinessItem(actor(fixture), episode.id, item.rows[0]!.id, { revision: episode.revision, status, required: true, responsibleUserId: null, dueDate: null, priority: 'normal', notes: '', reason });
      episode = result.episode;
      return result;
    };
    await updateItem('completed', 'Complete the preparation check.');
    await updateItem('pending', 'Reopen the check during preparation.');
    assert.equal(episode.status, 'preparation');
    await pool.query("update gamma_knife_episodes set status='treatment',revision=revision+1 where id=$1", [episode.id]);
    episode = await findEpisode(episode.id);
    await updateItem('in_progress', 'Review the checklist during treatment.');
    await updateItem('pending', 'Reopen the checklist during treatment.');
    assert.equal(episode.status, 'treatment');
    await pool.query("update gamma_knife_episodes set status='followup',revision=revision+1 where id=$1", [episode.id]);
    episode = await findEpisode(episode.id);
    await updateItem('completed', 'Complete the checklist during follow-up.');
    await updateItem('pending', 'Reopen the checklist during follow-up.');
    assert.equal(episode.status, 'followup');
    await pool.query("update gamma_knife_episodes set status='closed',active=false,closure_classification='completed',revision=revision+1 where id=$1", [episode.id]);
    episode = await findEpisode(episode.id);
    await assert.rejects(() => updateReadinessItem(actor(fixture), episode.id, item.rows[0]!.id, { revision: episode.revision, status: 'completed', required: true, responsibleUserId: null, dueDate: null, priority: 'normal', notes: '', reason: 'Should be rejected after closure.' }), (error: unknown) => Boolean(error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 409));
    assert.equal((await pool.query("select count(*)::int as count from gamma_knife_history where episode_id=$1 and action in ('readiness_item_created','readiness_item_updated')", [episode.id])).rows[0]!.count, 7);
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
    const validSyntheticNationalId = String(800_000_000_000 + fixture.patientId).padStart(12, '0');
    await pool.query("update patients set national_id=$2::text,identifier_value=$2::text,identifier_type='national_id' where id=$1", [fixture.patientId, validSyntheticNationalId]);
    episode = (await updateEpisodePatientContact(actor(fixture), episode.id, { revision: episode.revision, phone1: '0912345678', phone2: '0923456789', address: 'Corrected synthetic address', reason: 'Patient confirmed corrected contact details.' })).episode;
    const patient = await pool.query<{ phone_1: string; address: string }>('select phone_1,address from patients where id=$1', [fixture.patientId]);
    assert.equal(patient.rows[0]!.phone_1, '0912345678');
    assert.equal(patient.rows[0]!.address, 'Corrected synthetic address');
    assert.equal((await pool.query("select count(*)::int as count from audit_log where entity_type='patient' and entity_id=$1 and action_type='contact_details_update'", [fixture.patientId])).rows[0]!.count > 0, true);
    const request = await requestPatientIdentityCorrection(actor(fixture), episode.id, { revision: episode.revision, requestedFields: { englishFullName: 'Corrected Synthetic Name' }, reason: 'Identity spelling needs authorized review.' });
    episode = request.episode;
    const decided = await decidePatientIdentityCorrection(actor(fixture), episode.id, request.request.id, { revision: episode.revision, decision: 'approved', reason: 'Identity documents were reviewed.' });
    assert.equal(decided.request.status, 'approved');
    const patientAfterApproval = await pool.query<{ english_full_name: string }>('select english_full_name from patients where id=$1', [fixture.patientId]);
    assert.notEqual(patientAfterApproval.rows[0]!.english_full_name, 'Corrected Synthetic Name');
    const identityBeforeCoreUpdate = await pool.query<{ national_id: string; identifier_type: string; identifier_value: string; arabic_full_name: string; english_full_name: string | null; phone_1: string | null; phone_2: string | null; address: string | null; category: string | null }>('select national_id,identifier_type,identifier_value,arabic_full_name,english_full_name,phone_1,phone_2,address,category from patients where id=$1', [fixture.patientId]);
    const currentIdentity = identityBeforeCoreUpdate.rows[0]!;
    await updatePatient(fixture.patientId, { nationalId: currentIdentity.national_id, nationalIdConfirmation: currentIdentity.national_id, identifierType: currentIdentity.identifier_type, identifierValue: currentIdentity.identifier_value, arabicFullName: currentIdentity.arabic_full_name, englishFullName: 'Corrected Synthetic Name', ageYears: 30, demographicsEstimated: true, estimatedDateOfBirth: '1996-01-01', sex: 'M', phone1: currentIdentity.phone_1, phone2: currentIdentity.phone_2, address: currentIdentity.address, category: currentIdentity.category ?? 'non_oncology' }, fixture.userId);
    const completedHandoff = await completePatientIdentityCorrection(actor(fixture), episode.id, request.request.id, { revision: decided.episode.revision, reason: 'Verified the authorized Core patient edit.' });
    assert.equal(completedHandoff.request.patientUpdateCompletedByUserId, fixture.userId);
    assert.ok(completedHandoff.request.patientUpdateCompletedAt);
    episode = completedHandoff.episode;
    await pool.query("update gamma_knife_episodes set data=jsonb_set(data,'{clinical}', '{\"history\":\"Synthetic history\",\"examination\":\"Synthetic examination\",\"imaging\":\"Synthetic imaging\",\"assessment\":\"Prior assessment\",\"priorTreatment\":\"\",\"diagnosisDetails\":\"\"}'::jsonb,true),revision=revision+1 where id=$1", [episode.id]);
    episode = await findEpisode(episode.id);
    episode = (await withdrawEpisode(actor(fixture), episode.id, { revision: episode.revision, confirmed: true, reason: 'Synthetic referral was transferred.' })).episode;
    await addPostClosureCorrection(actor(fixture), episode.id, { revision: episode.revision, kind: 'clinical_addendum', affectedRecord: 'clinical_assessment', reason: 'Add missing source context.', content: 'Additional context from the source note.', previousContent: { forged: 'caller supplied content is ignored' }, correctedContent: { forged: true } });
    const correction = await pool.query<{ previous_content: Record<string, unknown>; corrected_content: Record<string, unknown> }>('select previous_content,corrected_content from gamma_knife_post_closure_corrections where episode_id=$1', [episode.id]);
    assert.equal(correction.rows[0]!.previous_content.assessment, 'Prior assessment');
    assert.deepEqual(correction.rows[0]!.corrected_content, { addendum: 'Additional context from the source note.' });
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

  it('preserves wrong-patient attribution snapshots while merging a closed untreated duplicate', async () => {
    const source = fixtures[15]!;
    const target = fixtures[16]!;
    let episode = await createEpisode(actor(source), { patientId: source.patientId, diagnosis: 'Synthetic attributed referral', diagnosisCategory: config.diagnoses[0]!.name });
    episodeIds.push(episode.id);
    await pool.query("update gamma_knife_episodes set data=jsonb_set(data,'{clinical}', '{\"history\":\"Reviewed synthetic history\",\"examination\":\"\",\"imaging\":\"\",\"assessment\":\"\",\"priorTreatment\":\"\",\"diagnosisDetails\":\"\"}'::jsonb,true),revision=revision+1 where id=$1", [episode.id]);
    episode = await findEpisode(episode.id);
    const patient = await pool.query<{ mrn: string; arabic_full_name: string; english_full_name: string | null }>('select mrn,arabic_full_name,english_full_name from patients where id=$1', [target.patientId]);
    const selected = patient.rows[0]!;
    episode = (await markEpisodeEnteredInError(actor(source), episode.id, { revision: episode.revision, confirmed: true, correctedPatientId: target.patientId, confirmationPatientMrn: selected.mrn, confirmationPatientName: selected.english_full_name ?? selected.arabic_full_name, reason: 'Synthetic early referral selected the wrong patient.' })).episode;
    const beforeMerge = await pool.query<{ id: number; original_patient_id: number | null; corrected_patient_id: number | null; original_patient_snapshot: Record<string, unknown>; corrected_patient_snapshot: Record<string, unknown> }>('select id,original_patient_id,corrected_patient_id,original_patient_snapshot,corrected_patient_snapshot from gamma_knife_patient_attribution_corrections where episode_id=$1', [episode.id]);
    const correction = beforeMerge.rows[0]!;
    assert.equal(Number(correction.original_patient_id), source.patientId);
    await mergePatients({ targetPatientId: target.patientId, sourcePatientId: source.patientId, confirmationText: 'MERGE' }, target.userId);
    const afterMerge = await pool.query<{ original_patient_id: number | null; corrected_patient_id: number | null; original_patient_snapshot: Record<string, unknown>; corrected_patient_snapshot: Record<string, unknown> }>('select original_patient_id,corrected_patient_id,original_patient_snapshot,corrected_patient_snapshot from gamma_knife_patient_attribution_corrections where id=$1', [correction.id]);
    const preserved = afterMerge.rows[0]!;
    assert.equal(preserved.original_patient_id, null);
    assert.equal(Number(preserved.corrected_patient_id), target.patientId);
    assert.equal(Number(preserved.original_patient_snapshot.patientId), source.patientId);
    assert.equal(Number(preserved.corrected_patient_snapshot.patientId), target.patientId);
    assert.equal(Number((await findEpisode(episode.id)).patientId), target.patientId);
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
