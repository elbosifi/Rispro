// Imported by the existing guarded synthetic Orthanc/DB harness.
// OHIF_MULTI_STUDY=1 node --env-file=codex-db-test.env --import tsx scripts/ohif-native-reporting-browser.mjs
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import sharp from 'sharp';

async function rendered(page, study) {
  await page.waitForFunction(study=>{
    try {
      const s=window.services,v=s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());
      if(!v?.getCurrentImageId()?.includes('/studies/'+study+'/') || v.viewportStatus!=='rendered' || !v.getCornerstoneImage()?.getPixelData()?.length)return false;
      const c=document.createElement('canvas');c.width=96;c.height=96;
      const ctx=c.getContext('2d');ctx.drawImage(v.canvas,0,0,96,96);
      const bytes=ctx.getImageData(0,0,96,96).data;let lo=255,hi=0;
      for(let i=0;i<bytes.length;i+=16){lo=Math.min(lo,bytes[i]);hi=Math.max(hi,bytes[i]);}
      return hi-lo>20;
    }catch{return false;}
  },study,{timeout:60000});
}

export async function runMultiStudyAcceptance({context,cases,origin,temp,pool,nativeDelivery,backendOrigin,launch}) {
  const results=[];
  for(const c of cases){
    const ready=await launch(c,true);assert.equal(ready.status,'ready');
    assert.deepEqual(new Set(ready.currentStudyUids),new Set([c.study,c.additionalStudy]));
    assert.equal(ready.priorStudyCount,1);
    const page=await context.newPage();const frameUrls=[];
    page.on('response',r=>{if(r.url().includes('/frames/')&&r.ok())frameUrls.push(r.url());});
    page.on('pageerror',error=>console.log(JSON.stringify({browserError:error.message})));
    try {
      await page.goto(origin+ready.launchUrl);
      await page.waitForURL('**/ohif/viewer?**');
      const params=new URL(page.url()).searchParams;
      assert.deepEqual(new Set(params.get('StudyInstanceUIDs').split(',')),new Set([c.study,c.additionalStudy]));
      const contextId=params.get('risproContext');
      for(const label of ['Skip all']){
        const button=page.getByText(label,{exact:true});
        try{await button.waitFor({state:'visible',timeout:3000});await button.click();}catch(error){if(error.name!=='TimeoutError')throw error;}
      }
      await page.locator('.shepherd-modal-is-visible').waitFor({state:'hidden'});
      assert.equal(await page.getByText('for investigational use only',{exact:true}).count(),0);
      await page.waitForFunction(({study,additional})=>{
        const sets=window.services?.displaySetService.getActiveDisplaySets();
        return [study,additional].every(uid=>sets?.some(s=>s.StudyInstanceUID===uid && s.images?.length));
      },{study:c.study,additional:c.additionalStudy},{timeout:90000});
      const sets=await page.evaluate(()=>window.services.displaySetService.getActiveDisplaySets().map(s=>({study:s.StudyInstanceUID,series:s.SeriesInstanceUID,id:s.displaySetInstanceUID})));
      assert.ok(sets.every(s=>s.study!==c.study+'.8'),'A genuine prior must remain unloaded');
      assert.ok(!frameUrls.some(url=>url.includes('/studies/'+c.study+'.8/')),'No prior frames before explicit selection');
      // Both acquisitions are already expanded current studies. Select their
      // real thumbnails; never call loadStudy to turn an extra acquisition into a prior.
      for(const [study,series] of [[c.study,c.study+'.1'],[c.additionalStudy,c.study+'.2']]){
        const set=sets.find(s=>s.study===study&&s.series===series);assert.ok(set);
        await page.locator(`[id="thumbnail-${set.id}"]`).dblclick();
        await rendered(page,study);
        await page.screenshot({path:join(temp,`${nativeDelivery?'native':'proxy'}-${c.modality}-${study===c.study?'primary':'additional'}.png`)});
      }
      await page.getByRole('button',{name:'Report',exact:true}).first().click();
      const panel=page.getByRole('region',{name:'RISpro report'});
      await panel.getByRole('button',{name:'Create RISpro Report'}).click();
      await panel.getByLabel('Findings',{exact:true}).fill('SYNTHETIC MULTI-STUDY examination.');
      await panel.getByLabel('Impression',{exact:true}).fill('SYNTHETIC grouped acquisitions.');
      await panel.getByRole('status').filter({hasText:/^Saved$/}).waitFor();
      await panel.getByRole('button',{name:/Key Images/}).click();
      // Include a real visible annotation in a capture from the second study.
      await page.evaluate(()=>{
        const s=window.services,v=s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());
        const imageId=v.getCurrentImageId(),a=v.canvasToWorld([60,60]),b=v.canvasToWorld([180,120]);
        window.cornerstoneTools.annotation.state.addAnnotation({annotationUID:'synthetic-multi-study-length',highlighted:false,invalidated:true,isLocked:false,isVisible:true,
          metadata:{toolName:'Length',viewPlaneNormal:v.getCamera().viewPlaneNormal,viewUp:v.getCamera().viewUp,FrameOfReferenceUID:window.cornerstone.metaData.get('imagePlaneModule',imageId).frameOfReferenceUID,referencedImageId:imageId},
          data:{label:'SYNTHETIC LENGTH',handles:{points:[a,b],activeHandleIndex:null,textBox:{hasMoved:false,worldPosition:[0,0,0],worldBoundingBox:{topLeft:[0,0,0],topRight:[0,0,0],bottomLeft:[0,0,0],bottomRight:[0,0,0]}}}}},v.element);
        window.cornerstoneTools.utilities.triggerAnnotationRenderForViewportIds([v.id]);
      });
      await page.waitForTimeout(250);
      await panel.getByRole('button',{name:'Add Key Image',exact:true}).click();
      await panel.getByAltText('Saved key image 1').waitFor({timeout:30000});
      const report=(await (await context.request.get(origin+'/api/native-reporting/appointments/'+c.appointmentId)).json()).report;
      assert.equal(report.keyImages.length,1);
      const provenance=report.keyImages[0].provenance;
      assert.equal(provenance.studyInstanceUid,c.additionalStudy);assert.equal(provenance.seriesInstanceUid,c.study+'.2');
      assert.equal(provenance.prior,false);assert.ok(provenance.sopInstanceUid.startsWith(c.study+'.2.'));
      const saved=await context.request.get(origin+await panel.getByAltText('Saved key image 1').getAttribute('src'));
      assert.equal(saved.status(),200);
      const rgb=await sharp(await saved.body()).removeAlpha().raw().toBuffer();let colored=0;
      for(let i=0;i<rgb.length;i+=3)if(Math.max(rgb[i],rgb[i+1],rgb[i+2])-Math.min(rgb[i],rgb[i+1],rgb[i+2])>40)colored++;
      assert.ok(colored>20,'The saved key image must retain the visible annotation');
      assert.equal((await pool.query('select count(*)::int n from native_reports where appointment_id=$1',[c.appointmentId])).rows[0].n,1);
      assert.equal((await pool.query("select count(*)::int n from doctor_portal.case_team_assignments where appointment_id=$1 and assignment_type='reporting'",[c.appointmentId])).rows[0].n,1);

      // A fresh launch without history still contains the complete current group.
      const withoutHistory=await launch(c,false);assert.equal(withoutHistory.priorStudyCount,0);
      const mobile=await context.newPage();await mobile.setViewportSize({width:390,height:844});
      try {
        await mobile.goto(origin+withoutHistory.launchUrl);await mobile.waitForURL('**/ohif/viewer?**');
        await mobile.waitForFunction(study=>window.services?.displaySetService.getActiveDisplaySets().some(s=>s.StudyInstanceUID===study),c.additionalStudy,{timeout:90000});
        const mobileContext=new URL(mobile.url()).searchParams.get('risproContext');
        const list=await (await context.request.get(origin+`/api/ohif/contexts/${mobileContext}/studies?offset=0`)).json();
        assert.deepEqual(new Set(list.uids),new Set([c.study,c.additionalStudy]));
        for(const study of [c.study,c.additionalStudy]) assert.equal((await context.request.get(origin+`/ohif-dicomweb/context/${mobileContext}/studies/${study}/metadata`)).status(),200);
        for(const root of ['/ohif-dicomweb',...(nativeDelivery?['/ohif-native']:[])])assert.equal((await context.request.get(origin+`${root}/context/${mobileContext}/studies/${c.study}.8/metadata`)).status(),403);
        await mobile.waitForFunction(()=>{try{const s=window.services;return !!s?.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId())?.getCurrentImageId();}catch{return false;}},null,{timeout:60000});
        const activeStudy=await mobile.evaluate(()=>{const s=window.services,v=s.viewportGridService.getState();return s.displaySetService.getDisplaySetByUID(v.viewports.get(v.activeViewportId).displaySetInstanceUIDs[0]).StudyInstanceUID;});
        assert.ok([c.study,c.additionalStudy].includes(activeStudy));
        await rendered(mobile,activeStudy);
        await mobile.getByText('Preparing first diagnostic image…',{exact:true}).waitFor({state:'hidden',timeout:10000});
        assert.equal(await mobile.getByText('for investigational use only',{exact:true}).count(),0);
        assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
        await mobile.screenshot({path:join(temp,`${nativeDelivery?'native':'proxy'}-${c.modality}-mobile.png`)});
      }catch(error){await mobile.screenshot({path:join(temp,'multi-study-mobile-failure.png')}).catch(()=>{});throw error;}finally{await mobile.close();}
      assert.ok(frameUrls.some(url=>url.includes((nativeDelivery?'/ohif-native/':'/ohif-dicomweb/')+'context/'+contextId+'/studies/'+c.additionalStudy+'/')));
      if(nativeDelivery)assert.equal(frameUrls.some(url=>url.includes('/ohif-dicomweb/')),false,'Native frames must bypass the Express proxy');
      results.push({modality:c.modality,currentStudies:2,priorStudies:1,oneReport:true,annotationPixels:colored,provenance,frames:frameUrls.length});
    }catch(error){await page.screenshot({path:join(temp,'multi-study-failure.png')}).catch(()=>{});throw error;}
    finally{await page.close();}
  }
  if(nativeDelivery){
    const metrics=await (await fetch(backendOrigin+'/__benchmark/metrics')).json();
    assert.equal(metrics.proxyFrames,0);assert.ok(metrics.authorizations>0);
  }
  writeFileSync(join(temp,'multi-study-results.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify({multiStudy:'PASS',delivery:nativeDelivery?'native':'proxy',artifacts:temp,results}));
}
