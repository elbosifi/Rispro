// Synthetic-only startup races, using the production viewer and authenticated archive.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fixture, installProbe, waitPixels} from './ohif-native-benchmark.mjs';

export async function runStartupSelectionAcceptance(h) {
  const results=[];
  const save=()=>writeFileSync(join(h.temp,'startup-selection-results.json'),JSON.stringify(results,null,2));
  for(const c of h.cases) for(const series of [5,6]) await fixture(c,series,16,c.modality==='CT'?256:192,h.archiveRequest);
  for(const progressive of (process.env.OHIF_STARTUP_MODES||'ordinary,progressive').split(',').map(mode=>mode==='progressive')) for(const c of h.cases) for(const scenario of (process.env.OHIF_STARTUP_SCENARIOS||'delayed,failed,rapid').split(',')) {
    const page=await h.context.newPage(), errors=[]; let navigations=0;
    page.on('request',request=>{if(request.isNavigationRequest()&&request.frame()===page.mainFrame())navigations++;});
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(installProbe);
    await page.addInitScript(()=>{
      window.__startupDocument=document; window.__startupRejections=[];
      window.addEventListener('unhandledrejection',e=>window.__startupRejections.push(e.reason instanceof XMLHttpRequest
        ? JSON.stringify({status:e.reason.status,url:e.reason.responseURL}) : String(e.reason?.stack||e.reason)));
      const timer=setInterval(()=>{
        const cache=window.services?.cornerstoneCacheService;
        if(!cache)return; clearInterval(timer);
        const original=cache.createViewportData.bind(cache);
        cache.createViewportData=async(...args)=>{
          window.__startupDataSource=args[2];
          // Exercise a metadata completion older than a later C selection, too.
          if(window.__holdB && args[0][0]?.SeriesInstanceUID===window.__holdB) {
            window.__bPending=true;
            await new Promise(resolve=>{window.__releaseB=resolve;});
          }
          return original(...args);
        };
      },0);
    });
    // Enable the progressive control path independently of transport in this
    // synthetic test only. Leave all production request/profile settings intact.
    await page.route('**/app-config.js*',async route=>{
      const response=await route.fetch();
      await route.fulfill({response,body:await response.text()+`\nwindow.config.risproProgressiveLoading=${progressive};`});
    });
    let release, releaseDraft, held=0, completed=0;
    const draftBarrier=new Promise(resolve=>{releaseDraft=resolve;});
    const barrier=new Promise(resolve=>{release=resolve;});
    await page.route('**/frames/**',async route=>{
      if(!route.request().url().includes('/series/'+c.study+'.1/'))return route.continue();
      held++;
      const response=await route.fetch();
      await barrier;
      try {
        if(scenario==='failed')await route.fulfill({status:404,body:'Synthetic missing initial frame'});
        else await route.fulfill({response});
      } catch(error) { if(!page.isClosed())errors.push('harness response: '+error.message); } finally {completed++;}
    });
    try {
      const launch=await h.launch(c); assert.equal(launch.status,'ready');
      const exchanged=await h.context.request.get(h.origin+launch.launchUrl,{maxRedirects:0});
      assert.equal(exchanged.status(),302);
      const url=new URL(exchanged.headers().location,h.origin);
      url.searchParams.set('initialSeriesInstanceUID',c.study+'.1');
      await page.goto(url.href,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>window.__startupDataSource,null,{timeout:90000});
      for(let n=0;!held&&n<300;n++)await page.waitForTimeout(100);
      assert.ok(held,'initial diagnostic frame is pending before any manual selection');
      assert.equal(await page.evaluate(()=>window.__nativeBench.firstPixels),null,'no first diagnostic image rendered');
      // Progressive initialization deliberately defers other series metadata.
      // Publish B/C through the same authorized OHIF data source to make them
      // available in the real study browser before choosing either thumbnail.
      await page.evaluate(async study=>{
        const deferred=await window.__startupDataSource.retrieve.series.metadata({StudyInstanceUID:study,returnPromises:true});
        await Promise.all(deferred.filter(p=>[study+'.2',study+'.5'].includes(p.metadata.SeriesInstanceUID)).map(p=>p.start()));
        const s=window.services,v=s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());
        window.__startupIdentity={viewport:v,engine:v.getRenderingEngine(),canvas:v.canvas};
      },c.study);
      await page.getByRole('button',{name:'Report',exact:true}).first().click();
      const panel=page.getByRole('region',{name:'RISpro report'});
      await panel.waitFor();
      const create=panel.getByRole('button',{name:'Create RISpro Report'});
      if(await create.count())await create.click();
      // Hold the autosave response so the text remains unsaved during the race.
      await page.route('**/api/native-reporting/**',async route=>{
        if(route.request().method()==='PUT') { await draftBarrier; await route.abort().catch(()=>{}); }
        else await route.continue();
      });
      const findings=panel.getByLabel('Findings',{exact:true});
      await findings.fill('SYNTHETIC unsaved startup findings');
      if(scenario==='rapid')await page.evaluate(uid=>{window.__holdB=uid;},c.study+'.2');
      const since=await page.evaluate(()=>performance.now());
      await page.locator('[data-cy="study-browser-thumbnail"][data-series="2"]').first().dblclick();
      if(scenario==='rapid'){
        await page.waitForFunction(()=>window.__bPending);
        await page.locator('[data-cy="study-browser-thumbnail"][data-series="5"]').first().dblclick();
        await page.evaluate(()=>window.__releaseB());
      }
      const selected=c.study+(scenario==='rapid'?'.5':'.2');
      await waitPixels(page,selected,since);
      await page.evaluate(()=>{const s=window.services,v=s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());window.__selectedIdentity={viewport:v,canvas:v.canvas,image:v.getCornerstoneImage(),imageId:v.getCurrentImageId()};
        const annotation={annotationUID:'synthetic-startup-annotation',highlighted:false,invalidated:true,isLocked:false,isVisible:true,metadata:{toolName:'Length',viewPlaneNormal:v.getCamera().viewPlaneNormal,viewUp:v.getCamera().viewUp,referencedImageId:v.getCurrentImageId(),FrameOfReferenceUID:window.cornerstone.metaData.get('imagePlaneModule',v.getCurrentImageId()).frameOfReferenceUID},data:{label:'SYNTHETIC',handles:{points:[v.canvasToWorld([100,100]),v.canvasToWorld([150,150])],activeHandleIndex:null,textBox:{hasMoved:false,worldPosition:[0,0,0],worldBoundingBox:{topLeft:[0,0,0],topRight:[0,0,0],bottomLeft:[0,0,0],bottomRight:[0,0,0]}}}}};
        window.cornerstoneTools.annotation.state.addAnnotation(annotation,v.element);
        window.__selectedIdentity.annotation=annotation;});
      if(progressive)await page.waitForFunction(uid=>window.services.displaySetService.getActiveDisplaySets().some(ds=>ds.SeriesInstanceUID===uid),c.study+'.6',{timeout:15000});
      release();
      for(let n=0;completed<held&&n<200;n++)await page.waitForTimeout(100);
      assert.equal(completed,held,'original held response released before checking the selected series');
      await page.waitForTimeout(1500);
      const before=await page.evaluate(()=>{
        const s=window.services,v=s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId()),p=window.__startupIdentity;
        return {id:v.getCurrentImageId(),index:v.getCurrentImageIdIndex(),document:document===window.__startupDocument,
          viewport:v===window.__selectedIdentity.viewport,engine:v.getRenderingEngine()===p.engine,canvas:v.canvas===window.__selectedIdentity.canvas,rejections:window.__startupRejections,
          cached:window.cornerstone.cache.getImage(window.__selectedIdentity.imageId)===window.__selectedIdentity.image,annotation:window.cornerstoneTools.annotation.state.getAnnotation('synthetic-startup-annotation')===window.__selectedIdentity.annotation,
          selected:s.viewportGridService.getState().viewports.get(v.id).displaySetInstanceUIDs.map(uid=>s.displaySetService.getDisplaySetByUID(uid).SeriesInstanceUID)};
      });
      assert.ok(before.id.includes('/series/'+selected+'/')); assert.deepEqual(before.selected,[selected]);
      for(const key of ['document','viewport','engine','canvas','cached','annotation'])assert.equal(before[key],true,key+' preserved');
      assert.deepEqual(before.rejections,[]); assert.deepEqual(errors,[]);
      assert.equal(await findings.inputValue(),'SYNTHETIC unsaved startup findings');
      await page.evaluate(()=>{const s=window.services,v=s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());v.scroll(1);});
      await page.waitForFunction(index=>{const s=window.services,v=s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());return v.getCurrentImageIdIndex()!==index&&v.viewportStatus==='rendered';},before.index);
      assert.equal(await page.getByLabel('Preparing first diagnostic image',{exact:true}).count(),0);
      assert.match(await panel.getByRole('status').filter({hasText:/Saving|Unsaved/}).innerText(),/Saving|Unsaved/,'findings remain dirty');
      if(scenario==='rapid')await page.screenshot({path:join(h.temp,`startup-${c.modality}-${progressive?'progressive':'ordinary'}-recovered.png`)});
      if(c.modality==='MR' && scenario==='rapid'){
        let at=await page.evaluate(()=>performance.now());
        await page.locator('[data-cy="study-browser-thumbnail"][data-series="4"]').first().dblclick();
        await waitPixels(page,c.study+'.4',at);
        await page.evaluate(()=>{const s=window.services,v=s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());if(v.getImageIds().length!==4)throw Error('multiframe stack lost frames');v.scroll(1);});
        await page.waitForFunction(()=>{const s=window.services,v=s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());return v.getCurrentImageIdIndex()===1&&v.viewportStatus==='rendered';});
        at=await page.evaluate(()=>performance.now());
        await page.locator('[data-cy="study-browser-thumbnail"][data-series="5"]').first().dblclick();
        await waitPixels(page,c.study+'.5',at);
        await page.evaluate(()=>window.commandsManager.runCommand('setHangingProtocol',{protocolId:'mpr'}));
        await page.waitForFunction(()=>{const s=window.services,vs=[...s.viewportGridService.getState().viewports.keys()].map(id=>s.cornerstoneViewportService.getCornerstoneViewport(id));return vs.length===3&&vs.every(v=>v?.type==='orthographic'&&v.viewportStatus==='rendered'&&window.cornerstone.cache.getVolume(v.getVolumeId())?.loadStatus.loaded);},null,{timeout:90000});
        assert.equal(await findings.inputValue(),'SYNTHETIC unsaved startup findings');
      }
      assert.deepEqual(await page.evaluate(()=>window.__startupRejections),[]); assert.deepEqual(errors,[]);
      assert.equal(navigations,1,'no full-page reload');
      results.push({transport:h.nativeDelivery?'native':'express',progressive,modality:c.modality,scenario,status:'PASS',held,completed});save();
      console.log(JSON.stringify(results.at(-1)));
    } catch(error) {
      results.push({transport:h.nativeDelivery?'native':'express',progressive,modality:c.modality,scenario,status:'FAIL',error:error.message,errors});save();
      await page.screenshot({path:join(h.temp,'startup-selection-failed.png')}).catch(()=>{});
      console.log(await page.evaluate(()=>({globals:Object.keys(window).filter(k=>/ohif|extension|manager/i.test(k)),browser:document.body.innerText.slice(-2500)})));
      throw error;
    } finally {release();releaseDraft();await page.close();}
  }
}
