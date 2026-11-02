import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createConnection} from './src/connection.js';
const error=(status,code)=>Response.json({error:{message:code,details:{code}}},{status});
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
  assert.equal(a,b);assert.deepEqual(await a,new Uint8Array([0,255,13,10]));assert.equal(count,4);assert.deepEqual(f.delays,[1000,2000,4000]);
  assert.equal(f.controller.getSnapshot().status,'connected');
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
test('403 is probed and permanently denied without retrying the image',async()=>{
  const f=fixture({fetcher:async()=>error(403,'VIEWER_DENIED')});let count=0;
  await assert.rejects(f.controller.read('frame',async()=>{count++;throw {status:403};}));
  assert.equal(count,1);assert.equal(f.controller.getSnapshot().status,'denied');
});
test('a decode failure is terminal and is not retried as a network outage',async()=>{
  const f=fixture();let count=0;await assert.rejects(f.controller.read('frame',async()=>{count++;throw Error('Unsupported pixel decoder');}));assert.equal(count,1);
});
test('retry bursts are bounded until an explicit wake and aborted offline work is canceled',async()=>{
  const f=fixture();let count=0;
  const abort=new AbortController();const pending=f.controller.read('frame',async()=>{count++;throw {status:503};},abort.signal);
  await new Promise(r=>setImmediate(r));assert.equal(count,4);abort.abort();await assert.rejects(pending,{name:'AbortError'});
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
  const stop=f.controller.start();await new Promise(r=>setImmediate(r));channel.onmessage({data:{type:'logout'}});release();
  await new Promise(r=>setImmediate(r));assert.equal(f.controller.getSnapshot().status,'denied');
  f.controller.notify(new TypeError('Late network error'));assert.equal(f.controller.getSnapshot().status,'denied');stop();
});
