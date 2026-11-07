// Observer for disposable synthetic browser diagnostics only. Never emits image
// IDs, URLs, volume IDs, pixels, credentials, or metadata. Times are monotonic.
export function installMprFrameProbe() {
  const images=new Map(),volumes=new Map(),jobs=new WeakMap(),details=new WeakMap(),errors=[],sources=[],sourceKeys=new Map();
  const now=()=>Math.round(performance.now()),limit=4000;
  let core,activation=null,snapshots=[],sequence=0,decodeRecord;
  const errorInfo=e=>({name:e?.name||'Error',code:typeof e?.code==='number'?e.code:undefined});
  const canonical=id=>{if(typeof id==='string'&&id.startsWith('wadors:')){try{return 'wadors:'+new URL(id.slice(7),location.href).href;}catch{}}return id;};
  const image=raw=>{const id=canonical(raw);if(!id||images.size>=limit&&!images.has(id))return;let r=images.get(id);if(!r){r={stages:{},failures:[],cancellations:0};images.set(id,r);}return r;};
  const stage=(r,name,extra={})=>{if(!r)return;const t=now(),s=r.stages[name]||{first:t,count:0};Object.assign(s,{last:t,count:s.count+1},extra);r.stages[name]=s;r.lastTransition=t;};
  const findUrl=url=>{try{return 'wadors:'+new URL(url,location.href).href;}catch{return null;}};
  const safeFailure=(r,name,e)=>{if(!r)return;stage(r,name,errorInfo(e));if(r.failures.length<12)r.failures.push({ms:now(),stage:name,...errorInfo(e)});};
  const observePromise=(p,yes,no)=>{if(p?.then)p.then(yes,no);return p;};
  const wrap=(o,k,f)=>{if(!o||typeof o[k]!=='function'||o[k].__mprFrameProbe)return;const original=o[k],replacement=f(original);replacement.__mprFrameProbe=true;o[k]=replacement;};
  const sharedSeen=new WeakSet(),consumersSeen=new WeakSet();
  const observeShared=(id,load)=>{
    const shared=load?._risproSharedLoad,r=image(id);if(!shared||!r)return;
    if(!sharedSeen.has(shared)){sharedSeen.add(shared);wrap(shared,'cancelFn',original=>function(...a){stage(r,'underlying-cancel');return original.apply(this,a);});}
    for(const consumer of shared.consumers||[])if(!consumersSeen.has(consumer)){
      consumersSeen.add(consumer);wrap(consumer,'cancelFn',original=>function(...a){r.cancellations++;stage(r,'consumer-cancel');return original.apply(this,a);});
    }
  };
  const attachVolume=v=>{
    if(!v?.imageIds||volumes.has(v.volumeId))return v;
    const row={number:++sequence,v,frames:v.imageIds.map((id,index)=>({index,r:image(id)})),transitions:[]};volumes.set(v.volumeId,row);
    const recordStatus=()=>{const status={loaded:!!v.loadStatus?.loaded,loading:!!v.loadStatus?.loading,cancelled:!!v.loadStatus?.cancelled};const key=JSON.stringify(status);if(key!==row.lastStatus){row.lastStatus=key;row.transitions.push({ms:now(),...status});}};
    row.recordStatus=recordStatus;recordStatus();
    wrap(v,'getImageIdsRequests',original=>function(...a){const requests=original.apply(this,a);for(const q of requests){const r=image(q.imageId);details.set(q.additionalDetails,{r,row,index:q.imageIdIndex});}return requests;});
    wrap(v,'load',original=>function(...a){row.loadCalls=(row.loadCalls||0)+1;row.loadAt=now();const p=original.apply(this,a);recordStatus();return p;});
    wrap(v,'cancelLoading',original=>function(...a){row.cancelAt=now();const p=original.apply(this,a);recordStatus();return p;});
    wrap(v,'callLoadImage',original=>function(id,index,...a){const r=image(id);stage(r,'volume-request-dispatched');const p=original.call(this,id,index,...a);observeShared(id,core.cache._imageCache.get(id)?.imageLoadObject);return observePromise(p,()=>stage(r,'volume-request-settled'),e=>safeFailure(r,'volume-request-rejected',e));});
    wrap(v,'successCallback',original=>function(id,pixels,...a){const r=image(id),before=this.framesProcessed;stage(r,'volume-callback',{quality:pixels?.imageQualityStatus});try{const out=original.call(this,id,pixels,...a);if(this.framesProcessed>before)stage(r,'processed');recordStatus();return out;}catch(e){safeFailure(r,'volume-callback-throw',e);throw e;}});
    wrap(v,'errorCallback',original=>function(id,permanent,e,...a){const shifted=typeof id==='number'&&typeof permanent==='string',r=image(shifted?permanent:id);stage(r,permanent?'volume-permanent-error':'volume-transient-error',{...errorInfo(e),argumentMismatch:shifted});const out=original.call(this,id,permanent,e,...a);recordStatus();return out;});
    return v;
  };
  const poolStats=(pool,active)=>{
    const out={queued:0,activeVolumeQueued:0,activeVolumeOwned:0,activeImagesOtherOwner:0,otherVolumeQueued:0,otherImageQueued:0,byType:{},bySource:{},inFlight:{...pool?.numRequests},max:{...pool?.maxNumRequests},awake:pool?.awake,grabDelay:pool?.grabDelay};
    for(const [type,priorities]of Object.entries(pool?.getRequestPool?.()||{}))for(const [priority,list]of Object.entries(priorities)){
      out.byType[type+':'+priority]=list.length;out.queued+=list.length;
      for(const q of list){const own=jobs.get(q.requestFn)||details.get(q.additionalDetails),id=q.additionalDetails?.imageId,vol=q.additionalDetails?.volumeId;
        if(own?.source!=null)out.bySource[own.source]=(out.bySource[own.source]||0)+1;
        if(active&&(own?.row===active||vol===active.v.volumeId)){out.activeVolumeQueued++;out.activeVolumeOwned++;}
        else if(active&&active.v.imageIds.includes(id)){out.activeVolumeQueued++;out.activeImagesOtherOwner++;}
        else if(vol||own?.row)out.otherVolumeQueued++;else out.otherImageQueued++;
      }
    }return out;
  };
  const activeVolume=()=>{
    try{const s=window.services;for(const id of s?.viewportGridService.getState().viewports.keys()||[]){const v=s.cornerstoneViewportService.getCornerstoneViewport(id);const vid=v?.getVolumeId?.();if(vid)return volumes.get(vid)||((attachVolume(core.cache.getVolume(vid))),volumes.get(vid));}}catch{}return null;
  };
  const queuesFor=r=>{
    if(!r)return [];
    const found=[];for(const [name,pool]of [['load',core?.imageLoadPoolManager],['retrieval',core?.imageRetrievalPoolManager]])for(const [type,priorities]of Object.entries(pool?.getRequestPool?.()||{}))for(const [priority,list]of Object.entries(priorities))for(const q of list){const own=jobs.get(q.requestFn)||details.get(q.additionalDetails);if(own?.r===r||image(q.additionalDetails?.imageId)===r)found.push({pool:name,type,priority:Number(priority),owner:own?.row?.number??'image',source:own?.source});}return found;
  };
  const snapshot=(label,full=false)=>{
    const active=activeVolume(),q=core?.Enums?.ImageQualityStatus?.FULL_RESOLUTION??8;
    const data={label,ms:now(),sinceActivation:activation==null?null:now()-activation,activeVolume:active?.number??null,observerErrors:errors.slice(),sources:structuredClone(sources),volumes:[],pools:{load:poolStats(core?.imageLoadPoolManager,active),retrieval:poolStats(core?.imageRetrievalPoolManager,active),worker:poolStats(core?.getWebWorkerManager?.()?.workerPoolManager,active)}};
    for(const row of volumes.values()){
      const v=row.v;row.recordStatus();const pending=[],frames=[];let fullResolution=0,failed=0,canceled=0;
      for(const {index,r}of row.frames){const complete=v.cachedFrames?.[index]===q;if(complete)fullResolution++;if(r?.stages['volume-permanent-error'])failed++;if(r?.cancellations)canceled++;
        const cached=core.cache._imageCache.get(v.imageIds[index]),load=cached?.imageLoadObject;observeShared(v.imageIds[index],load);
        const item={index,fullResolution:complete,cachedImageLoaded:!!cached?.loaded,stages:structuredClone(r?.stages||{}),lastTransition:r?.lastTransition??null,cancellations:r?.cancellations||0,failures:structuredClone(r?.failures||[]),queues:complete?[]:queuesFor(r),shared:load?._risproSharedLoad?{consumers:load._risproSharedLoad.consumers.size,settled:load._risproSharedLoad.settled,aborted:load._risproSharedLoad.aborted}:null};
        if(!complete)pending.push(item);if(full)frames.push(item);
      }
      data.volumes.push({number:row.number,active:row===active,totalNumFrames:v.totalNumFrames,framesLoaded:v.framesLoaded,framesProcessed:v.framesProcessed,framesUpdated:v.framesUpdated,fullResolution,pending:pending.length,failed,canceled,loadCalls:row.loadCalls,loadAt:row.loadAt,loadStatus:{loaded:v.loadStatus?.loaded,loading:v.loadStatus?.loading,cancelled:v.loadStatus?.cancelled},transitions:structuredClone(row.transitions),pendingFrames:pending,frames:full?frames:undefined});
    }return data;
  };
  window.__mprFrameProbe={activate(){activation=now();snapshots=[];return snapshot('activation');},snapshot,history:()=>snapshots};
  const fetchOriginal=window.fetch;
  window.fetch=function(input,...a){const url=typeof input==='string'?input:input?.url,id=String(url).includes('/frames/')?findUrl(url):null,r=image(id);if(r)stage(r,'transport-dispatched');const p=fetchOriginal.call(this,input,...a);observePromise(p,response=>{
    if(!r)return;const length=Number(response.headers.get('content-length'));let readBytes=0;stage(r,'transport-headers',{status:response.status,contentLength:length||null});
    if(response.body)wrap(response.body,'getReader',original=>function(...b){const reader=original.apply(this,b);wrap(reader,'read',read=>function(...c){const out=read.apply(this,c);return observePromise(out,value=>{readBytes+=value.value?.byteLength||0;if(value.done||length>0&&readBytes>=length)stage(r,'transport-completed',{readBytes});else stage(r,'transport-chunk',{readBytes});},e=>safeFailure(r,'transport-failed',e));});return reader;});
    for(const name of ['arrayBuffer','blob'])wrap(response,name,original=>function(...b){return observePromise(original.apply(this,b),()=>stage(r,'transport-completed'),e=>safeFailure(r,'transport-failed',e));});
  },e=>safeFailure(r,e?.name==='AbortError'?'transport-canceled':'transport-failed',e));return p;};
  const open=XMLHttpRequest.prototype.open,send=XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open=function(method,url,...a){this.__mprFrameId=String(url).includes('/frames/')?findUrl(url):null;return open.call(this,method,url,...a);};
  XMLHttpRequest.prototype.send=function(...a){const r=image(this.__mprFrameId);if(r){stage(r,'transport-dispatched');this.addEventListener('load',()=>stage(r,'transport-completed',{status:this.status}),{once:true});this.addEventListener('abort',()=>stage(r,'transport-canceled'),{once:true});this.addEventListener('error',()=>stage(r,'transport-failed'),{once:true});}return send.apply(this,a);};
  const NativeWorker=window.Worker;
  window.Worker=new Proxy(NativeWorker,{construct(target,args){const worker=Reflect.construct(target,args);for(const name of ['error','messageerror'])worker.addEventListener(name,()=>{if(errors.length<30)errors.push({ms:now(),stage:'worker-'+name});});return worker;}});
  const install=()=>{
    core=window.cornerstone;if(!core||core.cache.__mprFrameProbe)return;
    core.cache.__mprFrameProbe=true;
    wrap(core.cache,'putVolumeLoadObject',original=>function(id,load,...a){observePromise(load.promise,attachVolume,e=>{if(errors.length<30)errors.push({ms:now(),stage:'volume-create-failed',...errorInfo(e)});});return original.call(this,id,load,...a);});
    wrap(core.cache,'getVolume',original=>function(...a){return attachVolume(original.apply(this,a));});
    wrap(core.cache,'putImageLoadObject',original=>function(id,load,...a){const r=image(id);stage(r,'image-loader-start');observeShared(id,load);observePromise(load.promise,()=>stage(r,'image-loader-resolved'),e=>safeFailure(r,'image-loader-rejected',e));return original.call(this,id,load,...a);});
    for(const [name,pool]of [['load',core.imageLoadPoolManager],['retrieval',core.imageRetrievalPoolManager]]){
      wrap(pool,'addRequest',original=>function(fn,type,extra,priority=0){const own={...(details.get(extra)||{r:image(extra?.imageId),row:volumes.get(extra?.volumeId)})},key=[name,type,priority,own.row?'volume':'image',fn.name].join(':');let source=sourceKeys.get(key);if(source==null&&sources.length<30){source=sources.length;sourceKeys.set(key,source);sources.push({key,stack:new Error().stack.replace(/https?:\/\/[^\s)]+/g,url=>'<bundle>'+(/:\d+:\d+$/.exec(url)?.[0]||'')),dispatches:0,syncMs:0,maxSyncMs:0,asyncMs:0,maxAsyncMs:0});}own.source=source;stage(own.r,name+'-queued',{type,priority,source});const wrapped=function(...a){const t=performance.now(),s=sources[source];if(s){s.dispatches++;s.lastDispatch=now();}stage(own.r,name+'-dispatched',{type,priority,source});let p;try{p=fn.apply(this,a);}finally{if(s){const duration=performance.now()-t;s.syncMs+=duration;s.maxSyncMs=Math.max(s.maxSyncMs,duration);}}observePromise(p,()=>{stage(own.r,name+'-job-settled',{source});if(s){const duration=performance.now()-t;s.asyncMs+=duration;s.maxAsyncMs=Math.max(s.maxAsyncMs,duration);}},e=>safeFailure(own.r,name+'-job-rejected',e));return p;};jobs.set(wrapped,own);return original.call(this,wrapped,type,extra,priority);});
      wrap(pool,'filterRequests',original=>function(predicate){return original.call(this,q=>{const keep=predicate(q);if(!keep){const own=jobs.get(q.requestFn)||details.get(q.additionalDetails);stage(own?.r,name+'-queue-removed');}return keep;});});
    }
    const manager=core.getWebWorkerManager?.();
    wrap(manager?.workerPoolManager,'addRequest',original=>function(fn,type,extra,priority=0){const r=decodeRecord;stage(r,'decode-worker-queued',{type,priority});const wrapped=function(...a){stage(r,'decode-worker-dispatched');return fn.apply(this,a);};jobs.set(wrapped,{r});return original.call(this,wrapped,type,extra,priority);});
    wrap(manager,'executeTask',original=>function(worker,method,args,...a){const r=image(args?.imageFrame?.imageId||args?.options?.additionalDetails?.imageId),previous=decodeRecord;if(method==='decodeTask')stage(r,'decode-submitted');let p;decodeRecord=r;try{p=original.call(this,worker,method,args,...a);}finally{decodeRecord=previous;}return observePromise(p,()=>{if(method==='decodeTask')stage(r,'decoded');},e=>safeFailure(r,'decode-failed',e));});
    const ev=core.Enums.Events;core.eventTarget.addEventListener(ev.IMAGE_LOADED,e=>stage(image(e.detail?.image?.imageId),'image-loaded',{quality:e.detail?.image?.imageQualityStatus}));
    for(const v of core.cache.getVolumes())attachVolume(v);
  };
  setInterval(()=>{try{install();for(const row of volumes.values())row.recordStatus();if(activation!=null){const elapsed=now()-activation;for(const t of [10000,30000,60000,110000])if(elapsed>=t&&!snapshots.some(s=>s.label===String(t))){snapshots.push(snapshot(String(t)));}}}catch(e){if(errors.length<30)errors.push({ms:now(),stage:'observer',...errorInfo(e)});}},100);
}
