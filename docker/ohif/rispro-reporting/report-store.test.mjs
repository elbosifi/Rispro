import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createReportStore} from './src/report-store.js';
import {setTimeout as delay} from 'node:timers/promises';
const initial={id:1,revision:1,status:'draft',sections:{clinicalHistory:'',comparison:'',technique:'',findings:'',impression:''},keyImages:[]};
test('dictation cancels scheduled autosave and remains unsaved through subsequent typing until explicit Save',async()=>{
  const {store,calls}=fixture(async(url,body)=>Response.json({...initial,revision:2,sections:body.sections}));
  await store.load();store.edit('findings','typed');store.edit('findings','typed dictated',{dictated:true});
  store.edit('impression','later typing');await delay(1100);
  assert.equal(calls.length,1);assert.equal(store.getSnapshot().dirty,true);
  await store.save();assert.equal(calls.length,2);assert.equal(store.getSnapshot().dirty,false);store.destroy();
});
function fixture(handler) {
  const calls=[];
  let saved=structuredClone(initial);
  const store=createReportStore({contextId:'context',captureViewport:()=>{throw Error('Capture must use the real browser adapter');},locateSource:()=>{},fetcher:async(url,options)=>{
    const body=options.body?JSON.parse(options.body):null;calls.push({url,body});
    if(url.includes('/contexts/'))return Response.json({appointmentId:1,canEdit:true,canFinalize:true,enabled:true,report:structuredClone(initial)});
    if(options.method==='GET')return Response.json(saved);
    const result=await handler(url,body,calls);
    if(result.ok)saved=await result.clone().json();
    return result;
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

test('V2 selects shared backend reports, flushes the old report before selection, and signs the selected ID',async()=>{
  const calls=[],first={...initial,id:42,canEdit:true,canFinalize:true},second={...initial,id:43,canEdit:true,canFinalize:true};
  const store=createReportStore({contextId:'verified-context',captureViewport:()=>{},locateSource:()=>{},fetcher:async(url,options)=>{
    const body=options.body?JSON.parse(options.body):null;calls.push({url,body});
    if(url.includes('/contexts/'))return Response.json({v2:true,appointmentId:null,studyKey:'study',signerUserId:7,canEdit:true,canFinalize:true,report:first,reports:[first,second]});
    if(url.endsWith('/draft'))return Response.json({...first,revision:2,sections:body.sections});
    if(url.endsWith('/finalize'))return Response.json({...second,revision:2,status:'final'});
    return Response.json(second);
  }});
  await store.load();assert.equal(calls.length,1);
  store.edit('findings','saved on first report');await store.selectReport(43);
  assert.equal(calls[1].url,'/api/native-reporting/reports/42/draft');assert.equal(calls[2].url,'/api/native-reporting/reports/43');
  await store.finalize();assert.equal(calls.at(-1).url,'/api/native-reporting/reports/43/finalize');assert.equal(calls.at(-1).body.signerUserId,7);
  assert.equal(calls.some(c=>c.url.includes('/appointments/')),false);store.destroy();
});

function recoveryFixture() {
  let saved={...structuredClone(initial),canEdit:true,canFinalize:true},mode='ok',writes=0,uploads=0,lastCapture;
  const store=createReportStore({contextId:'tab',captureViewport:async()=>({blob:new Blob(['capture']),provenance:{studyInstanceUid:'1.2.3'}}),locateSource:()=>{},fetcher:async(url,options)=>{
    if(url.includes('/contexts/'))return Response.json({v2:true,report:saved,canEdit:saved.canEdit,canFinalize:saved.canFinalize});
    if(options.method==='GET')return Response.json(saved);
    if(url.endsWith('/images') && options.method==='POST'){
      uploads++;const capture=JSON.parse(decodeURIComponent(options.headers['X-RISpro-Capture']));
      if(lastCapture)assert.deepEqual(capture,lastCapture);lastCapture=capture;
      if(mode==='offline')throw new TypeError('Network error');
      saved={...saved,keyImages:[{id:1,caption:'',requestId:capture.requestId}]};
      if(mode==='lost-upload')throw new TypeError('Upload response lost');
      return Response.json(saved);
    }
    const body=JSON.parse(options.body);writes++;
    if(mode==='offline')throw new TypeError('Network error');
    if(mode==='auth')return Response.json({error:{message:'Expired',details:{code:'AUTH_EXPIRED'}}},{status:401});
    if(saved.revision!==body.expectedRevision)return Response.json({error:{message:'Conflict'}},{status:409});
    saved={...saved,...(body.sections?{sections:body.sections}:{}),...(body.images?{keyImages:body.images}:{}),revision:saved.revision+1};
    if(mode==='lost')throw new TypeError('Response lost');
    return Response.json(saved);
  }});
  return {store,get writes(){return writes;},get uploads(){return uploads;},set mode(value){mode=value;},change(report){saved={...saved,...report};},get saved(){return saved;}};
}
test('network recovery retains text, captions and addendum and resumes typed autosave',async()=>{
  const f=recoveryFixture();await f.store.load();f.mode='offline';f.store.edit('findings','retained');f.store.editCaption(4,'caption');f.store.editAddendum('unsigned');
  await assert.rejects(f.store.save);f.mode='ok';await f.store.recover();await delay(1100);
  assert.equal(f.saved.sections.findings,'retained');assert.equal(f.store.getSnapshot().captionEdits[4],'caption');assert.equal(f.store.getSnapshot().addendumText,'unsigned');f.store.destroy();
});
test('an acknowledged server commit with lost response is reconciled without a second write',async()=>{
  const f=recoveryFixture();await f.store.load();f.mode='lost';f.store.edit('findings','accepted snapshot');await assert.rejects(f.store.save);
  assert.equal(f.store.getSnapshot().dirty,true);f.mode='ok';await f.store.recover();await f.store.save();
  assert.equal(f.writes,1);assert.equal(f.store.getSnapshot().dirty,false);assert.equal(f.store.getSnapshot().text.findings,'accepted snapshot');f.store.destroy();
});
test('response loss plus newer local typing saves only the newer text at the reconciled revision',async()=>{
  const f=recoveryFixture();await f.store.load();f.mode='lost';f.store.edit('findings','first');await assert.rejects(f.store.save);
  f.store.edit('findings','newer');f.mode='ok';await f.store.recover();await f.store.save();assert.equal(f.saved.sections.findings,'newer');assert.equal(f.writes,2);f.store.destroy();
});
test('revision conflict after reconnect preserves local text and blocks signing',async()=>{
  const f=recoveryFixture();await f.store.load();f.mode='offline';f.store.edit('findings','my text');await assert.rejects(f.store.save);
  f.change({revision:2,sections:{...initial.sections,findings:'another doctor'}});f.mode='ok';await f.store.recover();
  assert.equal(f.store.getSnapshot().conflict,true);assert.equal(f.store.getSnapshot().text.findings,'my text');await assert.rejects(()=>f.store.finalize());assert.equal(f.writes,1);f.store.destroy();
});
test('authentication recovery revalidates permissions without losing text or dictation manual-save state',async()=>{
  const f=recoveryFixture();await f.store.load();f.mode='auth';f.store.edit('findings','dictated',{dictated:true});await assert.rejects(f.store.save);
  f.mode='ok';f.change({canEdit:false,canFinalize:false});await f.store.recover();assert.equal(f.store.getSnapshot().report.canEdit,false);assert.equal(f.store.getSnapshot().text.findings,'dictated');
  f.change({canEdit:true,canFinalize:true});await f.store.recover();await delay(1100);assert.equal(f.writes,1);await f.store.save();assert.equal(f.saved.sections.findings,'dictated');f.store.destroy();
});
test('pending capture retains bytes, provenance and idempotency ID across recovery',async()=>{
  const f=recoveryFixture();await f.store.load();f.mode='offline';await assert.rejects(f.store.capture);const pending=f.store.getSnapshot().pendingCapture;
  f.mode='ok';await f.store.recover();assert.equal(f.store.getSnapshot().pendingCapture,pending);await f.store.retryCapture();assert.equal(f.uploads,2);assert.equal(f.store.getSnapshot().report.keyImages.length,1);assert.equal(f.store.getSnapshot().pendingCapture,null);f.store.destroy();
});
test('failed caption autosave resumes after reconnect without saving newly dictated text',async()=>{
  const f=recoveryFixture();f.change({keyImages:[{id:4,caption:'before'}]});await f.store.load();f.store.editCaption(4,'retained caption');f.mode='offline';await assert.rejects(f.store.save);
  f.store.edit('findings','new dictation',{dictated:true});f.mode='ok';await f.store.recover();await delay(1100);
  assert.equal(f.saved.keyImages[0].caption,'retained caption');assert.equal(f.saved.sections.findings,'');assert.equal(f.store.getSnapshot().text.findings,'new dictation');assert.equal(f.store.getSnapshot().dirty,true);f.store.destroy();
});
test('a lost caption response is reconciled without writing duplicate revisions',async()=>{
  const f=recoveryFixture();f.change({keyImages:[{id:4,caption:'before'}]});await f.store.load();f.store.editCaption(4,'saved caption');f.mode='lost';await assert.rejects(f.store.save);f.mode='ok';await f.store.recover();await delay(1100);
  assert.equal(f.writes,1);assert.deepEqual(f.store.getSnapshot().captionEdits,{});f.store.destroy();
});
test('a committed key image with a lost response retains the same request ID and retries without duplication',async()=>{
  const f=recoveryFixture();await f.store.load();f.mode='lost-upload';await assert.rejects(f.store.capture);const pending=f.store.getSnapshot().pendingCapture;
  f.mode='ok';await f.store.recover();assert.equal(f.store.getSnapshot().pendingCapture,pending);await f.store.retryCapture();assert.equal(f.saved.keyImages.length,1);assert.equal(f.uploads,2);assert.equal(f.saved.keyImages[0].requestId,pending.requestId);f.store.destroy();
});
