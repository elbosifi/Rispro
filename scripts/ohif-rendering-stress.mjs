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
      engines:core?.getRenderingEngines().map(e=>({id:e.id,viewports:e.getViewports().map(v=>({type:v.type,images:v.getImageIds?.().length}))})),
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

async function capture(page,context,apiOrigin,c){
  const report=page.getByRole('button',{name:'Report',exact:true}).first();
  if(!await report.count())return false; // Original image has no reporting extension.
  await report.click();
  const panel=page.getByRole('region',{name:'RISpro report'});
  const create=panel.getByRole('button',{name:'Create RISpro Report',exact:true});
  if(await create.count())await create.click();
  await panel.getByRole('button',{name:'Report',exact:true}).click();
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
  const results=[];
  // Fresh pages in one browser exercise tab teardown and retained GPU resources.
  for(const includePriors of [false,true]){
    const context=await browser.newContext({viewport:{width:1600,height:1000},storageState:await sourceContext.storageState(),ignoreHTTPSErrors:true});
    await context.addInitScript(installRenderingProbe);
    if(process.env.OHIF_BOOTSTRAP_NULL_SCRIPT==='1')await context.addInitScript(()=>Object.defineProperty(document,'currentScript',{get:()=>null}));
    try{for(let repetition=0;repetition<2;repetition++){
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
      await page.goto(viewerUrl.href,{waitUntil:'domcontentloaded',timeout:60000});
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
      console.log(JSON.stringify({renderingStress:stage,status:'PASS',stackChanges:6,seriesSwitchMs,mprActivations:3,stackCapture,cacheBytes:final.cacheBytes,volumes:final.volumes.length,contexts:final.probe.contexts.length}));
    }catch(error){
      writeFileSync(join(temp,stage+'-failure.json'),JSON.stringify({network,errors,warnings,state:await snapshot(page).catch(e=>({error:e.message}))},null,2));
      await page.screenshot({path:join(temp,stage+'-failure.png')}).catch(()=>undefined);
      throw error;
    }finally{await page.close();}
    }}finally{await context.close();}
  }
  console.log('PASS: synthetic large MRI stack/MPR/MIP, repeated series and multi-prior rendering regression');
  return results;
}
