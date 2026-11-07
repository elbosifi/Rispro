const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const configurator=require('./configure-viewport-reliability.cjs');

// Execute the pinned upstream module, with only its dependencies replaced.
// This fixture is copied verbatim from @cornerstonejs/tools 4.15.29 (MIT).
function fixture(){
  const states=new WeakMap(),enabled=new WeakMap(),cached=new Map(),loads=new Map();
  const eventTarget=new EventTarget(),events={STACK_NEW_IMAGE:'stack-image',IMAGE_CACHE_IMAGE_REMOVED:'removed'};
  let rows=[],downloads=0,aborts=0;
  const pool={addRequest(fn,type,additionalDetails,priority){rows.push({requestFn:fn,type,additionalDetails,priority});},
    filterRequests(keep){rows=rows.filter(keep);}};
  const getEnabledElement=e=>{const v=enabled.get(e);if(!v)throw Error('disabled');return {viewport:v,viewportId:v.id};};
  const imageLoader={loadAndCacheImage(id){
    if(cached.has(id))return Promise.resolve(cached.get(id));
    if(loads.has(id))return loads.get(id).promise;
    downloads++;let resolve;const promise=new Promise(r=>{resolve=r;});loads.set(id,{promise,resolve:value=>{cached.set(id,value);resolve(value);}});return promise;
  }};
  const cache={getImageLoadObject:id=>cached.has(id)||loads.has(id),isLoaded:id=>cached.has(id),
    getCachedImageBasedOnImageURI:id=>cached.has(id)?{image:{decodeTimeInMS:1,loadTimeInMS:2},sizeInBytes:2}:undefined,
    getMaxCacheSize:()=>6400,removeImageLoadObject(){throw Error('valid cache must be preserved');}};
  const getStackData=e=>{const v=getEnabledElement(e).viewport;return v.type==='stack'&&!v.isDisabled?{imageIds:v.imageIds,currentImageIdIndex:v.index||0}:null;};
  const addToolState=(e,s)=>states.set(e,s),getToolState=e=>states.get(e);
  const clearFromImageIds=stack=>q=>q.type!=='prefetch'||!stack.imageIds.includes(q.additionalDetails.imageId);
  const getPromiseRemovedHandler=e=>()=>{const s=states.get(e);if(s)s.indicesToRequest.push(1);};
  let source=fs.readFileSync(path.join(__dirname,'test-fixtures/stackContextPrefetch-4.15.29.js'),'utf8').replaceAll('\r\n','\n');
  if(configurator.patchStackContextPrefetch)source=configurator.patchStackContextPrefetch(source);
  source=source.replace(/^import .*;\n/gm,'').replace('export default stackContextPrefetch;','return stackContextPrefetch;');
  const prefetch=new Function('getEnabledElement','imageLoader','Enums','eventTarget','imageLoadPoolManager','cache','metaData','utilities','triggerEvent','addToolState','getToolState','getStackData','requestType','clearFromImageIds','getPromiseRemovedHandler','Events',source)(
    getEnabledElement,imageLoader,{Events:events},eventTarget,pool,cache,{get:()=>({})},{imageRetrieveMetadataProvider:{IMAGE_RETRIEVE_CONFIGURATION:'retrieve'}},()=>{},addToolState,getToolState,getStackData,'prefetch',clearFromImageIds,getPromiseRemovedHandler,{STACK_PREFETCH_COMPLETE:'complete'});
  function viewport(id='viewport',series='A',generation=1){const e=new EventTarget(),v={id,element:e,type:'stack',isDisabled:false};enabled.set(e,v);select(v,series,generation);return v;}
  function select(v,series,generation){v.imageIds=Array.from({length:800},(_,i)=>`${series}:${i}`);v._risproSelectionGeneration=generation;v._risproSelectionOwner={generation,displaySetInstanceUIDs:[series]};v._risproDisplaySetInstanceUIDs=[series];}
  const dispatch=q=>{rows=rows.filter(r=>r!==q);return q.requestFn();};
  const resolve=id=>loads.get(id).resolve({pixels:new Uint16Array([17,4095])});
  return {prefetch,viewport,select,pool,cache,states,enabled,events,eventTarget,imageLoader,loads,cached,
    rows:()=>rows,dispatch,resolve,downloads:()=>downloads,aborts:()=>aborts};
}

test('A to B retires only A stack jobs; active MPR and unrelated viewport jobs survive',()=>{
  const f=fixture(),a=f.viewport(),other=f.viewport('other','A',1);
  f.prefetch.enable(a.element);const oldJobs=[...f.rows()];
  f.prefetch.enable(other.element);const otherJobs=f.rows().filter(q=>!oldJobs.includes(q));
  assert.ok(oldJobs.every(q=>f.rows().includes(q)),'Enabling another same-image viewport must not clear the first viewport queue');
  const mpr=()=>{},otherConsumer=()=>{};
  f.pool.addRequest(mpr,'prefetch',{volumeId:'active-mpr'},0);
  f.pool.addRequest(otherConsumer,'prefetch',{imageId:'A:1'},0);
  f.select(a,'B',2);f.prefetch.enable(a.element);
  assert.ok(oldJobs.every(q=>!f.rows().includes(q)),'No queued jobs from A may remain behind its retired selection');
  assert.ok(otherJobs.every(q=>f.rows().includes(q)),'Same-image prefetch owned by another viewport remains valid');
  assert.ok(f.rows().some(q=>q.requestFn===mpr));assert.ok(f.rows().some(q=>q.requestFn===otherConsumer));
  assert.ok(f.rows().some(q=>q.additionalDetails.imageId==='B:1'));
});

test('stack to MPR on the same series retires the old queue and promptly processes the volume',()=>{
  const f=fixture(),v=f.viewport();f.prefetch.enable(v.element);const stackJobs=[...f.rows()];let processed=0;
  f.pool.addRequest(()=>{processed++;},'prefetch',{volumeId:'same-series-volume'},0);
  v.type='orthographic';f.prefetch.disable(v.element);
  assert.ok(stackJobs.every(q=>!f.rows().includes(q)),'Mode changes must retire queued stack work even when image IDs are unchanged');
  f.dispatch(f.rows()[0]);assert.equal(processed,1,'Active volume work must dispatch before any obsolete stack work');
});

test('late completion after retirement preserves shared pixels and cannot bulk-fill or mutate a new selection',async()=>{
  const f=fixture(),v=f.viewport();f.prefetch.enable(v.element);const pending=f.rows()[0],p=f.dispatch(pending),id=pending.additionalDetails.imageId;
  const shared=f.imageLoader.loadAndCacheImage(id),oldState=f.states.get(v.element);
  f.select(v,'B',2);f.prefetch.enable(v.element);const newerState=f.states.get(v.element),newJobs=[...f.rows()];
  assert.notEqual(newerState,oldState,'Each generation must have its own prefetch state');
  const before=JSON.stringify({...newerState,stats:undefined});
  f.resolve(id);await p;const pixels=await shared;
  assert.deepEqual(pixels.pixels,new Uint16Array([17,4095]));assert.equal(f.downloads(),1);assert.equal(f.aborts(),0);
  assert.equal(f.cached.has(id),true);assert.deepEqual(f.rows(),newJobs,'Retired completion must not schedule cache fill or remove new queued work');
  assert.equal(JSON.stringify({...newerState,stats:undefined}),before);
});

test('A to B to A cannot revive the first A generation or remove a newer same-key job',async()=>{
  const f=fixture(),v=f.viewport();f.prefetch.enable(v.element);const old=f.rows()[0],p=f.dispatch(old),id=old.additionalDetails.imageId;
  const firstOwner=v._risproStackPrefetchOwner;
  f.select(v,'B',2);f.prefetch.enable(v.element);f.select(v,'A',3);f.prefetch.enable(v.element);
  const newest=v._risproStackPrefetchOwner,newJobs=[...f.rows()];
  assert.notEqual(newest,firstOwner);assert.equal(firstOwner?.retired,true);
  f.resolve(id);await p;assert.deepEqual(f.rows(),newJobs);assert.equal(newest.retired,false);assert.equal(newest.generation,3);
});

test('disable safely retires an owner after its element has been detached',()=>{
  const f=fixture(),v=f.viewport();f.prefetch.enable(v.element);const owner=v._risproStackPrefetchOwner;
  f.enabled.delete(v.element);assert.doesNotThrow(()=>f.prefetch.disable(v.element));
  assert.equal(f.rows().length,0);assert.equal(owner.retired,true);
});

test('recreating a viewport after recovery starts a fresh prefetch owner for the retained selection',()=>{
  const f=fixture(),old=f.viewport();f.prefetch.enable(old.element);const retired=old._risproStackPrefetchOwner;
  retired.retire();const replacement={...old,_risproStackPrefetchOwner:undefined};
  replacement._risproSelectionOwner={...old._risproSelectionOwner};f.enabled.set(old.element,replacement);
  f.prefetch.enable(replacement.element);
  assert.notEqual(replacement._risproStackPrefetchOwner,retired);assert.equal(replacement._risproStackPrefetchOwner.generation,1);
  assert.ok(f.rows().length>0);assert.equal(retired.retired,true);
});

test('a retired image-update timer cannot restart prefetch in a later generation',async()=>{
  const f=fixture(),v=f.viewport();f.prefetch.enable(v.element);v.element.dispatchEvent(new Event(f.events.STACK_NEW_IMAGE));
  f.prefetch.disable(v.element);f.select(v,'A',2);const before=f.rows().length;
  await new Promise(r=>setTimeout(r,15));assert.equal(f.rows().length,before);assert.equal(f.states.get(v.element).enabled,false);
});

test('active stack completion retains upstream bulk-prefetch behavior',async()=>{
  const f=fixture(),v=f.viewport();f.prefetch.enable(v.element);const initial=[...f.rows()],promises=initial.map(q=>f.dispatch(q));
  for(const q of initial)f.resolve(q.additionalDetails.imageId);await Promise.all(promises);
  assert.ok(f.rows().length>700,'The current stack must still fill the valid image cache');
});

test('a new owner resumes bulk prefetch when its initial neighbours are already cached',()=>{
  const f=fixture(),v=f.viewport();
  for(const id of ['A:0','A:1','A:2'])f.cached.set(id,{pixels:new Uint16Array([17])});
  f.prefetch.enable(v.element);
  assert.ok(f.rows().length>700,'Retiring the old queue must not strand uncached frames on return to a partially cached stack');
  assert.equal(f.downloads(),0,'Cached neighbours must not be downloaded again');
});

test('retired cache listeners cannot mutate the replacement selection twice',()=>{
  const f=fixture(),v=f.viewport();f.prefetch.enable(v.element);f.select(v,'B',2);f.prefetch.enable(v.element);
  const state=f.states.get(v.element),before=state.indicesToRequest.length;
  f.eventTarget.dispatchEvent(new Event(f.events.IMAGE_CACHE_IMAGE_REMOVED));
  assert.equal(state.indicesToRequest.length,before+1,'Only the current owner may handle cache removal');
});

test('image-update timers for unrelated active viewports remain independent',async()=>{
  const f=fixture(),a=f.viewport('a'),b=f.viewport('b','B');f.prefetch.enable(a.element);f.prefetch.enable(b.element);
  a.index=10;b.index=20;a.element.dispatchEvent(new Event(f.events.STACK_NEW_IMAGE));b.element.dispatchEvent(new Event(f.events.STACK_NEW_IMAGE));
  await new Promise(r=>setTimeout(r,15));assert.equal(f.states.get(a.element).currentImageIdIndex,10);assert.equal(f.states.get(b.element).currentImageIdIndex,20);
});
