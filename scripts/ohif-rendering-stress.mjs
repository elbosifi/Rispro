// Synthetic-only large MRI regression, invoked by ohif-native-reporting-browser.mjs.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';

export function installRenderingProbe(){
  const events=[],contexts=[],seen=new WeakSet(),requestedLoss=new WeakSet();
  window.__renderProbe={events,contexts,snapshot:()=>contexts.map(ref=>ref.deref()).filter(Boolean).map(gl=>({lost:gl.isContextLost(),renderer:gl.getParameter(gl.RENDERER)}))};
  const record=(type,extra={})=>events.push({type,ms:Math.round(performance.now()),...extra});
  const getContext=HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext=function(...args){
    const gl=getContext.apply(this,args);
    if(gl && /^(webgl2?|experimental-webgl)$/.test(args[0]) && !seen.has(gl)){
      seen.add(gl);contexts.push(new WeakRef(gl));
      const id=contexts.length;
      const getExtension=gl.getExtension.bind(gl);
      gl.getExtension=function(name){
        const extension=getExtension(name);
        if(name==='WEBGL_lose_context'&&extension&&!extension.__probeWrapped){
          const lose=extension.loseContext.bind(extension);extension.__probeWrapped=true;
          extension.loseContext=()=>{requestedLoss.add(gl);record('context-disposal-requested',{id});return lose();};
        }
        return extension;
      };
      const debug=gl.getExtension('WEBGL_debug_renderer_info');
      record('context-created',{id,renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),maxTexture3D:gl.getParameter(gl.MAX_3D_TEXTURE_SIZE||gl.MAX_TEXTURE_SIZE)});
      this.addEventListener('webglcontextlost',()=>record('context-lost',{id,requested:requestedLoss.has(gl)}));
      this.addEventListener('webglcontextrestored',()=>record('context-restored',{id}));
    }
    return gl;
  };
  // Observe the actual compile/link result without swallowing errors, changing
  // source, consuming getError(), or retaining GPU objects strongly.
  for(const proto of [window.WebGLRenderingContext?.prototype,window.WebGL2RenderingContext?.prototype].filter(Boolean)){
    for(const [name,check,status] of [['compileShader','getShaderParameter','COMPILE_STATUS'],['linkProgram','getProgramParameter','LINK_STATUS']]){
      const original=proto[name];
      proto[name]=function(object){
        const result=original.call(this,object);
        if(!this[check](object,this[status]))record(name+'-failed',{contextLost:this.isContextLost(),info:name==='compileShader'?this.getShaderInfoLog(object):this.getProgramInfoLog(object)});
        return result;
      };
    }
    const allocate=proto.texStorage3D;
    if(allocate)proto.texStorage3D=function(target,levels,format,width,height,depth){record('texture3D-allocation',{width,height,depth,format,contextLost:this.isContextLost()});return allocate.apply(this,arguments);};
    const image3D=proto.texImage3D;
    if(image3D)proto.texImage3D=function(target,level,format,width,height,depth){record('texture3D-allocation',{width,height,depth,format,contextLost:this.isContextLost()});return image3D.apply(this,arguments);};
  }
  window.addEventListener('error',event=>record('error',{message:event.message}));
  window.addEventListener('unhandledrejection',event=>record('rejection',{message:String(event.reason?.message||event.reason)}));
  for(const type of ['CORNERSTONE_IMAGE_LOAD_ERROR','CORNERSTONE_VOLUME_LOADED','CORNERSTONE_VOLUME_VIEWPORT_NEW_VOLUME'])document.addEventListener(type,()=>record(type),true);
}

async function snapshot(page){
  return page.evaluate(()=>{
    const core=window.cornerstone,s=window.services;
    return {probe:{events:window.__renderProbe.events,contexts:window.__renderProbe.snapshot()},
      configuration:core?.getConfiguration(),cacheBytes:core?.cache.getCacheSize(),cacheLimit:core?.cache.getMaxCacheSize(),
      volumes:core?.cache.getVolumes().map(v=>({dimensions:v.dimensions,loaded:v.loadStatus.loaded,sourceBytes:v.dimensions.reduce((a,b)=>a*b,2)})),
      engines:core?.getRenderingEngines().map(e=>({id:e.id,contexts:e.contextPool?.getContextCount(),viewports:e.getViewports().map(v=>({type:v.type,images:v.getImageIds?.().length}))})),
      activeViewports:s?[...s.viewportGridService.getState().viewports.keys()].length:0};
  });
}

async function pixels(page,volume=false){
  await page.waitForFunction(volume=>{
    try{
    const s=window.services,core=window.cornerstone;
    if(!s)return false;
    const viewports=[...s.viewportGridService.getState().viewports.keys()].map(id=>s.cornerstoneViewportService.getCornerstoneViewport(id)).filter(Boolean);
    if(volume && (viewports.length!==3 || viewports.some(v=>!(v instanceof core.BaseVolumeViewport) || !core.cache.getVolume(v.getVolumeId())?.loadStatus.loaded)))return false;
    return viewports.length>0 && viewports.every(v=>{
      if(!v.canvas.width||!v.canvas.height)return false;
      const c=document.createElement('canvas');c.width=128;c.height=128;
      const ctx=c.getContext('2d');ctx.drawImage(v.canvas,0,0,128,128);
      const data=ctx.getImageData(0,0,128,128).data;let low=255,high=0;
      for(let i=0;i<data.length;i+=16){low=Math.min(low,data[i]);high=Math.max(high,data[i]);}
      return high-low>20;
    });
    }catch{return false;}
  },volume,{timeout:120000});
}

async function selectSeries(page,study,series){
  await page.evaluate(async({study,series})=>{
    const s=window.services;
    await window.commandsManager.runCommand('loadStudy',{StudyInstanceUID:study});
    const set=s.displaySetService.getActiveDisplaySets().find(d=>d.StudyInstanceUID===study&&d.SeriesInstanceUID===series);
    if(!set)throw Error('Synthetic series missing');
    window.commandsManager.runCommand('setDisplaySetsForViewports',{viewportsToUpdate:[{viewportId:s.viewportGridService.getActiveViewportId(),displaySetInstanceUIDs:[set.displaySetInstanceUID],viewportOptions:{viewportType:'stack'}}]});
  },{study,series});
  await page.waitForFunction(series=>{
    const s=window.services,v=s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());
    return v?.getCurrentImageId?.()?.includes('/series/'+series+'/');
  },series,{timeout:60000});
  await pixels(page);
}

async function selectSeriesWithoutWaiting(page,series,displaySetInstanceUID,direct=false){
  if(!displaySetInstanceUID)await page.waitForFunction(seriesUID=>window.services?.displaySetService.getDisplaySetsForSeries(seriesUID)?.length>0,series,{timeout:60000});
  await page.evaluate(({seriesUID,displaySetInstanceUID,direct})=>{
    const s=window.services,rows=s.viewportGridService.getState().viewports;
    let viewportId=s.viewportGridService.getActiveViewportId();
    if(!viewportId)viewportId=[...rows.keys()].find(id=>s.cornerstoneViewportService.getCornerstoneViewport(id));
    if(!viewportId)throw Error('No live viewport is ready for the synthetic series switch');
    if(s.viewportGridService.getActiveViewportId()!==viewportId)s.viewportGridService.setActiveViewportId(viewportId);
    let displaySet=displaySetInstanceUID?s.displaySetService.getDisplaySetByUID(displaySetInstanceUID):s.displaySetService.getDisplaySetsForSeries(seriesUID)?.[0];
    if(!displaySet&&window.__rapidMprDisplaySets?.[seriesUID]){
      displaySet=window.__rapidMprDisplaySets[seriesUID];
      s.displaySetService.addDisplaySets(displaySet);
    }
    if(!displaySet)throw Error('Synthetic rapid-switch display set missing');
    const row=s.viewportGridService.getState().viewports.get(viewportId);
    const update={viewportId,displaySetInstanceUIDs:[displaySet.displaySetInstanceUID],viewportOptions:row?.viewportOptions||{viewportType:'stack'},displaySetOptions:[{}]};
    if(direct)s.viewportGridService.setDisplaySetsForViewport(update);
    else window.commandsManager.runCommand('setDisplaySetsForViewports',{viewportsToUpdate:[update]});
  },{seriesUID:series,displaySetInstanceUID,direct});
  try{await page.waitForFunction(seriesUID=>{
    const s=window.services,id=s.viewportGridService.getActiveViewportId(),row=s.viewportGridService.getState().viewports.get(id);
    return row?.displaySetInstanceUIDs?.some(uid=>s.displaySetService.getDisplaySetByUID(uid)?.SeriesInstanceUID===seriesUID);
  },series,{timeout:30000});}
  catch(error){const state=await page.evaluate(()=>{const s=window.services;return [...s.viewportGridService.getState().viewports].map(([id,row])=>({id,row:row.displaySetInstanceUIDs,active:s.viewportGridService.getActiveViewportId(),type:s.cornerstoneViewportService.getCornerstoneViewport(id)?.type,sets:row.displaySetInstanceUIDs?.map(uid=>s.displaySetService.getDisplaySetByUID(uid)?.SeriesInstanceUID)}));});throw Error('Synthetic series selection did not apply: '+JSON.stringify(state),{cause:error});}
}

async function rapidLargeStackSwitch(page,c,network,navigate){
  const gated=[],frameResponses=new Map(),pendingFrames=new Set(),resourceSamples=[];
  const configuredCycles=Number(process.env.OHIF_RENDER_SWITCH_CYCLES||2);
  assert.ok(Number.isSafeInteger(configuredCycles)&&configuredCycles>0,'OHIF_RENDER_SWITCH_CYCLES must be a positive integer');
  let maxPendingFrames=0;
  const onFrameRequest=request=>{
    if(!request.url().includes('/frames/'))return;
    pendingFrames.add(request);maxPendingFrames=Math.max(maxPendingFrames,pendingFrames.size);
  };
  const onFrameSettled=request=>pendingFrames.delete(request);
  const onFrameResponse=response=>{
    const url=response.url();
    if(!url.includes('/frames/'))return;
    frameResponses.set(url,(frameResponses.get(url)||0)+1);
  };
  const hold=async route=>{
    const url=route.request().url(),series=decodeURIComponent(new URL(url).pathname).match(/\/series\/([^/]+)/)?.[1];
    const item={url,series,release:null};gated.push(item);
    await new Promise(resolve=>{item.release=resolve;});
    try{await route.continue();}catch{}
  };
  const release=()=>{for(const item of gated)item.release?.();};
  const sampleResources=async selectedSeries=>{
    const resource=await page.evaluate(selectedSeries=>{
      const core=window.cornerstone,s=window.services,engines=core.getRenderingEngines(),id=s.viewportGridService.getActiveViewportId(),row=s.viewportGridService.getState().viewports.get(id);
      return {selectedSeries:row?.displaySetInstanceUIDs?.map(uid=>s.displaySetService.getDisplaySetByUID(uid)?.SeriesInstanceUID).join(',')||null,
        contexts:engines.map(engine=>engine.contextPool?.getContextCount?.()||0),actors:engines.reduce((count,engine)=>count+engine.getViewports().reduce((sum,viewport)=>sum+viewport.getActors().length,0),0),
        volumes:core.cache.getVolumes().length,cacheBytes:core.cache.getCacheSize(),cacheLimit:core.cache.getMaxCacheSize()};
    },selectedSeries);
    resourceSamples.push({...resource,expectedSeries:selectedSeries,pendingFrameRequests:pendingFrames.size});
  };
  page.on('request',onFrameRequest);page.on('requestfinished',onFrameSettled);page.on('requestfailed',onFrameSettled);page.on('response',onFrameResponse);
  await page.route('**/frames/**',hold);
  try{
    const waitForGate=async(series,count=1)=>{
      const until=Date.now()+60000;
      while(Date.now()<until){if(gated.filter(item=>item.series===series).length>=count)return;await new Promise(resolve=>setTimeout(resolve,25));}
      throw Error('No gated large MRI frame request started for '+series);
    };
    await navigate();
    await waitForGate(c.study+'.1');
    await sampleResources(c.study+'.1');
    await page.evaluate(async study=>window.commandsManager.runCommand('loadStudy',{StudyInstanceUID:study}),c.study);
    try{await page.waitForFunction(study=>window.services?.displaySetService.getActiveDisplaySets().some(set=>set.SeriesInstanceUID===study+'.2'),c.study,{timeout:60000});}
    catch(error){const active=await page.evaluate(()=>window.services?.displaySetService.getActiveDisplaySets().map(set=>({series:set.SeriesInstanceUID,uid:set.displaySetInstanceUID}))||[]);throw Error('Synthetic series metadata did not become selectable; available display sets: '+JSON.stringify(active),{cause:error});}
    const firstFrame=gated.find(item=>item.series===c.study+'.1')?.url;
    let switches=0;
    for(let i=0;i<configuredCycles;i++){
      await selectSeriesWithoutWaiting(page,c.study+'.2');switches++;if(i===0)await waitForGate(c.study+'.2');await sampleResources(c.study+'.2');
      await selectSeriesWithoutWaiting(page,c.study+'.1');switches++;await sampleResources(c.study+'.1');
    }
    // Resize while the repeated selections are still waiting on frame data.
    await page.setViewportSize({width:1280,height:900});
    await page.setViewportSize({width:1600,height:1000});
    await selectSeriesWithoutWaiting(page,c.study+'.1');
    const outstanding=gated.length,pendingAtFinalSelection=pendingFrames.size;release();
    await page.unroute('**/frames/**',hold);
    const expectedPixel=700+Math.round(220*Math.sin((c.size/2)/19)+180*Math.cos((c.size/2)/23))+20;
    await page.waitForFunction(seriesUID=>{
      try{
        const s=window.services,id=s.viewportGridService.getActiveViewportId(),row=s.viewportGridService.getState().viewports.get(id);
        const ds=s.displaySetService.getDisplaySetByUID(row.displaySetInstanceUIDs[0]),v=s.cornerstoneViewportService.getCornerstoneViewport(id),image=v&&window.cornerstone.cache.getImage(v.getCurrentImageId());
        const pixels=image?.getPixelData?.();
        const canvas=document.createElement('canvas');canvas.width=canvas.height=64;const ctx=canvas.getContext('2d');ctx.drawImage(v.canvas,0,0,64,64);
        const data=ctx.getImageData(0,0,64,64).data;let low=255,high=0;for(let i=0;i<data.length;i+=4){low=Math.min(low,data[i]);high=Math.max(high,data[i]);}
        return ds?.SeriesInstanceUID===seriesUID&&pixels?.length===image.width*image.height&&high-low>20;
      }catch{return false;}
    },c.study+'.1',{timeout:120000});
    const pendingDeadline=Date.now()+10000;let stablePendingCount=-1,stablePendingSince=Date.now();
    while(Date.now()<pendingDeadline){
      if(pendingFrames.size!==stablePendingCount){stablePendingCount=pendingFrames.size;stablePendingSince=Date.now();}
      else if(Date.now()-stablePendingSince>=1000)break;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    const pendingAfterSettle=pendingFrames.size,pendingFramePaths=[...pendingFrames].map(request=>new URL(request.url()).pathname);
    const proof=await page.evaluate(()=>{
      const s=window.services,core=window.cornerstone,id=s.viewportGridService.getActiveViewportId(),row=s.viewportGridService.getState().viewports.get(id),v=s.cornerstoneViewportService.getCornerstoneViewport(id),image=core.cache.getImage(v.getCurrentImageId()),engine=v.getRenderingEngine();
      const instance=core.metaData.get('instance',v.getCurrentImageId())||{},instanceNumber=Number(instance.InstanceNumber||instance.instanceNumber||1);
      const expectedPixel=700+Math.round(220*Math.sin((image.width/2)/19)+180*Math.cos((image.height/2)/23))+20+((instanceNumber-1)%16)*8;
      return {series: s.displaySetService.getDisplaySetByUID(row.displaySetInstanceUIDs[0]).SeriesInstanceUID,
        pixel:image.getPixelData()[Math.floor(image.height/2)*image.width+Math.floor(image.width/2)],expectedPixel,instanceNumber,contexts:v.getRenderingEngine().contextPool.getContextCount(),
        decodedImageCached:core.cache.isLoaded(v.getCurrentImageId())&&!!image,
        contextLimit:core.getConfiguration().rendering.webGlContextCount,
        actors:engine.getViewports().reduce((count,viewport)=>count+viewport.getActors().length,0),
        volumes:core.cache.getVolumes().length,cacheBytes:core.cache.getCacheSize(),cacheLimit:core.cache.getMaxCacheSize()};
    });
    const copyCount=firstFrame?frameResponses.get(firstFrame)||0:0;
    const peak={contexts:Math.max(0,...resourceSamples.flatMap(sample=>sample.contexts)),actors:Math.max(0,...resourceSamples.map(sample=>sample.actors)),
      volumes:Math.max(0,...resourceSamples.map(sample=>sample.volumes)),cacheBytes:Math.max(0,...resourceSamples.map(sample=>sample.cacheBytes))};
    assert.equal(proof.series,c.study+'.1');assert.equal(proof.pixel,proof.expectedPixel,'Final selected series must contain its known synthetic diagnostic pixel');assert.ok(proof.contexts<=proof.contextLimit,'Rapid switching must stay within the existing WebGL context pool');
    assert.ok(proof.volumes<=2,'Only the two selected synthetic stack series may remain volume-cached');
    assert.ok(peak.contexts<=proof.contextLimit,'Rapid switching must never exceed the existing WebGL context pool');
    assert.ok(peak.volumes<=2,'Rapid switching must not retain more than the two selected synthetic MRI volumes');
    assert.ok(peak.cacheBytes<=proof.cacheLimit,'Rapid switching must respect Cornerstone image-cache capacity');
    assert.ok(resourceSamples.every(sample=>sample.selectedSeries===sample.expectedSeries),'Every sampled actor/cache state must belong to the currently selected series');
    assert.ok(outstanding>=2,'At least A and B frame requests must still be gated at selection changes');
    assert.ok(pendingAtFinalSelection>=2,'A and B image requests must still be pending at the final selection change');
    assert.ok(pendingAfterSettle<=maxPendingFrames,'Settled frame requests must not accumulate beyond the peak outstanding set during rapid switching');
    assert.equal(proof.decodedImageCached,true,'The final diagnostic pixels must come from the selected image cache entry');
    if(firstFrame)assert.ok(copyCount<=1,'Returning to A must not accumulate duplicate downloads for its first frame');
    network.push({type:'rapid-switch',status:200,rapidSwitches:switches,gatedFrames:outstanding,pendingAtFinalSelection,maxPendingFrames,pendingAfterSettle,pendingFramePaths,
      duplicateFirstFrameResponses:copyCount,seriesMatches:true,pixel:proof.pixel,expectedPixel:proof.expectedPixel,decodedImageCached:proof.decodedImageCached,
      contexts:proof.contexts,contextLimit:proof.contextLimit,actors:proof.actors,volumes:proof.volumes,cacheBytes:proof.cacheBytes,cacheLimit:proof.cacheLimit,
      peak,resourceSamples});
  }finally{release();await page.unroute('**/frames/**',hold).catch(()=>{});page.off('request',onFrameRequest);page.off('requestfinished',onFrameSettled);page.off('requestfailed',onFrameSettled);page.off('response',onFrameResponse);}
}

async function capture(page,context,apiOrigin,c){
  const report=page.getByRole('button',{name:'Report',exact:true}).first();
  if(!await report.count())return false; // Original image has no reporting extension.
  await report.click();
  const panel=page.getByRole('region',{name:'RISpro report'});
  const create=panel.getByRole('button',{name:'Create RISpro Report',exact:true});
  const reportTab=panel.getByRole('button',{name:'Report',exact:true});
  // Decide only after context/report hydration, not while the panel is loading.
  await create.or(reportTab).first().waitFor();
  if(await create.isVisible())await create.click();
  await reportTab.click();
  await panel.getByLabel('Findings',{exact:true}).fill('SYNTHETIC large MRI rendering regression.');
  await panel.getByRole('button',{name:'Save',exact:true}).click();
  await panel.getByRole('status').filter({hasText:/^Saved$/}).waitFor();
  const before=await(await context.request.get(apiOrigin+'/api/native-reporting/appointments/'+c.appointmentId)).json();
  await panel.getByRole('button',{name:/Key Images/}).click();
  await panel.getByRole('button',{name:'Add Key Image',exact:true}).click();
  await panel.getByAltText('Saved key image '+(before.report.keyImages.length+1)).waitFor({timeout:30000});
  return true;
}

export async function runRenderingStress({browser,context,c,origin,apiOrigin,temp,launch}){
  const sourceContext=context;
  writeFileSync(join(temp,'environment.json'),JSON.stringify({browser:browser.version(),channel:process.env.OHIF_RENDER_BROWSER||'chromium',image:process.env.OHIF_TEST_IMAGE,dimensions:[c.size,c.size,c.slices],https:new URL(origin).protocol==='https:',platform:process.platform},null,2));
  const gpuSession=await browser.newBrowserCDPSession();
  const gpu=await gpuSession.send('SystemInfo.getInfo');
  writeFileSync(join(temp,'gpu.json'),JSON.stringify(gpu.gpu,null,2));
  await gpuSession.detach();
  const results=[],sessionRepetitions=Number(process.env.OHIF_RENDER_SESSION_REPETITIONS||2);
  assert.ok(Number.isSafeInteger(sessionRepetitions)&&sessionRepetitions>0,'OHIF_RENDER_SESSION_REPETITIONS must be a positive integer');
  // Fresh pages in one browser exercise tab teardown and retained GPU resources.
  for(const includePriors of [false,true]){
    const context=await browser.newContext({viewport:{width:1600,height:1000},storageState:await sourceContext.storageState(),ignoreHTTPSErrors:true});
    await context.addInitScript(installRenderingProbe);
    if(process.env.OHIF_BOOTSTRAP_NULL_SCRIPT==='1')await context.addInitScript(()=>Object.defineProperty(document,'currentScript',{get:()=>null}));
    try{for(let repetition=0;repetition<sessionRepetitions;repetition++){
    const page=await context.newPage(),network=[],errors=[],warnings=[];
    const started=performance.now();
    const category=url=>url.includes('/frames/')?'frame':url.includes('/metadata')?'metadata':url.includes('/ohif-dicomweb/')?'qido':'asset';
    page.on('response',r=>{if(r.url().includes('/ohif-dicomweb/'))network.push({type:category(r.url()),status:r.status(),ms:Math.round(performance.now()-started),headersMs:Math.round(r.request().timing().responseStart),prior:r.url().includes(c.study+'.8')||r.url().includes(c.study+'.9'),patientQuery:new URL(r.url()).searchParams.has('00100020'),mime:r.headers()['content-type']?.replace(/boundary=.*/,'boundary=<redacted>')});});
    page.on('requestfailed',r=>network.push({type:category(r.url()),status:0,canceled:/abort|cancel/i.test(r.failure()?.errorText||'')}));
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(['warning','error'].includes(m.type()))warnings.push(m.text());});
    const stage=(includePriors?'priors':'single')+'-'+repetition;
    try{
      const prepared=await launch(includePriors);assert.equal(prepared.status,'ready');assert.equal(prepared.priorStudyCount,includePriors?2:0);
      const exchange=await context.request.get(apiOrigin+prepared.launchUrl,{maxRedirects:0});assert.equal(exchange.status(),302);
      // Include the legacy /ohif-dicomweb-scoped viewer cookie when comparing
      // pre-context images; filtering by the API root URL would omit that path.
      await context.addCookies((await context.cookies()).filter(cookie=>cookie.domain===new URL(apiOrigin).hostname).map(cookie=>({...cookie,domain:new URL(origin).hostname})));
      const viewerUrl=new URL(exchange.headers().location,origin);
      if(process.env.OHIF_RENDER_EAGER==='1'){
        viewerUrl.searchParams.set('StudyInstanceUIDs',[viewerUrl.searchParams.get('StudyInstanceUIDs'),viewerUrl.searchParams.get('risproPriorStudyUIDs')].filter(Boolean).join(','));
        viewerUrl.searchParams.delete('risproPriorStudyUIDs');
      }
      if(process.env.OHIF_RENDER_STRESS==='1'){
        await rapidLargeStackSwitch(page,c,network,()=>page.goto(viewerUrl.href,{waitUntil:'domcontentloaded',timeout:60000}));
      }else await page.goto(viewerUrl.href,{waitUntil:'domcontentloaded',timeout:60000});
      const ready=()=>page.waitForFunction(()=>{
        try{const s=window.services,id=s?.viewportGridService.getActiveViewportId();
          return Boolean(id&&s.cornerstoneViewportService.getCornerstoneViewport(id)?.getCurrentImageId?.());
        }catch{return false;}
      },null,{timeout:90000});
      await Promise.race([ready(),page.waitForEvent('pageerror',{predicate:e=>e.message.includes('__filename'),timeout:90000}).then(error=>{throw error;})]);
      for(const name of ['Skip all','Confirm and hide']){const button=page.getByText(name,{exact:true});if(await button.isVisible()){await button.click();await button.waitFor({state:'hidden'});}}
      await pixels(page);
      const firstPixelsMs=Math.round(performance.now()-started);
      const startup=await page.evaluate(()=>{const s=window.services,v=s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId()),set=s.displaySetService.getDisplaySetByUID(s.viewportGridService.getState().viewports.get(v.id).displaySetInstanceUIDs[0]);return {initialModality:set.Modality,initialFrames:set.numImageFrames,navigationMs:performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd,assetTransferBytes:performance.getEntriesByType('resource').filter(r=>r.name.includes('/ohif/')&&r.name.includes('.js')).reduce((n,r)=>n+r.transferSize,0)};});
      console.log(JSON.stringify({renderingStartup:{stage,firstPixelsMs,...startup,metadataBeforePixels:network.filter(n=>n.type==='metadata'),priorFramesBeforePixels:network.filter(n=>n.type==='frame'&&n.prior).length}}));
      await page.waitForFunction(()=>{const images=[...document.querySelectorAll('[data-cy="study-browser-thumbnail"][data-series="1"] img, [data-cy="study-browser-thumbnail"][data-series="2"] img')];return images.length===2&&images.every(image=>image.complete&&image.naturalWidth>0);},null,{timeout:30000});
      await selectSeries(page,c.study,c.study+'.1');
      const firstDiagnosticPixelsMs=Math.round(performance.now()-started);
      if(process.env.OHIF_RENDER_EXPECT_FIXED==='1'){
        assert.equal(startup.initialModality,'MR');assert.equal(startup.initialFrames,c.slices);
        assert.equal(network.filter(n=>n.patientQuery).length,0,'No patient-wide QIDO query');
        assert.equal(network.filter(n=>n.prior&&['frame','metadata'].includes(n.type)).length,0,'Priors load only after explicit selection');
      }
      await page.reload({waitUntil:'domcontentloaded'});await ready();await pixels(page);
      const cdp=await context.newCDPSession(page);await cdp.send('Page.reload',{ignoreCache:true});await page.waitForLoadState('domcontentloaded');await ready();await pixels(page);await cdp.detach();
      const initial=await snapshot(page);
      if(process.env.OHIF_TEST_CONTEXT_COUNT){const expected=Number(process.env.OHIF_TEST_CONTEXT_COUNT);assert.equal(initial.configuration.rendering.webGlContextCount,expected);assert.ok(initial.engines.some(e=>e.contexts===expected),'The experimental pool count must reach the real engine');}
      const seriesSwitchMs=[];
      for(let cycle=0;cycle<6;cycle++){
        const switching=performance.now();
        await selectSeries(page,c.study,c.study+'.'+(cycle%2+1));
        seriesSwitchMs.push(Math.round(performance.now()-switching));
        for(const index of [0,Math.floor(c.slices/2),c.slices-1]){
          await page.evaluate(async index=>{const s=window.services,v=s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());await v.setImageIdIndex(index);v.render();},index);
          await pixels(page);
        }
      }
      const stackCapture=await capture(page,context,apiOrigin,c);
      // Two live reading tabs share the browser's per-renderer WebGL budget.
      const peer=await context.newPage();
      try{
        await peer.goto(page.url(),{waitUntil:'domcontentloaded'});
        await pixels(peer);
        await page.evaluate(()=>{const s=window.services;s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId()).render();});
        await pixels(page);
      }finally{await peer.close();}
      const volumeSnapshots=[];
      for(let cycle=0;cycle<3;cycle++){
        await page.evaluate(()=>window.commandsManager.runCommand('setHangingProtocol',{protocolId:'mpr'}));
        await pixels(page,true);
        volumeSnapshots.push(await snapshot(page));
        // Exercise the real slab/MIP controls without changing source precision.
        await page.evaluate(()=>{const s=window.services,v=s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());v.setSlabThickness(12);v.setBlendMode(window.cornerstone.Enums.BlendModes.MAXIMUM_INTENSITY_BLEND);v.render();});
        await pixels(page,true);
        if(cycle===2)await capture(page,context,apiOrigin,c);
        await page.evaluate(()=>window.commandsManager.runCommand('setHangingProtocol',{protocolId:'default'}));
        await selectSeries(page,c.study,c.study+'.'+(cycle%2+1));
      }
      if(includePriors)for(const [study,series] of [[c.study+'.8',c.study+'.3'],[c.study+'.9',c.study+'.4']])await selectSeries(page,study,series);
      const final=await snapshot(page);
      const unexpected=network.filter(n=>!n.canceled&&(n.status===0||n.status>=400)&&!(n.type==='qido'&&n.status===403));
      assert.deepEqual(unexpected,[],'Unexpected metadata/frame/asset failure');
      assert.deepEqual(errors.filter(e=>!(process.env.OHIF_RENDER_EXPECT_FIXED!=='1'&&e.includes("reading 'getRegistrations'"))),[]);
      assert.deepEqual(warnings.filter(message=>/__filename|isAttributeUsed/.test(message)),[],'No logged bootstrap or VTK null-program exception');
      assert.equal(final.probe.events.filter(e=>e.type==='context-lost'&&!e.requested||e.type.endsWith('-failed')).length,0,'Unexpected GPU context loss or shader failure');
      const result={stage,firstPixelsMs,firstDiagnosticPixelsMs,seriesSwitchMs,startup,initial,volumeSnapshots,final,network,errors,warnings,stackCapture};results.push(result);
      writeFileSync(join(temp,stage+'.json'),JSON.stringify(result,null,2));
      await page.screenshot({path:join(temp,stage+'.png')});
      await page.evaluate(()=>{window.history.pushState({},'','/ohif/');window.dispatchEvent(new PopStateEvent('popstate'));});
      await page.waitForFunction(()=>window.cornerstone.cache.getVolumes().length===0&&window.cornerstone.cache.getCacheSize()===0&&!window.cornerstone.getRenderingEngines().some(e=>e.id==='OHIFCornerstoneRenderingEngine'&&e.getViewports().length),null,{timeout:10000});
       const rapid=network.find(item=>item.type==='rapid-switch');
       const resultSummary={renderingStress:stage,status:'PASS',rapidSwitches:rapid?.rapidSwitches||0,seriesSwitchMs,mprActivations:3,stackCapture,
         pendingAtFinalSelection:rapid?.pendingAtFinalSelection,pendingAfterSettle:rapid?.pendingAfterSettle,actors:rapid?.actors,volumes:rapid?.volumes,
         cacheBytes:rapid?.cacheBytes,cacheLimit:rapid?.cacheLimit,contexts:rapid?.contexts,contextLimit:rapid?.contextLimit,
         finalPixel:rapid?.pixel,expectedPixel:rapid?.expectedPixel};
       console.log(JSON.stringify(resultSummary));
    }catch(error){
      writeFileSync(join(temp,stage+'-failure.json'),JSON.stringify({network,errors,warnings,state:await snapshot(page).catch(e=>({error:e.message}))},null,2));
      await page.screenshot({path:join(temp,stage+'-failure.png')}).catch(()=>undefined);
      throw error;
    }finally{await page.close();}
    }}finally{await context.close();}
  }
  const rapidSwitches=results.reduce((count,result)=>count+(result.network.find(item=>item.type==='rapid-switch')?.rapidSwitches||0),0);
  assert.ok(results.length>4,`The soak must span more than four viewer sessions (received ${results.length})`);
  assert.ok(rapidSwitches>=50,`The soak must perform at least 50 rapid series switches (received ${rapidSwitches})`);
  writeFileSync(join(temp,'rapid-switch-soak.json'),JSON.stringify({sessionCount:results.length,rapidSwitches,sessionRepetitions,cyclesPerSession:Number(process.env.OHIF_RENDER_SWITCH_CYCLES||2),
    sessions:results.map(result=>{const rapid=result.network.find(item=>item.type==='rapid-switch');return {stage:result.stage,...rapid};})},null,2));
  console.log('PASS: synthetic large MRI stack/MPR/MIP, repeated series and multi-prior rendering regression');
  return results;
}
