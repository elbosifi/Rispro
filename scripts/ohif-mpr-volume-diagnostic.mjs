// Paired diagnostic experiment on the native-reporting script's disposable
// synthetic fixture. Does not change viewer limits or application behavior.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {installMprFrameProbe} from './ohif-mpr-frame-probe.mjs';

export async function runMprVolumeDiagnostic({browser,context:source,c,origin,apiOrigin,temp,launch,installRenderingProbe,pixels,selectSeries,rapidLargeStackSwitch}) {
  const repetitions=Number(process.env.OHIF_MPR_DIAGNOSTIC_PAIRS||4),frameDelayMs=Number(process.env.OHIF_MPR_FRAME_DELAY_MS||0),requireCacheFill=process.env.OHIF_MPR_REQUIRE_CACHE_FILL==='1',results=[];
  assert.ok(Number.isSafeInteger(repetitions)&&repetitions>0&&repetitions<=12);
  assert.ok(Number.isSafeInteger(frameDelayMs)&&frameDelayMs>=0&&frameDelayMs<=250,'Synthetic frame delay must be between 0 and 250 milliseconds');
  const gpuSession=await browser.newBrowserCDPSession();
  writeFileSync(join(temp,'mpr-gpu.json'),JSON.stringify((await gpuSession.send('SystemInfo.getInfo')).gpu,null,2));await gpuSession.detach();
  const redact=value=>String(value).replace(/https?:\/\/[^\s)'"<>]+/g,'<url>').replace(/\b\d+(?:\.\d+){3,}\b/g,'<identifier>').slice(0,1200);
  for(let attempt=0;attempt<repetitions;attempt++)for(const switching of [false,true]){
    const stage=`mpr-${attempt}-${switching?'switch':'control'}`,events=[];
    const context=await browser.newContext({viewport:{width:1600,height:1000},storageState:await source.storageState(),ignoreHTTPSErrors:true});
    await context.addInitScript(installRenderingProbe);await context.addInitScript(installMprFrameProbe);
    if(frameDelayMs)await context.route('**/frames/**',async route=>{await new Promise(resolve=>setTimeout(resolve,frameDelayMs));await route.continue().catch(()=>{});});
    const page=await context.newPage();let outcome='initializing';
    page.on('pageerror',e=>events.push({type:'pageerror',message:redact(e.message),stack:redact(e.stack)}));
    page.on('console',m=>{if(['warning','error'].includes(m.type())&&events.length<100)events.push({type:m.type(),message:redact(m.text())});});
    try{
      const prepared=await launch(false),exchange=await context.request.get(apiOrigin+prepared.launchUrl,{maxRedirects:0});assert.equal(exchange.status(),302);
      await context.addCookies((await context.cookies()).filter(cookie=>cookie.domain===new URL(apiOrigin).hostname).map(cookie=>({...cookie,domain:new URL(origin).hostname})));
      const url=new URL(exchange.headers().location,origin).href;
      if(switching)await rapidLargeStackSwitch(page,c,[],()=>page.goto(url,{waitUntil:'domcontentloaded',timeout:60000}),{fallThrough:!!frameDelayMs});
      else await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
      await pixels(page);
      for(const name of ['Skip all','Confirm and hide']){const button=page.getByText(name,{exact:true});if(await button.isVisible()){await button.click();await button.waitFor({state:'hidden'});}}
      // Both cases end on A with the same 18 stack index changes and peer tab.
      // The control never selects B. The optional transport latency is identical
      // in both cases; it does not change any application limits or retries.
      for(let cycle=0;cycle<6;cycle++){
        if(switching)await selectSeries(page,c.study,c.study+'.'+(cycle%2===0?2:1));
        for(const index of [0,Math.floor(c.slices/2),c.slices-1]){
          await page.evaluate(async index=>{const s=window.services,v=s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());await v.setImageIdIndex(index);v.render();},index);
          await pixels(page);
        }
      }
      if(requireCacheFill){
        const waitForBulkQueue=async series=>{
          await page.waitForFunction(({series,min})=>{
            const pool=window.cornerstone.imageLoadPoolManager.getRequestPool().prefetch||{};
            return Object.values(pool).flat().filter(q=>q.additionalDetails?.imageId?.includes('/series/'+series+'/')).length>=min;
          },{series,min:Math.floor(c.slices*0.75)},{timeout:30000});
        };
        if(switching){await selectSeries(page,c.study,c.study+'.2');await waitForBulkQueue(c.study+'.2');await selectSeries(page,c.study,c.study+'.1');}
        await waitForBulkQueue(c.study+'.1');
      }
      const peer=await context.newPage();try{await peer.goto(page.url(),{waitUntil:'domcontentloaded'});await pixels(peer);}finally{await peer.close();}
      const activation=await page.evaluate(()=>window.__mprFrameProbe.activate());
      writeFileSync(join(temp,stage+'-activation.json'),JSON.stringify(activation,null,2));
      console.log(JSON.stringify({mprDiagnostic:stage,event:'activation'}));
      await page.evaluate(()=>window.commandsManager.runCommand('setHangingProtocol',{protocolId:'mpr'}));
      outcome='loading';
      try{await pixels(page,true);outcome='success';}catch(error){outcome='timeout';events.push({type:'wait',name:error.name});}
      const trace=await page.evaluate(outcome=>({terminal:window.__mprFrameProbe.snapshot(outcome,true),timed:window.__mprFrameProbe.history(),gpu:window.__renderProbe.events.map(({type,ms,width,height,depth,contextLost,requested})=>({type,ms,width,height,depth,contextLost,requested}))}),outcome);
      const selected=await page.evaluate(series=>{const s=window.services,vs=[...s.viewportGridService.getState().viewports.keys()].map(id=>s.cornerstoneViewportService.getCornerstoneViewport(id));return vs.every(v=>v?.getImageIds?.().every(id=>id.includes('/series/'+series+'/')));},c.study+'.1');
      const active=trace.terminal.volumes.find(v=>v.active);
      writeFileSync(join(temp,stage+'-'+outcome+'.json'),JSON.stringify({stage,switching,frameDelayMs,requireCacheFill,outcome,selected,events,...trace},null,2));
      await page.screenshot({path:join(temp,stage+'-'+outcome+'.png')});
      assert.equal(selected,true,'Every MPR viewport must still reference the selected synthetic series');
      const summary={stage,switching,outcome,selected,framesProcessed:active?.framesProcessed,totalNumFrames:active?.totalNumFrames,pending:active?.pending,activeQueued:trace.terminal.pools.load.activeVolumeQueued,globalQueued:trace.terminal.pools.load.queued};results.push(summary);console.log(JSON.stringify({mprDiagnostic:summary}));
    }catch(error){writeFileSync(join(temp,stage+'-setup-failure.json'),JSON.stringify({events,error:redact(error.message)},null,2));throw error;}
    finally{await context.close();}
    if(!switching)continue;
    if(results.some(r=>r.outcome==='timeout')&&results.some(r=>r.outcome==='success')){
      writeFileSync(join(temp,'mpr-diagnostic-summary.json'),JSON.stringify(results,null,2));
      assert.equal(results.filter(r=>r.outcome==='timeout').length,0,'MPR initialization must complete for the current selection within the existing 120-second deadline');
      return results;
    }
  }
  writeFileSync(join(temp,'mpr-diagnostic-summary.json'),JSON.stringify(results,null,2));
  console.log('MPR diagnostic completed without a reproduced timeout; do not infer a fix.');return results;
}
