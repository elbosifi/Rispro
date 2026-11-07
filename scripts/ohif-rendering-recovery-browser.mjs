// Synthetic-only acceptance through the existing real proxy/Orthanc harness.
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { installRenderingProbe } from './ohif-rendering-stress.mjs';

async function pixels(page) {
  await page.waitForFunction(() => {
    try {
    const s=window.services;if(!s)return false;
    const viewports=[...s.viewportGridService.getState().viewports.keys()].map(id=>s.cornerstoneViewportService.getCornerstoneViewport(id));
    return viewports.length && viewports.every(v=>{
      if(!v?.canvas?.width||!v.canvas.height)return false;
      const c=document.createElement('canvas');c.width=c.height=64;const ctx=c.getContext('2d');ctx.drawImage(v.canvas,0,0,64,64);
      const data=ctx.getImageData(0,0,64,64).data;let low=255,high=0;for(let i=0;i<data.length;i+=4){low=Math.min(low,data[i]);high=Math.max(high,data[i]);}return high-low>20;
    });
    } catch { return false; }
  },null,{timeout:30000});
}

export async function runRenderingRecoveryAcceptance(h) {
  for(const c of h.cases.filter(c=>!process.env.OHIF_RENDER_CASES||process.env.OHIF_RENDER_CASES.split(',').includes(c.modality))){
    const page=await h.context.newPage(),errors=[],stacks=[];
    page.on('pageerror',e=>{errors.push(e.message);stacks.push(e.stack);});await page.addInitScript(installRenderingProbe);
    try{
      const launch=await h.launch(c);await page.goto(h.origin+launch.launchUrl,{waitUntil:'domcontentloaded'});
      for(const name of ['Skip all','Confirm and hide']){const b=page.getByText(name,{exact:true});if(await b.isVisible())await b.click();}
      await pixels(page);
      for(const name of ['Skip all','Confirm and hide']){const b=page.getByText(name,{exact:true});if(await b.isVisible()){await b.click();await b.waitFor({state:'hidden'});}}
      await page.getByRole('button',{name:'Report',exact:true}).first().click();
      const panel=page.locator('.rispro-report'),create=panel.getByRole('button',{name:'Create RISpro Report',exact:true});
      await create.waitFor({state:'visible',timeout:30000});await create.click();
      const findings=panel.getByLabel('Findings',{exact:true}),text='SYNTHETIC unsaved rendering recovery '+c.modality;
      await findings.evaluate((el,value)=>{el.dataset.dictationInserting='true';Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));delete el.dataset.dictationInserting;},text);
      await page.evaluate(()=>{
        const s=window.services,v=s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());
        window.__gpuProof={document,image:window.cornerstone.cache.getImage(v.getCurrentImageId()),imageId:v.getCurrentImageId(),camera:v.getCamera(),properties:v.getProperties(),index:v.getCurrentImageIdIndex(),engine:v.getRenderingEngine()};
        const a={annotationUID:'gpu-retained',metadata:{toolName:'Length',FrameOfReferenceUID:v.getFrameOfReferenceUID(),referencedImageId:v.getCurrentImageId()},data:{handles:{points:[v.canvasToWorld([80,80]),v.canvasToWorld([100,100])]}}};
        window.cornerstoneTools.annotation.state.addAnnotation(a,v.element);window.__gpuProof.annotation=a;
      });
      let renewals=0,retainedDownloads=0;
      const retainedUrl=await page.evaluate(()=>new URL(window.__gpuProof.imageId.slice(7),location.origin).href);
      page.on('request',r=>{if(r.url().endsWith('/renew'))renewals++;if(r.url()===retainedUrl)retainedDownloads++;});
      // Zero width, repeated identical resize and a burst of real browser sizes.
      await page.evaluate(()=>{
        const s=window.services,v=s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());
        const before=[v.canvas.width,v.canvas.height],width=v.element.style.width;v.element.style.width='0px';
        v.getRenderingEngine().resize();if(v.canvas.width!==before[0]||v.canvas.height!==before[1])throw Error('Zero size cleared diagnostic canvas');
        v.element.style.width=width;for(let i=0;i<40;i++)s.cornerstoneViewportService.resize();
      });
      for(let i=0;i<8;i++)await page.setViewportSize({width:1200+i*40,height:850+i*10});
      await page.setViewportSize({width:1600,height:1000});await pixels(page);
      await page.evaluate(()=>{const s=window.services,v=s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());window.__gpuProof.camera=v.getCamera();window.__gpuProof.properties=v.getProperties();});
      const verify=async()=>{
        await expect(findings).toHaveValue(text);
        const proof=await page.evaluate(()=>{const p=window.__gpuProof,s=window.services,v=s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());return {sameDocument:document===p.document,sameImage:window.cornerstone.cache.getImage(p.imageId)===p.image,sameAnnotation:window.cornerstoneTools.annotation.state.getAnnotation('gpu-retained')===p.annotation,index:v.getCurrentImageIdIndex(),expectedIndex:p.index,camera:v.getCamera(),expectedCamera:p.camera,properties:v.getProperties(),expectedProperties:p.properties};});
        assert.equal(proof.sameDocument,true);assert.equal(proof.sameImage,true);assert.equal(proof.sameAnnotation,true);assert.equal(proof.index,proof.expectedIndex);assert.equal(retainedDownloads,0);assert.equal(renewals,0,'Graphics recovery never requests authentication');await pixels(page);
        for(const key of ['parallelScale','position','focalPoint','viewPlaneNormal']){const actual=[proof.camera[key]].flat(),expected=[proof.expectedCamera[key]].flat();assert.ok(actual.every((value,i)=>Math.abs(value-expected[i])<0.001),'Camera '+key+' survives');}
        assert.deepEqual(proof.properties,proof.expectedProperties);
      };
      await verify();
      const alert=page.getByRole('alert',{name:'Rendering recovery'});
      // All contexts belong to one shared engine; it gets one recovery attempt.
      await page.evaluate(()=>{const e=window.__gpuProof.engine,gl=e.getOffscreenMultiRenderWindow(window.services.viewportGridService.getActiveViewportId()).getOpenGLRenderWindow().get3DContext();const ext=gl.getExtension('WEBGL_lose_context');if(!ext)throw Error('WEBGL_lose_context missing');window.__restoreGpu=()=>ext.restoreContext();ext.loseContext();});
      await expect(alert).toBeVisible();await page.waitForTimeout(100);await page.evaluate(()=>window.__restoreGpu());
      await expect(alert).toBeHidden({timeout:30000});await verify();
      const switchSeries=async suffix=>{
        const series=c.study+'.'+suffix;
        await page.waitForFunction(seriesUID=>window.services?.displaySetService.getDisplaySetsForSeries(seriesUID)?.length>0,series,{timeout:30000});
        await page.evaluate(seriesUID=>{
          const s=window.services,id=s.viewportGridService.getActiveViewportId(),row=s.viewportGridService.getState().viewports.get(id);
          const displaySet=s.displaySetService.getDisplaySetsForSeries(seriesUID)?.[0];
          if(!displaySet)throw Error('Post-recovery synthetic display set is unavailable: '+seriesUID);
          s.viewportGridService.setDisplaySetsForViewport({viewportId:id,displaySetInstanceUIDs:[displaySet.displaySetInstanceUID],
            viewportOptions:row?.viewportOptions||{viewportType:'stack'},displaySetOptions:[{}]});
        },series);
        await page.waitForFunction(seriesUID=>{
          const s=window.services,id=s.viewportGridService.getActiveViewportId(),row=s.viewportGridService.getState().viewports.get(id),
            displaySet=s.displaySetService.getDisplaySetByUID(row?.displaySetInstanceUIDs?.[0]),v=s.cornerstoneViewportService.getCornerstoneViewport(id),
            image=v&&window.cornerstone.cache.getImage(v.getCurrentImageId());
          return displaySet?.SeriesInstanceUID===seriesUID&&v?.getCurrentImageId?.()?.includes('/series/'+seriesUID+'/instances/')&&!!image&&image.getPixelData?.().length===image.width*image.height;
        },series,{timeout:30000});
        await pixels(page);
        return page.evaluate(()=>{
          const s=window.services,id=s.viewportGridService.getActiveViewportId(),row=s.viewportGridService.getState().viewports.get(id),
            displaySet=s.displaySetService.getDisplaySetByUID(row.displaySetInstanceUIDs[0]),v=s.cornerstoneViewportService.getCornerstoneViewport(id),image=window.cornerstone.cache.getImage(v.getCurrentImageId()),
            data=image.getPixelData();
          return {series:displaySet.SeriesInstanceUID,pixel:data[Math.floor(image.height/2)*image.width+Math.floor(image.width/2)]};
        });
      };
      const afterRecoveryB=await switchSeries(2);assert.equal(afterRecoveryB.series,c.study+'.2');assert.ok(afterRecoveryB.pixel>20,'Series B must render its diagnostic pixels after recovery');
      const afterRecoveryA=await switchSeries(1);assert.equal(afterRecoveryA.series,c.study+'.1');assert.ok(afterRecoveryA.pixel>20,'Returning to series A must render its diagnostic pixels after recovery');
      assert.equal(retainedDownloads,0,'Switching after recovery must reuse the valid cached A image');await expect(findings).toHaveValue(text);
      // Invalid pool state must become a classified failure before getAllContexts.
      await page.waitForTimeout(5100);
      await page.evaluate(()=>{const s=window.services,v=s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId()),e=v.getRenderingEngine(),pool=e.contextPool;window.__missingPool={engine:e,pool};e.contextPool=undefined;try{e.addVtkjsDrivenViewport({viewportId:v.id,element:v.element,canvas:v.canvas,type:v.type,defaultOptions:v.defaultOptions});throw Error('Missing pool unexpectedly accepted');}catch(error){if(error.code!=='context-pool-missing')throw error;}});
      await expect(alert).toContainText('Rendering resources could not be safely restored',{timeout:10000});await expect(findings).toHaveValue(text);
      await page.evaluate(()=>{window.__missingPool.engine.contextPool=window.__missingPool.pool;});await page.waitForTimeout(5100);
      await alert.getByRole('button',{name:'Retry rendering',exact:true}).click();await expect(alert).toBeHidden({timeout:30000});await verify();
      // Inject the classified shader failure at the engine's VTK boundary;
      // unit tests separately execute the actual null-program backport paths.
      await page.evaluate(()=>window.commandsManager.runCommand('setHangingProtocol',{protocolId:'mpr'}));await pixels(page);
      await page.waitForFunction(()=>{const s=window.services,ids=[...s.viewportGridService.getState().viewports.keys()];return ids.length===3&&ids.every(id=>s.cornerstoneViewportService.getCornerstoneViewport(id)?.type==='orthographic');});
      await page.evaluate(async()=>{
        const s=window.services,v=s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId()),before=window.risproRenderingResources.discardedActors,actors=v.getActors();
        for(let i=0;i<3;i++){
          try{await v.setVolumes([{volumeId:v.getVolumeId()},{volumeId:v.getVolumeId(),callback:()=>{throw Error('Synthetic failed actor initialization');}}]);throw Error('Expected initialization rejection');}
          catch(error){if(error.message!=='Synthetic failed actor initialization')throw error;}
        }
        if(window.risproRenderingResources.discardedActors-before!==6)throw Error('Failed volume actors were not all released');
        if(v.getActors().length!==actors.length||v.getActors().some((a,i)=>a.actor!==actors[i].actor))throw Error('Failed initialization replaced valid actors');
        v.render();
      });await pixels(page);
      await page.waitForTimeout(5100);
      await page.evaluate(()=>{
        const s=window.services,v=s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId()),e=v.getRenderingEngine();
        window.__shaderEngine=e;window.__shaderCalls=0;
        e._renderViewportWithContext=()=>{window.__shaderCalls++;throw Object.assign(new Error('Synthetic shader compilation failure'),{code:'shader-failed'});};
        v.setBlendMode(window.cornerstone.Enums.BlendModes.MAXIMUM_INTENSITY_BLEND);v.setCamera({parallelScale:v.getCamera().parallelScale*1.01});e.render();
      });
      await page.waitForFunction(()=>window.risproRenderingDiagnostics().some(e=>e.code==='shader-failed'),null,{timeout:10000});
      await expect(alert).toBeHidden({timeout:30000});await expect(findings).toHaveValue(text);await pixels(page);
      // An unrecoverable volume path must stop after one automatic rebuild.
      // A single conventional acquisition may then explicitly use its ordered
      // source images as a stack. No global CPU/quality switch is involved.
      await page.evaluate(()=>window.commandsManager.runCommand('setHangingProtocol',{protocolId:'default'}));
      await page.waitForFunction(()=>{const s=window.services,rows=[...s.viewportGridService.getState().viewports.keys()];return rows.length===1&&s.cornerstoneViewportService.getCornerstoneViewport(rows[0])?.type==='stack';});await pixels(page);
      await page.evaluate(()=>{const s=window.services,id=s.viewportGridService.getActiveViewportId(),row=s.viewportGridService.getState().viewports.get(id);s.viewportGridService.setDisplaySetsForViewport({viewportId:id,displaySetInstanceUIDs:row.displaySetInstanceUIDs,viewportOptions:{viewportType:'orthographic',orientation:'axial',toolGroupId:'default'},displaySetOptions:[{}]});});
      await page.waitForFunction(()=>{const s=window.services;return s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId())?.type==='orthographic';});await pixels(page);await page.waitForTimeout(5100);
      await page.evaluate(()=>{
        const service=window.services.cornerstoneViewportService,original=service.getRenderingEngine.bind(service);
        window.__gpuFactory=original;window.__failedRebuilds=0;
        const failVolumes=e=>{const render=e._renderViewportWithContext.bind(e);e._renderViewportWithContext=(v,...args)=>{if(v.type!=='stack')throw Object.assign(new Error('Synthetic persistent shader failure'),{code:'shader-failed'});return render(v,...args);};};
        const v=service.getCornerstoneViewport(window.services.viewportGridService.getActiveViewportId()),e=v.getRenderingEngine(),seen=new WeakSet([e]);
        service.getRenderingEngine=(...args)=>{const result=original(...args),actual=window.cornerstone.getRenderingEngine(result.id);if(!seen.has(actual)){seen.add(actual);window.__failedRebuilds++;failVolumes(actual);}return result;};
        failVolumes(e);e.render();
      });
      await expect(alert).toContainText('Diagnostic pixels could not be verified',{timeout:15000});
      const attempts=await page.evaluate(()=>window.__failedRebuilds);assert.equal(attempts,1);await page.waitForTimeout(1000);assert.equal(await page.evaluate(()=>window.__failedRebuilds),1);
      await alert.getByRole('button',{name:'Open in 2D stack',exact:true}).click();
      await expect(alert).toBeHidden({timeout:30000});await pixels(page);await expect(findings).toHaveValue(text);
      await page.evaluate(()=>{window.services.cornerstoneViewportService.getRenderingEngine=window.__gpuFactory;});
      await page.evaluate(()=>window.commandsManager.runCommand('setViewportGridLayout',{numRows:2,numCols:2}));
      await page.waitForFunction(()=>window.services.viewportGridService.getState().viewports.size===4);
      await page.evaluate(()=>{const s=window.services,rows=s.viewportGridService.getState().viewports,uid=[...rows.values()].find(row=>row.displaySetInstanceUIDs?.length)?.displaySetInstanceUIDs[0];window.commandsManager.runCommand('setDisplaySetsForViewports',{viewportsToUpdate:[...rows.keys()].map(viewportId=>({viewportId,displaySetInstanceUIDs:[uid],viewportOptions:{viewportType:'stack',toolGroupId:'default'}}))});});await pixels(page);
      const handle=page.locator('[data-panel-resize-handle-id]').first();
      assert.ok(await handle.count(),'Use an actual OHIF panel resize handle');
      {
        const bounds=await handle.boundingBox();
        for(let i=0;i<5;i++){await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.down();await page.mouse.move(bounds.x+70,bounds.y+bounds.height/2,{steps:8});await page.mouse.move(bounds.x,bounds.y+bounds.height/2,{steps:8});await page.mouse.up();}
        await pixels(page);
      }
      await expect(findings).toHaveValue(text);
      await page.evaluate(async()=>{
        const s=window.services,v=s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId()),e=v.getRenderingEngine();
        const ids=v.getImageIds(),index=v.getCurrentImageIdIndex(),camera=v.getCamera(),properties=v.getProperties(),input={viewportId:v.id,element:v.element,type:v.type,defaultOptions:v.defaultOptions};
        window.__staleScrollFired=false;v.debouncedTimeout=setTimeout(()=>{window.__staleScrollFired=true;v.setImageIdIndex(index);},40);
        e.disableElement(v.id);e.enableElement(input);const next=e.getViewport(v.id);await next.setStack(ids,index);next.setProperties(properties);next.setCamera(camera);next.render();
      });await page.waitForTimeout(80);assert.equal(await page.evaluate(()=>window.__staleScrollFired),false);await pixels(page);
      assert.equal(renewals,0);assert.equal(retainedDownloads,0);
      const diagnostics=await page.evaluate(()=>window.risproRenderingDiagnostics());
      assert.ok(diagnostics.some(e=>e.code==='context-lost'));assert.ok(diagnostics.some(e=>e.code==='context-pool-missing'));assert.ok(diagnostics.some(e=>e.code==='shader-failed'));
      assert.deepEqual(errors,[]);
      writeFileSync(join(h.temp,c.modality+'-rendering-recovery.json'),JSON.stringify({diagnostics,errors,retainedDownloads,renewals},null,2));
      await page.screenshot({path:join(h.temp,c.modality+'-rendering-recovery.png')});
      console.log(JSON.stringify({renderingRecovery:'PASS',modality:c.modality,contextLoss:true,missingPool:true,shaderFailure:true,boundedFailedRecovery:true,safeStackFallback:true,zeroDimensions:true,resize:true,actualPixels:true,unsavedText:true,annotations:true,retainedDownloads,renewals}));
    }catch(error){
      await page.screenshot({path:join(h.temp,c.modality+'-rendering-failure.png')}).catch(()=>{});
      writeFileSync(join(h.temp,c.modality+'-rendering-failure.json'),JSON.stringify({error:error.message,errors,stacks,state:await page.evaluate(()=>({diagnostics:window.risproRenderingDiagnostics?.(),shaderCalls:window.__shaderCalls,shaderRenders:window.__shaderRenders,engine:{blocked:window.__shaderEngine?._risproRenderingBlocked,frame:window.__shaderEngine?._animationFrameSet,destroyed:window.__shaderEngine?.hasBeenDestroyed,pending:[...window.__shaderEngine?._needsRender||[]]},text:document.body.innerText.slice(-2000)})).catch(()=>null)},null,2));
      throw error;
    }finally{await page.close();}
  }
}
