import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createReportStore} from './src/report-store.js';
const initial={id:1,revision:1,status:'draft',sections:{clinicalHistory:'',comparison:'',technique:'',findings:'',impression:''},keyImages:[]};
function fixture(handler) {
  const calls=[];
  const store=createReportStore({contextId:'context',captureViewport:()=>{throw Error('Capture must use the real browser adapter');},locateSource:()=>{},fetcher:async(url,options)=>{
    const body=options.body?JSON.parse(options.body):null;calls.push({url,body});
    if(url.includes('/contexts/'))return Response.json({appointmentId:1,canEdit:true,canFinalize:true,enabled:true,report:structuredClone(initial)});
    return handler(url,body,calls);
  }});
  return {store,calls};
}
test('serialized saves preserve text typed during an in-flight save',async()=>{
  let release,started;
  const pending=new Promise(r=>started=r);
  const {store,calls}=fixture(async(url,body)=>{
    if(body.expectedRevision===1){started();await new Promise(r=>release=r);}
    return Response.json({...initial,revision:body.expectedRevision+1,sections:body.sections});
  });
  await store.load();store.edit('findings','first');const save=store.save();await pending;
  store.edit('findings','newer pasted text');release();await save;
  assert.equal(store.getSnapshot().text.findings,'newer pasted text');assert.equal(store.getSnapshot().dirty,false);
  assert.deepEqual(calls.filter(c=>c.body?.expectedRevision).map(c=>c.body.expectedRevision),[1,2]);store.destroy();
});
test('failed save keeps unsaved clinical text in memory and explicit retry persists it',async()=>{
  let fail=true;
  const {store}=fixture(async(url,body)=>fail?Response.json({error:{message:'Storage unavailable'}},{status:503}):Response.json({...initial,revision:2,sections:body.sections}));
  await store.load();store.edit('findings','retain me');await assert.rejects(store.save,/Storage unavailable/);
  assert.equal(store.getSnapshot().text.findings,'retain me');assert.equal(store.getSnapshot().dirty,true);assert.equal(store.hasUnsaved(),true);
  fail=false;await store.save();assert.equal(store.getSnapshot().dirty,false);store.destroy();
});
test('conflict retains text and prevents automatic overwrite or finalization',async()=>{
  const {store,calls}=fixture(async()=>Response.json({error:{message:'Another editor changed this report'}},{status:409}));
  await store.load();store.edit('impression','my unsaved conclusion');await assert.rejects(store.save,/Another editor/);
  await assert.rejects(()=>store.finalize('request'),/resolve this conflict/);
  assert.equal(store.getSnapshot().text.impression,'my unsaved conclusion');assert.equal(calls.some(c=>c.url.endsWith('/finalize')),false);store.destroy();
});
test('finalization waits for acknowledged autosave and uses its returned revision',async()=>{
  const {store,calls}=fixture(async(url,body)=>Response.json(url.endsWith('/finalize')?{...initial,revision:3,status:'final'}:{...initial,revision:2,sections:body.sections}));
  await store.load();store.edit('impression','saved before signing');await store.finalize('same-retry-id');
  const writes=calls.filter(c=>c.body?.expectedRevision);assert.deepEqual(writes.map(c=>c.body.expectedRevision),[1,2]);assert.equal(writes[1].body.requestId,'same-retry-id');store.destroy();
});

test('signing an addendum does not erase new text entered while its request is pending',async()=>{
  let release,started;const pending=new Promise(r=>started=r);
  const {store,calls}=fixture(async()=>{started();await new Promise(r=>release=r);return Response.json({...initial,status:'final'});});
  await store.load();store.editAddendum('first signed correction');const signing=store.addendum('first signed correction','retry-id');await pending;
  store.editAddendum('next unsaved correction');release();await signing;
  assert.equal(calls.at(-1).body.text,'first signed correction');
  assert.equal(store.getSnapshot().addendumText,'next unsaved correction');assert.equal(store.hasUnsaved(),true);store.destroy();
});
