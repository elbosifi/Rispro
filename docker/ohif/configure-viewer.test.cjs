const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getStudiesForPatientByMRN, diagnosticSeriesRules } = require('./configure-viewer.cjs');
const { protectBootstrapHtml } = require('./verify-browser-build.cjs');

test('all bootstrap scripts opt out of CDN script rewriting before src without changing their load order',()=>{
  const html='<script>window.x=1;</script><script src="app-config.js"></script><script type="module" src="init-service-worker.js"></script><script defer src="app.bundle.hash.js"></script>';
  const protectedHtml=protectBootstrapHtml(html);
  assert.equal((protectedHtml.match(/data-cfasync="false"/g)||[]).length,4);
  assert.equal(protectedHtml.replaceAll(' data-cfasync="false"',''),html);
  assert.equal(protectBootstrapHtml(protectedHtml),protectedHtml);
});

test('study browser queries only explicit study selectors and reuses the primary QIDO result', async () => {
  const calls=[];
  const current={studyInstanceUid:'1.2.3',mrn:'SYNTHETIC'};
  const source={getConfig:()=>({risproStudyInstanceUIDs:['1.2.3','1.2.4','1.2.5']}),query:{studies:{search:async query=>{calls.push(query);return [{studyInstanceUid:query.studyInstanceUid}];}}}};
  const result=await getStudiesForPatientByMRN(source,[current]);
  assert.deepEqual(calls,[{studyInstanceUid:'1.2.4'},{studyInstanceUid:'1.2.5'}]);
  assert.equal(result[0],current);
  assert.deepEqual(result.map(s=>s.studyInstanceUid),['1.2.3','1.2.4','1.2.5']);
});
test('an unauthorized selector failure remains visible and never falls back to patient-wide search', async () => {
  const denied=Error('Synthetic exact-study denial');let calls=0;
  const source={getConfig:()=>({risproStudyInstanceUIDs:['9.9.9']}),query:{studies:{search:async query=>{calls++;assert.deepEqual(query,{studyInstanceUid:'9.9.9'});throw denied;}}}};
  await assert.rejects(getStudiesForPatientByMRN(source,[{studyInstanceUid:'1.2.3'}]),error=>error===denied);
  assert.equal(calls,1);
});
test('empty results and non-RISpro data sources retain the pinned discovery behavior', async () => {
  assert.deepEqual(await getStudiesForPatientByMRN({},[]),[]);
  const source={getConfig:()=>({}),query:{studies:{search:async query=>query}}};
  assert.deepEqual(await getStudiesForPatientByMRN(source,[{mrn:'SYNTHETIC'}]),{patientId:'SYNTHETIC',disableWildcard:true});
});
test('diagnostic preferences favor a multi-image CT/MRI over single-page documents and preserve explicit selection', () => {
  const preference=ds=>diagnosticSeriesRules.reduce((score,rule)=>score+(rule.constraint.equals?ds[rule.attribute]===rule.constraint.equals.value:ds[rule.attribute]>rule.constraint.greaterThan.value)*rule.weight,0);
  const documents={Modality:'OT',numImageFrames:1};
  assert.ok(preference({Modality:'MR',numImageFrames:800})>preference(documents));
  assert.ok(preference({Modality:'CT',numImageFrames:400})>preference(documents));
  assert.ok(preference({Modality:'MR',numImageFrames:800,SOPClassUID:'1.2.840.10008.5.1.4.1.1.4'})>preference({Modality:'MR',numImageFrames:20,SOPClassUID:'1.2.840.10008.5.1.4.1.1.7'}));
  assert.ok(preference({Modality:'MR',numImageFrames:4,SOPClassUID:'1.2.840.10008.5.1.4.1.1.4.1'})>preference(documents));
  assert.ok(preference(documents)+20>preference({Modality:'MR',numImageFrames:800}));
  assert.equal(diagnosticSeriesRules.some(rule=>rule.required),false);
});
