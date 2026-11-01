import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ageAtExamination,finalizeDisabledReasons} from './src/report-presentation.js';
test('age uses verified DOB and examination date, including the birthday boundary',()=>{
  assert.equal(ageAtExamination('1980-11-02','20261101'),45);
  assert.equal(ageAtExamination('19801102','2026-11-02'),46);
  for(const [dob,date] of [[null,'20261101'],['19801102',null],['20230229','20261101'],['20261102','20261101'],['1980','20261101']])assert.equal(ageAtExamination(dob,date),null);
});
test('selected report eligibility replaces stale launch eligibility, with all local blockers explained',()=>{
  assert.deepEqual(finalizeDisabledReasons({context:{canFinalize:false},report:{canFinalize:true}}),[]);
  assert.deepEqual(finalizeDisabledReasons({context:{canFinalize:true},report:{canFinalize:false,finalizeReasons:['Independent review required.']}}),['Independent review required.']);
  const reasons=finalizeDisabledReasons({report:{canFinalize:true},busy:true,conflict:true,pendingCapture:{}}).join(' ');
  assert.match(reasons,/conflict/);assert.match(reasons,/operation/);assert.match(reasons,/key-image/);
});
