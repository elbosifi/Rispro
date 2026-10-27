// Uses the existing native-reporting harness's guarded DB, Orthanc fixtures,
// real launch security and built OHIF. No archive URL or clinical data inputs.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {chromium,webkit,devices} from '@playwright/test';
import {installRenderingProbe} from './ohif-rendering-stress.mjs';

const configurations=[
  ['phone-portrait','iPhone 13',390,844],
  ['phone-landscape','iPhone 13',844,390],
  ['small-phone','iPhone SE',375,667],
  ['tablet-portrait','iPad Mini',768,1024],
  ['tablet-landscape','iPad Mini',1024,768],
  ['desktop',null,1440,900],
];
const selectedCase=process.env.OHIF_RESPONSIVE_CASE,selectedEngine=process.env.OHIF_RESPONSIVE_ENGINE;
const selectedModality=process.env.OHIF_RESPONSIVE_MODALITY || 'CT';
if(selectedCase&&!configurations.some(([name])=>name===selectedCase))throw Error('Unknown responsive test case');
if(selectedEngine&&!['chromium','webkit'].includes(selectedEngine))throw Error('Unknown responsive test engine');
if(!['CT','MR'].includes(selectedModality))throw Error('Unknown synthetic responsive modality');
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
async function dicomWindow(page,series){
  const expected=series===2?{lower:-30,upper:869}:{lower:-200,upper:1599};
  assert.deepEqual((await state(page)).voi,expected,'Opening a series must use its stored DICOM window, including revisits');
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
async function touchDrag(page,engine,paths,selector='.cornerstone-viewport-element'){
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
    await page.evaluate(async({paths,selector})=>{
      const target=document.querySelector(selector);
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
    },{paths,selector});
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
  if(process.env.OHIF_RELIABILITY==='1')return runReliabilityAcceptance({sourceContext,cases,origin,temp,launch});
  const results=[];
  for(const [engine,browserType] of [['chromium',chromium],['webkit',webkit]]){
    if(selectedEngine&&engine!==selectedEngine)continue;
    const browser=await browserType.launch({headless:true});
    try{for(const [name,device,width,height] of configurations){
      if(selectedCase&&name!==selectedCase)continue;
      const context=await browser.newContext({...device?devices[device]:{},viewport:{width,height},locale:'en-US',storageState:await sourceContext.storageState()});
      const page=await context.newPage(),errors=[],counts=new Map(),networkFailures=[];
      const compact=width<1280,touch=!!device,c=cases.find(c=>c.modality===selectedModality);
      assert.ok(c,'Required synthetic modality fixture is missing');
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
        await dicomWindow(page,1);
        await page.screenshot({path:join(temp,engine+'-'+name+'.png')});
        if(compact)await page.getByRole('button',{name:'Series',exact:true}).click();
        const left=page.locator('[data-rispro-panel="left"]');
        await left.locator('[data-cy="studyBrowser-panel"]').waitFor();
        await page.screenshot({path:join(temp,engine+'-'+name+'-series.png')});
        const thumbnail=left.locator('[data-cy="study-browser-thumbnail"][data-series="2"]');
        if(touch){
          const before=await state(page),box=await thumbnail.boundingBox();
          const x=box.x+box.width/2,y=Math.min(box.y+box.height*.4,height-25);
          await touchDrag(page,engine,[[[x,y],[x,y-45]]],'[data-cy="study-browser-thumbnail"][data-series="2"]');
          assert.equal((await state(page)).image,before.image,'Dragging the series list must not select a series');
        }
        if(touch)await thumbnail.tap();else await thumbnail.dblclick();
        await page.waitForFunction(series=>{
          const s=window.services,v=s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());
          return v?.getCurrentImageId()?.includes('/series/'+series+'/');
        },c.study+'.2');
        await pixels(page);
        await dicomWindow(page,2);
        if(!touch||width>=1024)await closePanel(page,'left');
        else await left.waitFor({state:'hidden'});
        // Deliberately window the second stack, switch away, then reopen it.
        // This must restore its DICOM default rather than the edited cached VOI.
        if(compact)await tool('WindowLevel').click();
        await gesture(page,engine,touch,'window');
        assert.notDeepEqual((await state(page)).voi,{lower:-30,upper:869});
        for(const series of [1,2]){
          if(compact)await page.getByRole('button',{name:'Series',exact:true}).click();
          else await page.locator('[data-rispro-panel="left"] [data-cy="side-panel-header-left"]').first().click();
          const item=left.locator(`[data-cy="study-browser-thumbnail"][data-series="${series}"]`);
          if(touch)await item.tap();else await item.dblclick();
          await page.waitForFunction(uid=>{
            const s=window.services,v=s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());
            return v?.getCurrentImageId()?.includes('/series/'+uid+'/');
          },c.study+'.'+series);
          await pixels(page);await dicomWindow(page,series);
          if(!touch||width>=1024)await closePanel(page,'left');else await left.waitFor({state:'hidden'});
        }
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
        const result={engine,name,modality:c.modality,viewport:[width,height],touch,devicePixelRatio:await page.evaluate(()=>devicePixelRatio),gestureInput:touch?(engine==='chromium'?'CDP native touch':'DOM touch sequences'):'mouse',status:'PASS'};
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

export async function addReliabilityDocuments({c,dcmjs,archiveRequest}){
  const pdfObjects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length 46 >>\nstream\nBT /F1 12 Tf 20 100 Td (SYNTHETIC PDF) Tj ET\nendstream'];
  let pdf='%PDF-1.4\n';const offsets=[0];
  pdfObjects.forEach((value,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${value}\nendobj\n`;});
  const xref=Buffer.byteLength(pdf);
  pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  c.pdfDocument=Buffer.from(pdf).toString('base64');
  for(const [number,suffix,label] of [[5,'7','Request Documents'],[6,'104.2','Clinical Documents (unsupported CDA)'],[7,'104.1','Supported PDF'],[8,'7','Clinical Documents (scanned)']]){
    const sopClass='1.2.840.10008.5.1.4.1.1.'+suffix;
    const ds={SOPClassUID:sopClass,SOPInstanceUID:c.study+'.'+number+'.1',StudyInstanceUID:c.study,SeriesInstanceUID:c.study+'.'+number,
      PatientName:'SYNTHETIC^CT',PatientID:c.identifier,StudyDate:'20261027',StudyTime:'120000',
      AccessionNumber:'V2-'+String(c.appointmentId).padStart(6,'0'),Modality:suffix==='7'?'OT':'DOC',SeriesNumber:number,
      SeriesDescription:label,InstanceNumber:1};
    if(suffix==='7')Object.assign(ds,{_vrMap:{PixelData:'OW'},Rows:64,Columns:64,SamplesPerPixel:1,PhotometricInterpretation:'MONOCHROME2',
      BitsAllocated:16,BitsStored:16,HighBit:15,PixelRepresentation:0,ImageType:['DERIVED','SECONDARY'],
      PixelData:Uint16Array.from({length:4096},(_,i)=>i%64*20).buffer});
    else Object.assign(ds,{_vrMap:{EncapsulatedDocument:'OB'},MIMETypeOfEncapsulatedDocument:number===7?'application/pdf':'text/xml',
      DocumentTitle:label,EncapsulatedDocument:Uint8Array.from(Buffer.from(number===7?pdf:'<ClinicalDocument xmlns="urn:hl7-org:v3"/>')).buffer});
    const dict=new dcmjs.data.DicomDict(dcmjs.data.DicomMetaDictionary.denaturalizeDataset({MediaStorageSOPClassUID:sopClass,
      MediaStorageSOPInstanceUID:ds.SOPInstanceUID,TransferSyntaxUID:'1.2.840.10008.1.2.1',ImplementationClassUID:'2.25.202610270001'}));
    dict.dict=dcmjs.data.DicomMetaDictionary.denaturalizeDataset(ds);
    assert.equal((await archiveRequest('/instances',{method:'POST',headers:{'Content-Type':'application/dicom'},body:Buffer.from(dict.write())})).status,200);
  }
}

async function runReliabilityAcceptance({sourceContext,cases,origin,temp,launch}){
  const results=[];
  for(const [engine,browserType] of [['chromium',chromium],['webkit',webkit]]){
    if(selectedEngine&&selectedEngine!==engine)continue;
    const browser=await browserType.launch({headless:true});
    // This host's Chromium software GPU lacks EXT_texture_norm16. Removing
    // float-linear support also breaks its scalar textures, including stacks.
    // WebKit has norm16 and exercises the actual iOS-style SHORT scalar path.
    try{for(const capability of process.env.OHIF_RELIABILITY_CAPABILITY?[process.env.OHIF_RELIABILITY_CAPABILITY]:process.env.OHIF_RELIABILITY_PROBE||engine==='chromium'?['native']:['native','no-float-linear']){
      for(const desktop of [false,true]){
        if(selectedCase && (desktop?'desktop':'phone-portrait')!==selectedCase)continue;
        const label=engine+'-'+(desktop?'desktop':'phone')+'-'+capability;
        const context=await browser.newContext({...desktop?{}:devices['iPhone 13'],viewport:desktop?{width:1440,height:900}:{width:390,height:844},
          storageState:await sourceContext.storageState()});
        await context.addInitScript(installRenderingProbe);
        await context.addInitScript(({capability})=>{
          window.__glEvidence={uploads:[],scalarUploads:[],lost:0,messages:[]};
          document.addEventListener('webglcontextlost',()=>window.__glEvidence.lost++,true);
          for(const api of [window.WebGLRenderingContext,window.WebGL2RenderingContext].filter(Boolean)){
            const original=api.prototype.getExtension;
            api.prototype.getExtension=function(name){return capability==='no-float-linear'&&name==='OES_texture_float_linear'?null:original.call(this,name);};
            const upload=api.prototype.texImage2D;
            api.prototype.texImage2D=function(...args){
              if(args.length===9&&args[4]===2&&[this.FLOAT,this.UNSIGNED_BYTE].includes(args[7]))window.__glEvidence.uploads.push({width:args[3],format:[this.RED,this.LUMINANCE,this.ALPHA].includes(args[6])?'opacity':'color',type:args[7]===this.FLOAT?'FLOAT':'UNSIGNED_BYTE'});
              return upload.apply(this,args);
            };
            const sub=api.prototype.texSubImage2D;
            api.prototype.texSubImage2D=function(...args){
              if(args.length===9&&args[5]===2&&[this.FLOAT,this.UNSIGNED_BYTE].includes(args[7]))window.__glEvidence.uploads.push({width:args[4],format:[this.RED,this.LUMINANCE,this.ALPHA].includes(args[6])?'opacity':'color',type:args[7]===this.FLOAT?'FLOAT':'UNSIGNED_BYTE'});
              return sub.apply(this,args);
            };
            const scalar=api.prototype.texSubImage3D;
            if(scalar)api.prototype.texSubImage3D=function(...args){
              const type=args[9]===this.SHORT?'SHORT':args[9]===this.UNSIGNED_SHORT?'UNSIGNED_SHORT':args[9]===this.FLOAT?'FLOAT':String(args[9]);
              if(!window.__glEvidence.scalarUploads.includes(type))window.__glEvidence.scalarUploads.push(type);
              return scalar.apply(this,args);
            };
          }
        },{capability});
        const page=await context.newPage(),errors=[],consoleErrors=[],limitations=[];
        page.on('pageerror',e=>errors.push(e.stack||e.message));
        page.on('console',m=>{
          const text=m.text();
          if(/Loading plugin data.*object-src 'none'|because it does not appear in the object-src directive of the Content Security Policy/.test(text)){
            limitations.push('Existing OHIF PDF object blocked by viewer CSP; handler routing checked, PDF painting unverified.');return;
          }
          if(/Refused to execute a script because its hash, its nonce, or 'unsafe-inline'.*Content Security Policy/.test(text))return;
          // Existing bootstrap CSP notices and the tour's stale selectors are
          // recorded separately from renderer failures. Thumbnail disposal
          // deliberately invokes loseContext; the probe distinguishes it.
          if((m.type()==='error'||/WebGL.*(INVALID|error)/i.test(text)) &&
              !/Executing inline script violates|Shepherd step|advanceOn:|CONTEXT_LOST_WEBGL: loseContext/.test(text))consoleErrors.push(text);
        });
        const c=cases.find(c=>c.modality==='CT');
        // The fixture archive emits absolute loopback BulkDataURIs. Supply the
        // same synthetic PDF inline so its existing handler can be exercised
        // without granting a browser direct access to an archive origin.
        await page.route('**/ohif-dicomweb/**/metadata',async route=>{
          const response=await route.fetch(),data=await response.json();
          for(const instance of data)if(instance['00080016']?.Value?.[0]==='1.2.840.10008.5.1.4.1.1.104.1')instance['00420011']={vr:'OB',InlineBinary:c.pdfDocument};
          await route.fulfill({response,json:data});
        });
        const snapshot=()=>page.evaluate(()=>{
          const s=window.services,v=s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());
          const gl=v&&s.cornerstoneViewportService.getRenderingEngine().getOffscreenMultiRenderWindow(v.id).getOpenGLRenderWindow().getContext();
          return {type:v?.type,index:v?.getCurrentImageIdIndex(),slices:v?.getNumberOfSlices(),camera:v?.getCamera(),
            image:v?.getCurrentImageId(),overlay:[...document.querySelectorAll('.viewport-overlay')].map(el=>el.textContent).join(' '),gl:window.__glEvidence,
            probe:window.__renderProbe.events,layout:s.viewportGridService.getState().isHangingProtocolLayout,
            activeGL:gl&&{lost:gl.isContextLost(),error:gl.getError()},engine:s.cornerstoneViewportService.getRenderingEngine().id,
            norm16:!!gl?.getExtension('EXT_texture_norm16'),volumeType:v?.getVolumeId&&window.cornerstone.cache.getVolume(v.getVolumeId())?.dataType,
            pixels:window.__lastDiagnosticPixels};
        });
        const rendered=async()=>{
          await page.waitForFunction(()=>{
            try {
            const s=window.services,v=s?.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());
            if(!v||v.viewportStatus!=='rendered')return false;
            const c=document.createElement('canvas');c.width=c.height=96;
            const ctx=c.getContext('2d');ctx.drawImage(v.canvas,0,0,96,96);const data=ctx.getImageData(0,0,96,96).data;
            // Inspect the central image area. A uniformly dark image rectangle
            // surrounded by a black canvas must not count as diagnostic pixels.
            let lo=255,hi=0;for(let y=24;y<72;y++)for(let x=40;x<56;x++){
              const i=(y*96+x)*4;lo=Math.min(lo,data[i]);hi=Math.max(hi,data[i]);
            }
            window.__lastDiagnosticPixels={lo,hi,contrast:hi-lo};return hi-lo>20;
            } catch { return false; }
          },null,{timeout:process.env.OHIF_RELIABILITY_PROBE?20000:90000});
          const value=await snapshot();
          assert.ok(Number.isInteger(value.index)&&value.index>=0&&Number.isFinite(value.slices)&&value.slices>value.index,JSON.stringify(value));
          assert.ok(['focalPoint','position','viewUp','viewPlaneNormal'].every(key=>value.camera[key].every(Number.isFinite)),'Finite MPR camera');
          assert.ok(Number.isFinite(value.camera.parallelScale)&&value.camera.parallelScale>0,'Finite diagnostic scale');
          assert.doesNotMatch(value.overlay||'',/NaN|undefined|Infinity/);
          assert.deepEqual(value.activeGL,{lost:false,error:0},'Active diagnostic WebGL context must remain healthy');
          return value;
        };
        const select=async number=>{
          const left=page.locator('[data-rispro-panel="left"]');
          if(!await left.isVisible()){
            if(desktop)await page.locator('[data-rispro-panel="left"] [data-cy="side-panel-header-left"]').first().click();
            else await page.getByRole('button',{name:'Series',exact:true}).click();
          }
          const uid=await page.evaluate(number=>window.services.displaySetService.getActiveDisplaySets().find(ds=>ds.SeriesNumber===number)?.displaySetInstanceUID,number);
          const thumbnail=left.locator(`[id="thumbnail-${uid}"]`);
          await thumbnail.scrollIntoViewIfNeeded();
          // The description is a TooltipTrigger button on list rows. Tap the
          // series-number region so this tests selection, not the tooltip.
          const position={x:18,y:[6,7].includes(number)?30:55};
          if(desktop)await thumbnail.dblclick({position});else await thumbnail.tap({position});
        };
        try{
          console.log(JSON.stringify({reliabilityStage:{label,stage:'launch'}}));
          const prepared=await launch(c);assert.equal(prepared.status,'ready');
          await page.goto(origin+prepared.launchUrl,{waitUntil:'domcontentloaded'});await rendered();
          for(const label of ['Skip all','Confirm and hide']){
            const button=page.getByText(label,{exact:true});try{await button.waitFor({timeout:3000});await button.click();}catch(e){if(e.name!=='TimeoutError')throw e;}
          }
          await page.locator('.shepherd-modal-is-visible').waitFor({state:'hidden'});
          const metadata=await page.evaluate(()=>window.services.displaySetService.getActiveDisplaySets().map(ds=>({series:ds.SeriesNumber,sop:ds.SOPClassUID,
            handler:ds.SOPClassHandlerId,unsupported:ds.unsupported,frames:ds.numImageFrames,reconstructable:ds.isReconstructable})));
          writeFileSync(join(temp,label+'-displaysets.json'),JSON.stringify(metadata,null,2));
          if(process.env.OHIF_RELIABILITY_PROBE!=='documents'){
            await select(1);await rendered();
            for(const orientation of ['sagittal','coronal','axial']){
              console.log(JSON.stringify({reliabilityStage:{label,stage:orientation}}));
              await page.evaluate(orientation=>{
                const s=window.services,id=s.viewportGridService.getActiveViewportId(),v=s.cornerstoneViewportService.getCornerstoneViewport(id);
                if(v.type==='stack')window.commandsManager.runCommand('setDisplaySetsForViewports',{viewportsToUpdate:[{viewportId:id,
                  displaySetInstanceUIDs:s.viewportGridService.getDisplaySetsUIDsForViewport(id),viewportOptions:{viewportType:'orthographic',orientation},displaySetOptions:[{}]}]});
                else window.commandsManager.runCommand('setViewportOrientation',{viewportId:id,orientation});
              },orientation);
              await page.waitForFunction(()=>{const s=window.services,v=s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());return v?.type==='orthographic'&&window.cornerstone.cache.getVolume(v.getVolumeId())?.loadStatus.loaded;},null,{timeout:90000});
              await rendered();await page.screenshot({path:join(temp,label+'-'+orientation+'.png')});
            }
            const evidence=await page.evaluate(()=>window.__glEvidence);
            assert.ok(evidence.uploads.some(u=>u.format==='opacity'&&u.type===(capability==='no-float-linear'?'UNSIGNED_BYTE':'FLOAT')),'Expected actual opacity texture upload');
            if(capability==='no-float-linear')assert.ok(!evidence.uploads.some(u=>u.format==='opacity'&&u.type==='FLOAT'),'Unsupported float opacity texture must never be allocated');
            if(engine==='webkit'){
              assert.ok((await snapshot()).norm16,'Missing-extension volume test requires a valid integer scalar path');
              assert.ok(evidence.scalarUploads.includes('SHORT'),'Signed CT scalar textures must retain the SHORT path');
            }
            for(const number of [5,8]){
              await select(number);await rendered();
              assert.equal((await snapshot()).type,'stack','Non-reconstructable scanned documents must leave MPR');
              await select(1);await rendered();
              if(number===5){
                await page.evaluate(()=>{const s=window.services,id=s.viewportGridService.getActiveViewportId();window.commandsManager.runCommand('setDisplaySetsForViewports',{viewportsToUpdate:[{
                  viewportId:id,displaySetInstanceUIDs:s.viewportGridService.getDisplaySetsUIDsForViewport(id),viewportOptions:{viewportType:'orthographic',orientation:'sagittal'},displaySetOptions:[{}]}]});});
                await page.waitForFunction(()=>{const s=window.services;return s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId())?.type==='orthographic';});await rendered();
              }
            }
            await page.evaluate(()=>{const s=window.services,id=s.viewportGridService.getActiveViewportId(),ds=s.displaySetService.getActiveDisplaySets().find(ds=>ds.SeriesNumber===1);window.commandsManager.runCommand('setDisplaySetsForViewports',{
              viewportsToUpdate:[{viewportId:id,displaySetInstanceUIDs:[ds.displaySetInstanceUID],viewportOptions:{viewportType:'stack'},displaySetOptions:[{}]}]});});
            await page.waitForFunction(()=>{const s=window.services;return s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId())?.type==='stack';});
            await rendered();
            await select(2);await page.waitForFunction(uid=>{const s=window.services;return s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId())?.getCurrentImageId()?.includes('/series/'+uid+'/');},c.study+'.2');await rendered();
          }
          // OHIF's own grid-layout command changes the compatibility path:
          // getViewportsRequireUpdate returns early for custom layouts.
          await page.evaluate(()=>window.commandsManager.runCommand('setViewportGridLayout',{numRows:1,numCols:1}));
          await rendered();
          await page.waitForFunction(()=>window.services.viewportGridService.getState().isHangingProtocolLayout===false);
          for(const number of [5,8,6,7]){
            console.log(JSON.stringify({reliabilityStage:{label,stage:'document-'+number}}));
            await select(number);await page.waitForTimeout(1500);
            writeFileSync(join(temp,label+'-document-'+number+'.html'),await page.content());
            if([5,8].includes(number))await rendered();
            else if(number===6){assert.equal(errors.length,0,errors.join('\n'));await page.getByText(/not supported|unsupported content/i).first().waitFor({timeout:5000});}
            else {
              const pdf=page.locator('object[type="application/pdf"]');await pdf.waitFor({timeout:10000});
              assert.match(await pdf.getAttribute('data'),/^blob:/,'Existing supported PDF handler must still receive the document');
            }
            await select(2);await rendered();
          }
          if(!desktop&&!process.env.OHIF_RELIABILITY_PROBE){
            for(const failure of ['create','assign','orientation']){
              console.log(JSON.stringify({reliabilityStage:{label,stage:'recover-'+failure}}));
              await page.evaluate(failure=>{
                const s=window.services,id=s.viewportGridService.getActiveViewportId();
                if(failure==='orientation'){
                  // The prior cases leave a stack; first initialize a volume.
                  window.commandsManager.runCommand('setDisplaySetsForViewports',{viewportsToUpdate:[{viewportId:id,
                    displaySetInstanceUIDs:s.viewportGridService.getDisplaySetsUIDsForViewport(id),viewportOptions:{viewportType:'orthographic',orientation:'axial'},displaySetOptions:[{}]}]});
                  return;
                }
                const target=failure==='create'?s.cornerstoneCacheService:window.cornerstone.VolumeViewport.prototype;
                const key=failure==='create'?'createViewportData':'setVolumes',original=target[key];
                target[key]=async function(...args){target[key]=original;throw Error('SYNTHETIC MPR '+failure+' rejection');};
                window.commandsManager.runCommand('setDisplaySetsForViewports',{viewportsToUpdate:[{viewportId:id,
                  displaySetInstanceUIDs:s.viewportGridService.getDisplaySetsUIDsForViewport(id),viewportOptions:{viewportType:'orthographic',orientation:'sagittal'},displaySetOptions:[{}]}]});
              },failure);
              if(failure==='orientation'){
                await page.waitForFunction(()=>{const s=window.services,v=s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());return v?.type==='orthographic'&&window.cornerstone.cache.getVolume(v.getVolumeId())?.loadStatus.loaded;});
                await rendered();
                await page.evaluate(()=>{
                  const s=window.services,id=s.viewportGridService.getActiveViewportId(),v=s.cornerstoneViewportService.getCornerstoneViewport(id),original=v.setOrientation;
                  v.setOrientation=()=>{v.setOrientation=original;throw Error('SYNTHETIC MPR orientation rejection');};
                  window.commandsManager.runCommand('setViewportOrientation',{viewportId:id,orientation:'coronal'});
                });
              }
              await page.getByText('MPR unavailable',{exact:true}).first().waitFor();
              await page.waitForFunction(()=>{const s=window.services;return s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId())?.type==='stack';});
              await rendered();await select(1);await rendered();await select(2);await rendered();
              // Let the notification expire before the next independent fault.
              await page.waitForTimeout(7200);
            }
          }
          assert.equal(errors.length,0,errors.join('\n'));assert.equal(consoleErrors.length,0,consoleErrors.join('\n'));
          assert.deepEqual((await snapshot()).activeGL,{lost:false,error:0});
          results.push({label,status:'PASS',metadata,limitations:[...new Set(limitations)],final:await snapshot()});
          writeFileSync(join(temp,'reliability-results.json'),JSON.stringify(results,null,2));
          console.log(JSON.stringify({reliability:{label,status:'PASS'}}));
        }catch(error){
          writeFileSync(join(temp,label+'-failure.html'),await page.content());
          writeFileSync(join(temp,label+'-failure.json'),JSON.stringify({error:error.stack,errors,consoleErrors,state:await snapshot().catch(()=>null)},null,2));
          await page.screenshot({path:join(temp,label+'-failure.png')}).catch(()=>{});throw error;
        }finally{await context.close();}
      }
    }}finally{await browser.close();}
  }
  writeFileSync(join(temp,'reliability-results.json'),JSON.stringify(results,null,2));
}
