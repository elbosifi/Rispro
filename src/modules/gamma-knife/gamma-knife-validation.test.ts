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
