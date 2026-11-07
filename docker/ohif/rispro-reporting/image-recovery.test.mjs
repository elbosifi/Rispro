import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createConnection} from './src/connection.js';
const source=readFileSync(new URL('./src/image-recovery.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'').replaceAll('export ','');
const renderingSource=readFileSync(new URL('./src/rendering-recovery.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'').replaceAll('export ','');
function renderingFixture({blank=false,width=128,cameraUnavailable=false}={}) {
  let time=0,id=0,rebuilds=0,engine,selected='selected',generation=1,imageIds=['cached-frame'],attachedIds=['cached-frame'],restoredImageIds=[],currentViewport;
  const timers=new Map(),element={isConnected:true,clientWidth:width,clientHeight:128};
  const target=new EventTarget();target.createElement=()=>({getContext:()=>({drawImage(){},getImageData:()=>({data:new Uint8Array([0,0,0,255,blank?0:100,100,100,255])})})});
  const view=()=>{const v={id:'vp',type:'stack',element,canvas:{width:128,height:128},defaultOptions:{},getImageIds:()=>attachedIds,getCurrentImageId:()=>attachedIds[0],getCurrentImageIdIndex:()=>3,
    _risproSelectionGeneration:generation,_risproSelectionOwner:{generation,displaySetInstanceUIDs:[selected]},_risproAttachedData:{kind:'stack',selectionGeneration:generation,displaySetInstanceUIDs:[selected],imageIds:[...attachedIds]},
    getCamera:()=>{if(cameraUnavailable)throw new TypeError('Missing context pool');return {parallelScale:4};},getVolumeId:()=>{if(cameraUnavailable)throw new TypeError('Missing context pool');},getProperties:()=>({voiRange:{lower:0,upper:100}}),getActors:()=>[],setProperties(p){this.properties=p;},setCamera(c){this.camera=c;},setStack:async()=>{},render(){}};currentViewport=v;return v;};
  const make=()=>{const v=view();v.setStack=async ids=>{restoredImageIds=[...ids];attachedIds=[...ids];};return {id:'shared',getViewports:()=>[v],getViewport:()=>v,setViewports(){},render(){},destroy(){engine=null;}};};
  engine=make();
  const services={viewportGridService:{getState:()=>({viewports:new Map([['vp',{displaySetInstanceUIDs:[selected]} ]])}),getActiveViewportId:()=> 'vp'},
    cornerstoneViewportService:{renderingEngine:{id:'shared'},getRenderingEngine:()=>{rebuilds++;return engine=make();},getCornerstoneViewport:()=>engine.getViewport()},displaySetService:{getDisplaySetByUID:()=>({Modality:'MR',isDynamicVolume:true,images:[{}]})}};
  const cache={getVolumes:()=>[],getCacheSize:()=>12,getVolume:id=>{assert.ok(id,'Cornerstone rejects an undefined volume selector');return undefined;}};
  const create=new Function('cache','getRenderingEngine','getConfiguration','document','performance','setTimeout','clearTimeout','getImageRequestDiagnostics',renderingSource+';return createRenderingRecovery;')(
    cache,()=>engine,()=>({rendering:{useCPURendering:false}}),target,{now:()=>time},(fn,ms)=>{timers.set(++id,{fn,at:time+ms});return id;},key=>timers.delete(key),()=>({pendingReads:0,activeConsumers:0,pendingTransports:0,started:0,completed:0,canceled:0}));
  const recovery=create({services},target);
  const advance=async ms=>{const end=time+ms;for(let n=0;n<1000;n++){await new Promise(r=>setImmediate(r));const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;time=next[1].at;timers.delete(next[0]);next[1].fn();}time=end;await new Promise(r=>setImmediate(r));};
  return {recovery,advance,element,timers,engine:()=>engine,rebuilds:()=>rebuilds,restoredImageIds:()=>restoredImageIds,
    select:(uid,ids,token)=>{selected=uid;imageIds=ids;generation=token;if(currentViewport){currentViewport._risproSelectionGeneration=token;currentViewport._risproSelectionOwner={generation:token,displaySetInstanceUIDs:[uid]};currentViewport._risproSelection={generation:token};}},
    fail:(code,engineId='shared')=>target.dispatchEvent(new CustomEvent('rispro-rendering-failure',{detail:{engineId,code}})),
    ready:(uid,ids,token)=>{attachedIds=[...ids];if(currentViewport){currentViewport._risproAttachedData={kind:'stack',selectionGeneration:token,displaySetInstanceUIDs:[uid],imageIds:[...ids]};currentViewport._risproSelectionGeneration=token;currentViewport._risproSelectionOwner={generation:token,displaySetInstanceUIDs:[uid]};}
      target.dispatchEvent(new CustomEvent('rispro-viewport-data-ready',{detail:{viewportId:'vp',displaySetInstanceUIDs:[uid],imageIds:ids,selectionGeneration:token}}));}};
}
test('shared rendering recovery waits for restoration, retains presentation and verifies actual pixels',async()=>{
  const f=renderingFixture();f.fail('context-lost');await f.advance(500);assert.equal(f.rebuilds(),0);
  f.fail('context-restored');await f.advance(500);assert.equal(f.rebuilds(),1);assert.equal(f.recovery.getSnapshot(),null);
  assert.deepEqual(f.engine().getViewport().camera,{parallelScale:4});assert.deepEqual(f.engine().getViewport().properties,{voiRange:{lower:0,upper:100}});
  assert.deepEqual(f.recovery.diagnostics().map(e=>e.code),['context-lost','context-restored','recovered-pixels']);f.recovery.destroy();
});
test('blank renders fail verification and repeated shader errors cannot cause an automatic allocation loop',async()=>{
  const f=renderingFixture({blank:true});f.fail('shader-failed');for(let i=0;i<30;i++)f.fail('shader-failed');await f.advance(6000);
  assert.equal(f.rebuilds(),1);assert.match(f.recovery.getSnapshot().message,/pixels could not be verified/);
  f.fail('shader-failed');await f.advance(20000);assert.equal(f.rebuilds(),1);
  f.recovery.retry();await f.advance(6000);assert.equal(f.rebuilds(),2);f.recovery.destroy();assert.equal(f.timers.size,0);
});
test('invalid dimensions cannot destroy a renderer; retry after visibility recovers without touching transport',async()=>{
  const f=renderingFixture({width:0});f.fail('context-pool-missing');await f.advance(1000);assert.equal(f.rebuilds(),0);
  assert.match(f.recovery.getSnapshot().message,/viewports are visible/);f.element.clientWidth=128;await f.advance(5000);f.recovery.retry();await f.advance(500);assert.equal(f.rebuilds(),1);f.recovery.destroy();
  assert.doesNotMatch(renderingSource,/fetch\(|connection\.|purgeCache|removeImageLoadObject|localStorage|sessionStorage/);
});
test('mode exit cancels queued recovery and incompatible dynamic MRI never offers stack flattening',async()=>{
  const f=renderingFixture();assert.equal(f.recovery.canStack(),false);f.fail('shader-failed');f.recovery.destroy();await f.advance(1000);assert.equal(f.rebuilds(),0);
});
test('a temporary capture or thumbnail engine cannot replace the clinical rendering engine',async()=>{
  const f=renderingFixture();f.fail('context-lost','capture-engine');await f.advance(10000);assert.equal(f.recovery.getSnapshot(),null);assert.equal(f.rebuilds(),0);f.recovery.destroy();
});
test('a persistently missing pool keeps the recovery UI usable and explains the safe reentry route',async()=>{
  const f=renderingFixture({cameraUnavailable:true});f.fail('context-pool-missing');await f.advance(1000);
  assert.equal(f.rebuilds(),0);assert.match(f.recovery.getSnapshot().message,/Reopen the study.*unsaved work/);
  assert.equal(f.recovery.canStack(),false);f.recovery.destroy();
});
test('recovery waits for an incomplete newer selection and rebuilds from its fresh viewport data',async()=>{
  const f=renderingFixture();
  f.select('series-B',['series-A-frame'],2); // B is selected; A is still attached while B metadata is pending.
  f.fail('shader-failed');
  await f.advance(300);
  assert.equal(f.rebuilds(),0,'recovery must not rebuild from A under B selection identity');

  f.select('series-B',['series-B-frame'],2);
  f.ready('series-B',['series-B-frame'],2);
  await f.advance(6000);

  assert.deepEqual(f.restoredImageIds(),['series-B-frame']);
  assert.equal(f.recovery.getSnapshot(),null,'fresh B pixels and source identity complete recovery');
  assert.equal(f.rebuilds(),1);f.recovery.destroy();
});
function module(imageLoader,cache,connection) {return new Function('imageLoader','cache','connection',source+'\nreturn {installImageRecovery,trackImageRequest,retryDiagnosticImage,getImageRequestDiagnostics};')(imageLoader,cache,connection);}
test('image recovery registers only WADO reads and cancels the original XHR through the pinned cancellation API',async()=>{
  for(const destroy of [false,true]){
  const target=new EventTarget();target.navigator={onLine:true};let loader,reject,xhr,aborts=0;
  const connection=createConnection({contextId:'tab',target,fetcher:async()=>Response.json({userId:7})});
  const api=module({registerImageLoader:(scheme,fn)=>{assert.equal(scheme,'wadors');loader=fn;}},{},connection);
  const options={priority:-5,requestType:'interaction',targetBuffer:{type:'Float32Array'}};
  api.installImageRecovery({wadors:{loadImage:(id,supplied)=>{
    assert.equal(supplied,options);xhr=new EventTarget();xhr.abort=()=>{aborts++;reject({status:0});xhr.dispatchEvent(new Event('loadend'));};api.trackImageRequest(id,xhr);
    return {promise:new Promise((_r,j)=>reject=j)};
  }}});
  const load=loader('wadors:frame',options);await new Promise(r=>setImmediate(r));if(destroy)connection.destroy();else load.cancelFn();await assert.rejects(load.promise);assert.equal(aborts,1);
  api.trackImageRequest('frame',null); // Progressive fetch beforeSend uses null.
  }
});
test('canceling one shared image-loader consumer preserves the other consumer pixels',async()=>{
  const target=new EventTarget();target.navigator={onLine:true};let loader,resolveImage,xhr,aborts=0,loads=0;
  const connection=createConnection({contextId:'tab',target,fetcher:async()=>Response.json({userId:7})});
  const api=module({registerImageLoader:(scheme,fn)=>{assert.equal(scheme,'wadors');loader=fn;}},{},connection);
  api.installImageRecovery({wadors:{loadImage:(id,options)=>{
    loads++;xhr=new EventTarget();xhr.readyState=1;xhr.status=0;xhr.abort=()=>{aborts++;};api.trackImageRequest(id,xhr);
    return {promise:new Promise(resolve=>{resolveImage=resolve;})};
  }}});
  const first=loader('wadors:shared-frame',{}),second=loader('wadors:shared-frame',{});
  const firstResult=first.promise.catch(error=>error),secondResult=second.promise;
  await new Promise(r=>setImmediate(r));first.cancelFn();
  assert.equal((await firstResult).name,'AbortError');
  assert.equal(aborts,0,'one Cornerstone cache consumer does not cancel the shared transport');
  const pixels=new Uint16Array([0,16,2048,4095]);xhr.status=200;resolveImage({imageId:'wadors:shared-frame',getPixelData:()=>pixels});xhr.dispatchEvent(new Event('loadend'));
  const image=await secondResult;assert.deepEqual(image.getPixelData(),pixels);
  assert.equal(loads,1,'same-key readers share one WADO load');assert.equal(aborts,0);second.cancelFn();connection.destroy();
});
test('final shared cancellation aborts once and late old cleanup cannot detach a newer same-key request',async()=>{
  const target=new EventTarget();target.navigator={onLine:true};let loader,oldResolve,newResolve;const xhrs=[];let aborts=0;
  const connection=createConnection({contextId:'tab',target,fetcher:async()=>Response.json({userId:7})});
  const api=module({registerImageLoader:(scheme,fn)=>{loader=fn;}},{},connection);
  api.installImageRecovery({wadors:{loadImage:(id)=>{
    const isOld=xhrs.length===0;const xhr=new EventTarget();xhr.readyState=1;xhr.status=0;xhr.abort=()=>{aborts++;};xhrs.push(xhr);api.trackImageRequest(id,xhr);
    return {promise:new Promise(resolve=>{if(isOld)oldResolve=resolve;else newResolve=resolve;})};
  }}});
  const old=loader('wadors:reused-key',{});await new Promise(r=>setImmediate(r));old.cancelFn();await assert.rejects(old.promise,/canceled/i);
  assert.equal(aborts,1,'the last consumer aborts the old transport exactly once');
  const current=loader('wadors:reused-key',{});await new Promise(r=>setImmediate(r));assert.equal(xhrs.length,2);
  oldResolve({getPixelData:()=>new Uint16Array([111])});xhrs[0].dispatchEvent(new Event('loadend'));
  assert.equal(api.getImageRequestDiagnostics().pendingTransports,1,'late old loadend cannot unregister the replacement request');
  const pixels=new Uint16Array([4095,3,0]);xhrs[1].status=200;newResolve({getPixelData:()=>pixels});xhrs[1].dispatchEvent(new Event('loadend'));
  assert.deepEqual((await current.promise).getPixelData(),pixels);assert.equal(api.getImageRequestDiagnostics().pendingTransports,0);connection.destroy();
});
test('explicit image Retry displays the recovered frame in the same viewport with its presentation retained',async()=>{
  let renewals=0,reads=0,renders=0;const image={},camera={zoom:3},properties={voiRange:{lower:1,upper:7}};
  const viewport={getCurrentImageId:()=> 'wadors:frame',getCornerstoneImage:()=>image,getCamera:()=>camera,getProperties:()=>properties,
    renderImageObject:actual=>assert.equal(actual,image),setCamera:actual=>assert.equal(actual,camera),setProperties:actual=>assert.equal(actual,properties),render:()=>renders++};
  const api=module({loadAndCacheImage:async id=>{assert.equal(id,'wadors:frame');reads++;return image;}},{},{renew:async()=>renewals++,retry:()=>{}});
  await api.retryDiagnosticImage(viewport);assert.equal(renewals,1);assert.equal(reads,1);assert.equal(renders,1);
  assert.doesNotMatch(source,/location\.reload|setStack|destroy|purgeCache|removeImageLoadObject/);
});
