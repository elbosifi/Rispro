import assert from 'node:assert/strict';
import { test } from 'node:test';
import { category, clinical, config, id } from './gamma-knife-validation.js';

test('clinical drafts allow missing fields; submitted assessments require every essential field', () => {
  assert.equal(clinical({}, false).history, '');
  const answers = { history: 'History', examination: 'Examination', imaging: 'MRI reviewed', assessment: 'Assessment', priorTreatmentUnavailable: true };
  assert.equal(clinical(answers, true).priorTreatmentUnavailable, true);
  for (const key of ['history','examination','imaging','assessment']) assert.throws(() => clinical({ ...answers, [key]: '' }, true));
  assert.throws(() => clinical({ ...answers, history: true }, true));
});
test('clinical assessments keep versioned diagnosis-specific details as documentation only', () => {
  const required = { history: 'History', examination: 'Examination', imaging: 'MRI review', assessment: 'Assessment', diagnosisDetails: '' };
  const cases = [
    ['Brain metastases', { lesions: [{ identifier: 'M1', location: 'Synthetic location', lengthMm: 8.2, widthMm: null, depthMm: null }] }, 'brain_metastases'],
    ['Vestibular schwannoma', { laterality: 'left', cpaIacDetails: 'Synthetic CPA/IAC finding', hearingAssessment: 'Synthetic hearing assessment', audiology: 'Synthetic audiology result' }, 'vestibular_schwannoma'],
    ['Pituitary / parasellar lesion', { opticApparatusRelationship: 'Synthetic optic apparatus relationship', additionalAssessment: 'Synthetic additional assessment' }, 'pituitary_parasellar'],
    ['Trigeminal neuralgia', { painHistory: 'Synthetic pain history', painAssessment: 'Synthetic pain assessment', priorTreatmentResponse: 'Synthetic response' }, 'trigeminal_neuralgia'],
  ] as const;
  for (const [categoryName, fields, diagnosis] of cases) {
    const result = clinical({ ...required, structuredDetails: fields }, true, categoryName);
    assert.equal(result.structuredDetails?.schemaVersion, 1);
    assert.equal(result.structuredDetails?.diagnosis, diagnosis);
  }
  assert.throws(() => clinical({ ...required, structuredDetails: { lesions: [{ identifier: 'same' }, { identifier: 'SAME' }] } }, true, 'Brain metastases'));
});
test('IDs and categories reject malformed or unsafe cross-boundary values', () => {
  assert.equal(id('42'), 42);
  for (const value of [0,-1,1.5,'no',true,[1],{},Number.MAX_SAFE_INTEGER+1]) assert.throws(() => id(value));
  assert.equal(category('treatment_report'), 'treatment_report');
  assert.throws(() => category('mdt_working_notes'));
});
test('settings validate fixed options and separate treatment/follow-up exam mappings', () => {
  const input = { revision: 1, diagnoses: [{ name: 'Other', checklist: ['Referral'] }], consultants: ['Consultant'], documentVisibility: { referral: 'internal', investigation: 'sensitive', consent: 'internal', treatment_report: 'sensitive', patient_instructions: 'routine', other: 'internal' }, reminderDays: 14, treatmentExamTypeId: 1, followupExamTypeId: 2, qrEnabled: true, diagnosisDetailsEnabled: true };
  assert.equal(config(input).qrEnabled, true);
  assert.throws(() => config({ ...input, followupExamTypeId: 1 }));
  assert.throws(() => config({ ...input, reminderDays: -1 }));
  assert.throws(() => config({ ...input, diagnoses: [input.diagnoses[0], input.diagnoses[0]] }));
  assert.throws(() => config({ ...input, documentVisibility: {} }));
});
