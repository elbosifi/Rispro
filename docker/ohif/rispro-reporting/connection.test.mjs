import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createConnection} from './src/connection.js';
import {createReportStore} from './src/report-store.js';
const error=(status,code)=>Response.json({error:{message:code,details:{code}}},{status});
test('an unavailable optional cross-tab channel cannot reject a valid same-tab login',async()=>{
  for(const constructorFails of [true,false]){
    const f=fixture({fetcher:async url=>url.endsWith('/login')?Response.json({user:{id:7}}):Response.json({userId:7})});
    f.target.BroadcastChannel=class {constructor(){if(constructorFails)throw Error('Channel unavailable');}postMessage(){throw Error('Channel unavailable');}close(){}};
    f.controller.notify({status:401,code:'AUTH_EXPIRED'});
    try{f.controller.start();await f.controller.login('original','correct');assert.equal(f.controller.getSnapshot().status,'connected');}finally{f.controller.destroy();}
  }
});
test('credential rejection and rate limiting keep the form retryable with stage-specific feedback',async()=>{
  for(const [status,code] of [[401,'CREDENTIALS_REJECTED'],[429,undefined],[403,'VIEWER_USER_CHANGED']]){
    const f=fixture({fetcher:async()=>error(status,code)});
    f.controller.notify({status:401,code:'AUTH_EXPIRED'});
    await assert.rejects(f.controller.login('original','incorrect'));
    assert.equal(f.controller.getSnapshot().status,'authentication-required');
    assert.equal(f.controller.getSnapshot().stage,'credentials');
    if(status===429)assert.match(f.controller.getSnapshot().message,/Too many login attempts/);
    f.controller.destroy();
  }
});
test('login cookie failure is distinct from successful login followed by failed viewer renewal',async()=>{
  for(const scenario of ['cookie','renewal','old-context','revoked','origin']){
    const calls=[];let broadcasts=0;
    const f=fixture({fetcher:async(url,options)=>{
      assert.equal(options.credentials,'same-origin');calls.push(url);
      if(url.endsWith('/login'))return Response.json({user:{id:7}});
      if(url.endsWith('/refresh'))return scenario==='cookie'?error(401,'AUTH_REQUIRED'):scenario==='origin'?error(403,'SESSION_DENIED'):Response.json({user:{id:7}});
      return scenario==='old-context'?error(403,'VIEWER_RECOVERY_UNAVAILABLE'):scenario==='revoked'?error(403,'VIEWER_REVOKED'):error(503,'UNAVAILABLE');
    }});
    f.target.BroadcastChannel=class {postMessage(){broadcasts++;}close(){}};
    f.controller.notify({status:401,code:'AUTH_EXPIRED'});
    await assert.rejects(f.controller.login('original','correct'),e=>e.authenticated===true);
    const state=f.controller.getSnapshot();
    if(scenario==='cookie'){assert.equal(state.code,'SESSION_COOKIE_MISSING');assert.equal(state.stage,'cookie');assert.equal(calls.length,2);}
    if(scenario==='renewal'){assert.equal(state.stage,'renewal');assert.match(state.message,/Sign-in succeeded/);}
    if(['old-context','revoked'].includes(scenario)){assert.equal(state.status,'denied');const count=calls.length;await assert.rejects(f.controller.login('original','correct'));assert.equal(calls.length,count);}
    if(scenario==='origin')assert.match(state.message,/Same-origin/);
    assert.equal(broadcasts,['cookie','origin'].includes(scenario)?0:1,'Only a verified login cookie broadcasts, independently of viewer renewal');
    f.controller.destroy();
  }
});
function fixture(overrides={}) {
  const target=new EventTarget();target.navigator={onLine:true};target.document=new EventTarget();target.document.visibilityState='visible';
  const calls=[],delays=[];
  const controller=createConnection({contextId:'tab-one',target,random:()=>0.5,wait:async ms=>{delays.push(ms);},fetcher:async(url,options)=>{
    calls.push({url,body:JSON.parse(options.body)});
    return url.endsWith('/refresh')?Response.json({user:{id:7}}):Response.json({userId:7});
  },...overrides});
  return {controller,target,calls,delays};
}
test('transient DICOM reads retry with backoff, deduplicate and keep exact returned bytes',async()=>{
  const f=fixture();let count=0;
  const work=async()=>{if(count++<3)throw {status:[502,503,504][count-1]};return new Uint8Array([0,255,13,10]);};
  const a=f.controller.read('frame',work),b=f.controller.read('frame',work);
  assert.deepEqual(await Promise.all([a,b]),[new Uint8Array([0,255,13,10]),new Uint8Array([0,255,13,10])]);assert.equal(count,4);assert.deepEqual(f.delays,[1000,2000,4000]);
  assert.equal(f.controller.getSnapshot().status,'connected');
});
test('canceling one consumer of a shared image read leaves the other consumer and pixels intact',async()=>{
  const f=fixture();let workCount=0,cancelCount=0,resolveWork;
  const expected=new Uint16Array([0,17,1024,4095]);
  const work=()=>{workCount++;return new Promise(resolve=>{resolveWork=resolve;});};
  const cancel=()=>{cancelCount++;};
  const firstAbort=new AbortController(),secondAbort=new AbortController();
  const first=f.controller.read('shared-image',work,firstAbort.signal,cancel).catch(error=>error);
  const second=f.controller.read('shared-image',work,secondAbort.signal,cancel).catch(error=>error);
  await new Promise(r=>setImmediate(r));firstAbort.abort();await new Promise(r=>setImmediate(r));
  assert.equal(cancelCount,0,'the shared transport is still owned by the second consumer');
  resolveWork(expected);
  const [firstResult,secondResult]=await Promise.all([first,second]);
  assert.equal(firstResult.name,'AbortError');
  assert.deepEqual(secondResult,expected,'the remaining consumer receives the original decoded pixel data');
  assert.equal(workCount,1,'shared readers retain transport deduplication');
  assert.equal(cancelCount,0);f.controller.destroy();
});
test('canceling the final shared image consumer aborts the underlying operation exactly once',async()=>{
  const f=fixture();let cancelCount=0,workCount=0;
  const work=()=>{workCount++;return new Promise(()=>{});};
  const cancel=()=>{cancelCount++;};
  const firstAbort=new AbortController(),secondAbort=new AbortController();
  const first=f.controller.read('shared-image',work,firstAbort.signal,cancel).catch(error=>error);
  const second=f.controller.read('shared-image',work,secondAbort.signal,cancel).catch(error=>error);
  await new Promise(r=>setImmediate(r));firstAbort.abort();await new Promise(r=>setImmediate(r));
  assert.equal(cancelCount,0);
  secondAbort.abort();
  const results=await Promise.all([first,second]);
  assert.ok(results.every(result=>result.name==='AbortError'));
  assert.equal(workCount,1);assert.equal(cancelCount,1,'only the last consumer releases the single transport');
  f.controller.destroy();
});
test('offline reads wait for online/Retry without assuming each failure means offline',async()=>{
  const f=fixture();f.target.navigator.onLine=false;let count=0;
  const pending=f.controller.read('frame',async()=>{count++;return 'pixels';});
  await new Promise(r=>setImmediate(r));assert.equal(count,0);
  f.target.navigator.onLine=true;f.controller.retry();assert.equal(await pending,'pixels');assert.equal(count,1);
});
test('expired login is recovered once in place and the original image promise resumes',async()=>{
  let authenticated=false,images=0;
  const f=fixture({fetcher:async(url,options)=>{
    if(url.endsWith('/login')){assert.equal(JSON.parse(options.body).viewerContextId,'tab-one');authenticated=true;return Response.json({user:{id:7}});}
    return authenticated?Response.json({userId:7}):error(401,'AUTH_EXPIRED');
  }});
  const pending=f.controller.read('frame',async()=>{images++;if(!authenticated)throw {status:401};return 'same frame';});
  await new Promise(r=>setImmediate(r));assert.equal(f.controller.getSnapshot().status,'authentication-required');
  await f.controller.login('original','password');assert.equal(await pending,'same frame');assert.equal(images,2);
});
test('original-user reauthentication in another tab releases authentication waiters after successful context renewal',async()=>{
  let authenticated=true,images=0;
  const f=fixture({fetcher:async()=>authenticated?Response.json({userId:7}):error(401,'AUTH_EXPIRED')});
  await f.controller.renew();authenticated=false;
  const pending=f.controller.read('frame',async()=>{images++;if(!authenticated)throw {status:401};return 'same frame';});
  await new Promise(r=>setImmediate(r));assert.equal(f.controller.getSnapshot().status,'authentication-required');
  authenticated=true;await f.controller.renew();assert.equal(await pending,'same frame');assert.equal(images,2);f.controller.destroy();
});
test('403 is probed and permanently denied without retrying the image',async()=>{
  const f=fixture({fetcher:async()=>error(403,'VIEWER_DENIED')});let count=0;
  await assert.rejects(f.controller.read('frame',async()=>{count++;throw {status:403};}));
  assert.equal(count,1);assert.equal(f.controller.getSnapshot().status,'denied');
});
test('a decode failure is terminal and is not retried as a network outage',async()=>{
  const f=fixture();let count=0;await assert.rejects(f.controller.read('frame',async()=>{count++;throw Error('Unsupported pixel decoder');}));assert.equal(count,1);
});
test('the initial image retry burst is bounded and canceled work is removed before recovery',async()=>{
  const f=fixture();let count=0;
  const abort=new AbortController();const pending=f.controller.read('frame',async()=>{count++;throw {status:503};},abort.signal);
  await new Promise(r=>setImmediate(r));assert.equal(count,4);abort.abort();await assert.rejects(pending,{name:'AbortError'});
});

function virtualClock() {
  let time=1e9,id=0;const timers=new Map(),scheduled=[];
  const flush=()=>new Promise(r=>setImmediate(r));
  return {now:()=>time,scheduled,timers,
    setTimer(fn,ms){const key=++id;timers.set(key,{fn,due:time+ms});scheduled.push(ms);return key;},
    clearTimer(key){timers.delete(key);},
    async advance(ms){const until=time+ms;await flush();for(;;){const next=[...timers].filter(([,t])=>t.due<=until).sort((a,b)=>a[1].due-b[1].due)[0];if(!next)break;time=next[1].due;timers.delete(next[0]);next[1].fn();await flush();}time=until;await flush();},
  };
}
function outageFixture({statuses=[503],frameOnly=false,hidden=false}={}) {
  const clock=virtualClock(),start=clock.now(),probes=[],frames=[];
  const f=fixture({now:clock.now,setTimer:clock.setTimer,clearTimer:clock.clearTimer,wait:undefined,fetcher:async url=>{
    if(url.endsWith('/renew')){probes.push(clock.now());if(!frameOnly && clock.now()-start<120000)return error(statuses[(probes.length-1)%statuses.length],'TEMPORARY_UNAVAILABLE');}
    return Response.json({userId:7});
  }});
  if(hidden)f.target.document.visibilityState='hidden';
  const work=async()=>{frames.push(clock.now());if(clock.now()-start<120000)throw {status:503};return 'pixels';};
  return {...f,clock,probes,frames,work};
}
for(const statuses of [[503],[502,504]])test(`two-minute ${statuses.join('/')} outage recovers with no online or manual Retry event`,async()=>{
  const f=outageFixture({statuses});let result;
  const pending=f.controller.read('missing-frame',f.work).then(value=>{result=value;});
  await f.clock.advance(120000);assert.equal(f.target.navigator.onLine,true);assert.equal(result,undefined);assert.equal(f.frames.length,4,'Only the initial burst downloads failing frames');
  assert.ok(f.probes.length<=8);await f.clock.advance(60000);await pending;
  assert.equal(result,'pixels');assert.equal(f.frames.length,5);assert.equal(f.controller.getSnapshot().status,'connected');assert.equal(f.clock.timers.size,0);f.controller.destroy();
});
test('frame-only outages release at most one retry per probe even when session renewal stays healthy',async()=>{
  const f=outageFixture({frameOnly:true});const pending=f.controller.read('missing-frame',f.work);await f.clock.advance(180000);
  assert.equal(await pending,'pixels');assert.ok(f.frames.length<=12);assert.equal(f.frames.length,4+f.probes.length);assert.equal(f.clock.timers.size,0);f.controller.destroy();
});
test('hidden tabs recover automatically; focus/visibility storms share one scheduler and one in-flight probe',async()=>{
  const f=outageFixture({hidden:true});const stop=f.controller.start();const pending=f.controller.read('missing-frame',f.work);
  await f.clock.advance(20000);const before=f.probes.length;
  f.target.document.visibilityState='visible';for(let i=0;i<100;i++){f.target.dispatchEvent(new Event('focus'));f.target.document.dispatchEvent(new Event('visibilitychange'));}
  await f.clock.advance(0);assert.ok(f.probes.length<=before+1);
  await f.clock.advance(180000);assert.equal(await pending,'pixels');assert.ok(f.probes.length<15);stop();assert.equal(f.clock.timers.size,0);
});
test('expired authentication pauses the scheduler until original-user login and a permanent revocation never resumes reads',async()=>{
  for(const status of [401,403]){
    const clock=virtualClock();let authenticated=false,probes=0,frames=0;
    const f=fixture({now:clock.now,setTimer:clock.setTimer,clearTimer:clock.clearTimer,wait:undefined,fetcher:async url=>{
      if(url.endsWith('/login')){authenticated=true;return Response.json({user:{id:7}});}
      probes++;return authenticated?Response.json({userId:7}):error(status,status===401?'AUTH_EXPIRED':'VIEWER_DENIED');
    }});
    const pending=f.controller.read('frame',async()=>{frames++;if(!authenticated)throw {status:503};return 'pixels';});const outcome=pending.catch(e=>e);
    await clock.advance(20000);const count=probes;await clock.advance(180000);assert.equal(probes,count);assert.equal(frames,4);assert.equal(clock.timers.size,0);
    if(status===401){assert.equal(f.controller.getSnapshot().status,'authentication-required');await f.controller.login('original','password');assert.equal(await outcome,'pixels');}
    else {assert.equal((await outcome).status,403);assert.equal(f.controller.getSnapshot().status,'denied');}
    f.controller.destroy();assert.equal(clock.timers.size,0);
  }
});
test('canceled and destroyed requests are not resumed by later probes or focus events',async()=>{
  const f=outageFixture();const stop=f.controller.start(),abort=new AbortController();
  const pending=f.controller.read('obsolete',f.work,abort.signal);const outcome=pending.catch(e=>e);await f.clock.advance(10000);abort.abort();assert.equal((await outcome).name,'AbortError');const frames=f.frames.length;
  await f.clock.advance(180000);assert.equal(f.frames.length,frames);stop();assert.equal(f.clock.timers.size,0);const probes=f.probes.length;
  f.target.dispatchEvent(new Event('focus'));await f.clock.advance(180000);assert.equal(f.probes.length,probes);
});
test('an image authentication failure after successful renewal becomes terminal rather than retrying indefinitely',async()=>{
  const f=fixture();let calls=0;
  await assert.rejects(f.controller.read('frame',async()=>{calls++;throw {status:401};}));assert.equal(calls,2);assert.equal(f.controller.getSnapshot().status,'denied');f.controller.destroy();
});
test('read-only XHR authorization status is denied without mutating the failed transport object',async()=>{
  const f=fixture(),xhr=Object.defineProperty({},'status',{get:()=>403});
  await assert.rejects(f.controller.read('frame',async()=>{throw xhr;}),{status:403});assert.equal(f.controller.getSnapshot().status,'denied');f.controller.destroy();
});
test('destroying a newly queued read prevents its first request from starting',async()=>{
  const f=fixture();let calls=0;const pending=f.controller.read('obsolete',async()=>calls++);f.controller.destroy();await assert.rejects(pending,{name:'AbortError'});assert.equal(calls,0);
});
test('a sustained outage preserves the reporting store, dirty dictated text, captions and unsent addendum',async()=>{
  const f=outageFixture();const report={id:1,revision:1,status:'draft',canEdit:true,sections:{findings:'saved'},keyImages:[]};
  const store=createReportStore({contextId:'tab-one',connection:f.controller,captureViewport:()=>{},locateSource:()=>{},fetcher:async()=>Response.json({canEdit:true,report})});
  await store.load();const text='unsaved dictated text';store.edit('findings',text,{dictated:true});store.editCaption(1,'pending caption');store.editAddendum('unsigned correction');
  const pending=f.controller.read('missing-frame',f.work);await f.clock.advance(180000);assert.equal(await pending,'pixels');await new Promise(r=>setImmediate(r));
  assert.equal(store.getSnapshot().text.findings,text);assert.equal(store.getSnapshot().dirty,true);assert.equal(store.getSnapshot().captionEdits[1],'pending caption');assert.equal(store.getSnapshot().addendumText,'unsigned correction');
  store.destroy();f.controller.destroy();assert.equal(f.clock.timers.size,0);
});
test('active renewal is single-flight and tab contexts never share selectors',async()=>{
  const f=fixture();await Promise.all([f.controller.renew(),f.controller.renew()]);assert.equal(f.calls.length,2);
  assert.match(f.calls[0].url,/tab-one\/renew$/);
  let otherUrl;const second=fixture({contextId:'tab-two',fetcher:async url=>{otherUrl??=url;return Response.json({userId:7});}});await second.controller.renew();assert.match(otherUrl,/tab-two\/renew$/);
});
test('focus checks long-open tabs without network calls on every input event',async()=>{
  let time=1e9;const f=fixture({now:()=>time});const stop=f.controller.start();
  await new Promise(r=>setImmediate(r));assert.equal(f.calls.length,2);
  for(let i=0;i<100;i++)f.target.dispatchEvent(new Event('pointerdown'));assert.equal(f.calls.length,2);
  time+=9*3600000;f.target.dispatchEvent(new Event('focus'));await new Promise(r=>setImmediate(r));assert.equal(f.calls.length,4);stop();
});

test('explicit logout cannot be undone by an in-flight renewal response',async()=>{
  let channel,release;
  class Channel {constructor(){channel=this;}close(){}}
  const target=new EventTarget();target.navigator={onLine:true};target.BroadcastChannel=Channel;
  let calls=0;const f=fixture({target,fetcher:async()=>{if(calls++===0)await new Promise(r=>release=r);return Response.json({userId:7});}});
  const stop=f.controller.start();try{await new Promise(r=>setImmediate(r));channel.onmessage({data:{type:'logout'}});release();
  await new Promise(r=>setImmediate(r));assert.equal(f.controller.getSnapshot().status,'denied');
  assert.equal(f.controller.getSnapshot().code,'VIEWER_LOGGED_OUT','A late renewal cannot replace the explicit logout reason');
  f.controller.notify(new TypeError('Late network error'));assert.equal(f.controller.getSnapshot().status,'denied');
  }finally{stop();}
});
