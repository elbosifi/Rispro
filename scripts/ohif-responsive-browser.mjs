// Uses the existing native-reporting harness's guarded DB, Orthanc fixtures,
// real launch security and built OHIF. No archive URL or clinical data inputs.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {chromium,webkit,devices} from '@playwright/test';

const configurations=[
  ['phone-portrait','iPhone 13',390,844],
  ['phone-landscape','iPhone 13',844,390],
  ['small-phone','iPhone SE',375,667],
  ['tablet-portrait','iPad Mini',768,1024],
  ['tablet-landscape','iPad Mini',1024,768],
  ['desktop',null,1440,900],
];
const selectedCase=process.env.OHIF_RESPONSIVE_CASE,selectedEngine=process.env.OHIF_RESPONSIVE_ENGINE;
if(selectedCase&&!configurations.some(([name])=>name===selectedCase))throw Error('Unknown responsive test case');
if(selectedEngine&&!['chromium','webkit'].includes(selectedEngine))throw Error('Unknown responsive test engine');
async function state(page){
  return page.evaluate(()=>{
    const s=window.services,v=s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());
    return {image:v.getCurrentImageId(),index:v.getCurrentImageIdIndex(),zoom:v.getZoom(),pan:v.getPan(),
      voi:v.getProperties().voiRange,engine:s.cornerstoneViewportService.getRenderingEngine().id};
  });
}
async function pixels(page){
  await page.waitForFunction(()=>{
    try{
      const s=window.services,v=s?.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());
      if(v?.viewportStatus!=='rendered'||!v.getCornerstoneImage()?.getPixelData()?.length)return false;
      const c=document.createElement('canvas');c.width=96;c.height=96;
      const ctx=c.getContext('2d');ctx.drawImage(v.canvas,0,0,96,96);
      const bytes=ctx.getImageData(0,0,96,96).data;
      let lo=255,hi=0;for(let i=0;i<bytes.length;i+=16){lo=Math.min(lo,bytes[i]);hi=Math.max(hi,bytes[i]);}
      return hi-lo>20;
    }catch{return false;}
  },null,{timeout:60000});
}
async function geometry(page,compact){
  const errors=await page.evaluate(compact=>{
    const problems=[];
    if(document.documentElement.scrollWidth>innerWidth+1)problems.push('horizontal document overflow');
    if(compact){
      const buttons=[...document.querySelectorAll('.rispro-compact-header button')].map(b=>({name:b.getAttribute('aria-label')||b.textContent,r:b.getBoundingClientRect()})).filter(b=>b.r.width&&b.r.height);
      for(const [i,{name,r}] of buttons.entries()){
        if(r.left<0||r.right>innerWidth+1||r.width<44||r.height<44)problems.push('inaccessible control: '+name);
        for(const {name:other,r:q} of buttons.slice(i+1))if(Math.min(r.right,q.right)-Math.max(r.left,q.left)>1&&Math.min(r.bottom,q.bottom)-Math.max(r.top,q.top)>1)problems.push('overlap: '+name+'/'+other);
      }
    }
    const viewport=document.querySelector('.cornerstone-viewport-element')?.getBoundingClientRect();
    if(!viewport||viewport.width<100||viewport.height<100)problems.push('unusable image viewport');
    return problems;
  },compact);
  assert.deepEqual(errors,[]);
}
async function mouseDrag(page,dx,dy,button='left'){
  const box=await page.locator('.cornerstone-viewport-element').first().boundingBox();
  const x=box.x+box.width*.5,y=box.y+box.height*.5;
  await page.mouse.move(x,y);await page.mouse.down({button});
  await page.mouse.move(x+dx,y+dy,{steps:12});await page.mouse.up({button});
}
async function touchDrag(page,engine,paths){
  if(engine==='chromium'){
    const cdp=await page.context().newCDPSession(page);
    try{
      for(let step=0;step<=12;step++)await cdp.send('Input.dispatchTouchEvent',{
        type:step===0?'touchStart':'touchMove',touchPoints:paths.map(([from,to],id)=>({id,x:from[0]+(to[0]-from[0])*step/12,y:from[1]+(to[1]-from[1])*step/12,radiusX:2,radiusY:2})),
      });
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    }finally{await cdp.detach();}
  }else{
    // Playwright has no WebKit multi-touch injection API. Dispatch DOM touch
    // sequences through Cornerstone's real listeners; never call tool callbacks.
    await page.evaluate(async paths=>{
      const target=document.querySelector('.cornerstone-viewport-element');
      for(let step=0;step<=13;step++){
        const points=paths.map(([from,to],identifier)=>({identifier,target,
          clientX:from[0]+(to[0]-from[0])*Math.min(step,12)/12,
          clientY:from[1]+(to[1]-from[1])*Math.min(step,12)/12,
          pageX:from[0]+(to[0]-from[0])*Math.min(step,12)/12,
          pageY:from[1]+(to[1]-from[1])*Math.min(step,12)/12}));
        const event=new Event(step===0?'touchstart':step===13?'touchend':'touchmove',{bubbles:true,cancelable:true});
        Object.defineProperties(event,{touches:{value:step===13?[]:points},changedTouches:{value:points},targetTouches:{value:step===13?[]:points}});
        target.dispatchEvent(event);await new Promise(r=>setTimeout(r,18));
      }
    },paths);
  }
  await page.waitForTimeout(250);
}
async function gesture(page,engine,touch,type){
  if(!touch){await mouseDrag(page,type==='pan'?35:15,type==='scroll'?70:30,type==='window'?'middle':type==='zoom'?'right':'left');return;}
  const b=await page.locator('.cornerstone-viewport-element').first().boundingBox();
  const x=b.x+b.width*.5,y=b.y+b.height*.5;
  const paths=type==='zoom'?[[[x-35,y],[x-65,y]],[[x+35,y],[x+65,y]]]:
    type==='pan'?[[[x-35,y],[x-5,y+20]],[[x+35,y],[x+65,y+20]]]:
    [[[x,y],[x+15,y+(type==='scroll'?85:35)]]];
  await touchDrag(page,engine,paths);
}
async function closePanel(page,side){
  // Wait for the native expanded header, not just the layout's controlled
  // state: its collapsed reveal control has the same data-cy selector.
  await page.locator(`[data-rispro-panel="${side}"] .absolute[data-cy="side-panel-header-${side}"]`).first().click();
  await page.locator(`[data-rispro-panel="${side}"][data-open="false"]`).waitFor({state:'attached'});
}

export async function runResponsiveAcceptance({context:sourceContext,cases,origin,temp,launch}){
  const results=[];
  for(const [engine,browserType] of [['chromium',chromium],['webkit',webkit]]){
    if(selectedEngine&&engine!==selectedEngine)continue;
    const browser=await browserType.launch({headless:true});
    try{for(const [name,device,width,height] of configurations){
      if(selectedCase&&name!==selectedCase)continue;
      const context=await browser.newContext({...device?devices[device]:{},viewport:{width,height},locale:'en-US',storageState:await sourceContext.storageState()});
      const page=await context.newPage(),errors=[],counts=new Map(),networkFailures=[];
      const compact=width<1280,touch=!!device,c=cases[0];
      page.on('pageerror',e=>errors.push(e.message));
      page.on('response',r=>{if(r.url().includes('/ohif-dicomweb/')){
        if(r.ok())counts.set(r.url(),(counts.get(r.url())||0)+1);
        else networkFailures.push(r.status());
      }});
      const tool=id=>page.locator(`.rispro-diagnostic-toolbar button[name="${id}"]`).first();
      try{
        console.log(JSON.stringify({responsiveStage:{engine,name,stage:'launch'}}));
        const prepared=await launch(c);assert.equal(prepared.status,'ready');
        await page.goto(origin+prepared.launchUrl,{waitUntil:'domcontentloaded'});
        await pixels(page);
        console.log(JSON.stringify({responsiveStage:{engine,name,stage:'first-pixels'}}));
        for(const label of ['Skip all','Confirm and hide']){
          const button=page.getByText(label,{exact:true});
          try{await button.waitFor({timeout:4000});await button.click();await button.waitFor({state:'hidden'});}catch(e){if(e.name!=='TimeoutError')throw e;}
        }
        await page.locator('.shepherd-modal-is-visible').waitFor({state:'hidden'});
        await geometry(page,compact);
        await page.screenshot({path:join(temp,engine+'-'+name+'.png')});
        if(compact)await page.getByRole('button',{name:'Series',exact:true}).click();
        const left=page.locator('[data-rispro-panel="left"]');
        await left.locator('[data-cy="studyBrowser-panel"]').waitFor();
        await page.screenshot({path:join(temp,engine+'-'+name+'-series.png')});
        const thumbnail=left.locator('[data-cy="study-browser-thumbnail"][data-series="2"]');
        if(touch)await thumbnail.tap();else await thumbnail.dblclick();
        await page.waitForFunction(series=>{
          const s=window.services,v=s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());
          return v?.getCurrentImageId()?.includes('/series/'+series+'/');
        },c.study+'.2');
        await pixels(page);
        if(!touch||width>=1024)await closePanel(page,'left');
        else await left.waitFor({state:'hidden'});
        let before=await state(page);
        if(compact)await tool('StackScroll').click();
        await gesture(page,engine,touch,'scroll');
        await page.waitForFunction(index=>{const s=window.services;return s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId()).getCurrentImageIdIndex()!==index;},before.index);
        await pixels(page);
        before=await state(page);await gesture(page,engine,touch,'zoom');
        assert.ok(Math.abs((await state(page)).zoom-before.zoom)>.01,'Pinch/right-drag must change zoom');
        before=await state(page);
        if(!touch)await page.locator('[data-cy="Pan"] button').first().click();
        await gesture(page,engine,touch,'pan');
        assert.notDeepEqual((await state(page)).pan,before.pan,'Translation must change pan');
        if(compact)await tool('WindowLevel').click();
        before=await state(page);await gesture(page,engine,touch,'window');
        assert.notDeepEqual((await state(page)).voi,before.voi,'Window/level drag must change VOI');
        await pixels(page);
        const measure=page.locator('[data-cy="MeasurementTools-split-button-primary"] button').first();
        await measure.click();
        assert.equal(await page.evaluate(()=>{
          const s=window.services,g=s.toolGroupService.getToolGroupForViewport(s.viewportGridService.getActiveViewportId());
          return g.getToolOptions('Length').mode;
        }),'Active','Measurement must activate through the original toolbar');
        if(compact)await tool('WindowLevel').click();
        // The overflow exposes the original commands, including reporting and
        // menus. Execute Reset and verify its effect on actual image state.
        if(compact){
          await page.getByRole('button',{name:'More tools',exact:true}).click();
          const more=page.getByRole('dialog',{name:'More diagnostic tools'});
          await more.getByRole('button',{name:'Add Key Image',exact:true}).waitFor();
          await page.screenshot({path:join(temp,engine+'-'+name+'-overflow.png')});
          await more.locator('[data-cy="MoreTools-split-button-secondary"]').click();
          await page.getByText('Reset View',{exact:true}).click();
          await page.getByRole('button',{name:'More tools',exact:true}).click();
          assert.ok(Math.abs((await state(page)).zoom-1)<.01,'Overflow reset must reset image zoom');
          await page.getByRole('button',{name:'More tools',exact:true}).click();
          await more.getByRole('button',{name:'Maximize image',exact:true}).click();
          assert.ok(await page.locator('.rispro-viewer.rispro-maximized').count());
          await page.getByRole('button',{name:'More tools',exact:true}).click();
          await more.getByRole('button',{name:'Show header',exact:true}).click();
        }
        // Exercise panel/rotation retention with a deliberately non-default
        // presentation, rather than accepting the trivial reset/default state.
        await gesture(page,engine,touch,'zoom');
        await gesture(page,engine,touch,'pan');
        await gesture(page,engine,touch,'window');
        const presentation=await state(page);
        const panelRequests=new Map(counts);
        const imageBox=await page.locator('.cornerstone-viewport-element').first().boundingBox();
        await page.getByRole('button',{name:'Report',exact:true}).first().click();
        const panel=page.getByRole('region',{name:'RISpro report'});
        await panel.waitFor();
        if(compact){
          const openedBox=await page.locator('.cornerstone-viewport-element').first().boundingBox();
          assert.equal(openedBox.width,imageBox.width,'Reporting overlay must not resize the image grid');
        }
        const create=panel.getByRole('button',{name:'Create RISpro Report',exact:true});
        if(await create.isVisible())await create.click();
        await panel.getByRole('button',{name:'Report',exact:true}).click();
        const text='SYNTHETIC responsive '+engine+' '+name;
        await panel.getByLabel('Findings',{exact:true}).fill(text);
        if(compact)assert.ok(await panel.getByLabel('Findings',{exact:true}).evaluate(el=>parseFloat(getComputedStyle(el).fontSize))>=16,'Report fields must avoid iOS auto-zoom');
        await closePanel(page,'right');
        await page.getByRole('button',{name:'Report',exact:true}).first().click();
        assert.equal(await panel.getByLabel('Findings',{exact:true}).inputValue(),text,'Closing must retain unsaved report text');
        await panel.getByRole('button',{name:'Save',exact:true}).click();
        await panel.getByRole('status').filter({hasText:/^Saved$/}).waitFor();
        await panel.getByRole('button',{name:'Finalize',exact:true}).click();
        await page.getByRole('button',{name:'Cancel',exact:true}).click();
        await page.locator('[role="dialog"]').waitFor({state:'hidden'});
        await page.screenshot({path:join(temp,engine+'-'+name+'-report.png')});
        await closePanel(page,'right');
        await page.waitForTimeout(800);
        const retained=await state(page);
        assert.equal(retained.image,presentation.image);assert.deepEqual(retained.voi,presentation.voi);
        assert.ok(Math.abs(retained.zoom-presentation.zoom)<.01,'Panels must preserve zoom');
        assert.ok(Math.abs(retained.pan[0]-presentation.pan[0])<1&&Math.abs(retained.pan[1]-presentation.pan[1])<1,'Panels must preserve pan');
        for(const [url,count] of panelRequests)assert.equal(counts.get(url),count,'Panel changes must not refetch existing DICOM requests');
        if(compact){
          await page.getByRole('button',{name:'More tools',exact:true}).click();
          await page.getByRole('dialog',{name:'More diagnostic tools'}).getByRole('navigation',{name:'Viewer panels'}).getByRole('button',{name:'Measurements',exact:true}).click();
          await page.locator('[data-rispro-panel="right"][data-open="true"]').waitFor();
          await closePanel(page,'right');
          // Capture via the compact toolbar, then retain an unacknowledged
          // upload across hiding/reopening before explicitly retrying it.
          let failUpload=true;
          const reportUrl=origin+'/api/native-reporting/appointments/'+c.appointmentId;
          const imageCount=(await(await context.request.get(reportUrl)).json()).report.keyImages.length;
          await page.route('**/api/native-reporting/appointments/*/images',async route=>{
            if(failUpload&&route.request().method()==='POST'){failUpload=false;await route.abort();}else await route.continue();
          });
          await page.getByRole('button',{name:'More tools',exact:true}).click();
          await page.getByRole('dialog',{name:'More diagnostic tools'}).getByRole('button',{name:'Add Key Image',exact:true}).click();
          await page.getByRole('button',{name:'More tools',exact:true}).click();
          await panel.getByRole('button',{name:/Key Images/}).click();
          await panel.getByRole('button',{name:'Retry upload',exact:true}).waitFor();
          await closePanel(page,'right');
          await page.getByRole('button',{name:'Report',exact:true}).first().click();
          await panel.getByRole('button',{name:/Key Images/}).click();
          await panel.getByRole('button',{name:'Retry upload',exact:true}).click();
          await panel.getByRole('button',{name:'Retry upload',exact:true}).waitFor({state:'hidden'});
          assert.equal((await(await context.request.get(reportUrl)).json()).report.keyImages.length,imageCount+1,'Retried capture must store exactly one illustration');
          await page.unroute('**/api/native-reporting/appointments/*/images');
          await closePanel(page,'right');
        }
        before=await state(page);const requestsBefore=new Map(counts);
        await page.evaluate(()=>{window.__responsiveViewport=window.services.cornerstoneViewportService.getCornerstoneViewport(window.services.viewportGridService.getActiveViewportId());});
        await page.setViewportSize({width:height,height:width});await page.waitForTimeout(800);await pixels(page);
        await page.setViewportSize({width,height});await page.waitForTimeout(800);await pixels(page);
        const after=await state(page);
        assert.equal(after.image,before.image);assert.deepEqual(after.voi,before.voi);assert.ok(Math.abs(after.zoom-before.zoom)<.01);
        assert.ok(Math.abs(after.pan[0]-before.pan[0])<1&&Math.abs(after.pan[1]-before.pan[1])<1);
        assert.ok(await page.evaluate(()=>window.__responsiveViewport===window.services.cornerstoneViewportService.getCornerstoneViewport(window.services.viewportGridService.getActiveViewportId())),'Rotation must not recreate the viewport');
        for(const [url,count] of requestsBefore)assert.equal(counts.get(url),count,'Responsive layout must not refetch existing DICOM requests');
        await geometry(page,compact);assert.deepEqual(errors,[]);assert.deepEqual(networkFailures,[]);
        const result={engine,name,viewport:[width,height],touch,devicePixelRatio:await page.evaluate(()=>devicePixelRatio),gestureInput:touch?(engine==='chromium'?'CDP native touch':'DOM touch sequences'):'mouse',status:'PASS'};
        results.push(result);console.log(JSON.stringify({responsive:result}));
      }catch(error){
        writeFileSync(join(temp,engine+'-'+name+'-failure.html'),await page.content());
        await page.screenshot({path:join(temp,engine+'-'+name+'-failure.png')}).catch(()=>{});
        writeFileSync(join(temp,'responsive-failure.json'),JSON.stringify({engine,name,error:error.stack,errors,state:await state(page).catch(()=>null)},null,2));
        throw error;
      }finally{await context.close();}
    }}finally{await browser.close();}
  }
  writeFileSync(join(temp,'responsive-results.json'),JSON.stringify(results,null,2));
}
