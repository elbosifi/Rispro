// Extends the existing disposable DB + real OHIF/Orthanc browser journey.
import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import jwt from 'jsonwebtoken';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

export async function prepareInitialRetry(page,c) {
  let failed=true;
  const matches=url=>url.pathname.includes('/studies/'+c.study+'/series/'+c.study+'.1/') && url.pathname.includes('/frames/');
  const route=async route=>failed?route.fulfill({status:404,body:'Synthetic missing first frame'}):route.continue();
  await page.route(matches,route);
  return async()=>{
    const retry=page.getByRole('button',{name:'Retry',exact:true});await expect(retry).toBeVisible({timeout:30000});
    await page.evaluate(()=>{const s=window.services,v=s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());window.__initialRecovery={document,viewport:v,engine:v.getRenderingEngine()};});
    failed=false;await retry.click();
    await page.waitForFunction(()=>{const s=window.services,v=s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId()),image=window.cornerstone.cache.getImage(v?.getCurrentImageId?.());return image?.getPixelData?.()?.length && v.viewportStatus===window.cornerstone.Enums.ViewportStatus.RENDERED;},null,{timeout:30000});
    assert.equal(await page.evaluate(()=>{const s=window.services,v=s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId()),p=window.__initialRecovery;return p.document===document&&p.viewport===v&&p.engine===v.getRenderingEngine();}),true);
    await page.unroute(matches,route);
  };
}

export async function runResilience({page,panel,context,pool,env,userId,credentials,c,temp,nativeDelivery}) {
  panel=page.locator('.rispro-report');
  const contextId=new URL(page.url()).searchParams.get('risproContext'),origin=new URL(page.url()).origin;
  const findings=panel.getByLabel('Findings',{exact:true});
  let navigations=0;const navigation=frame=>{if(frame===page.mainFrame())navigations++;};page.on('framenavigated',navigation);
  await page.evaluate(()=>{
    const s=window.services,v=s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId()),core=window.cornerstone;
    v.setZoom(v.getZoom()*1.15);v.setPan([11,7]);v.render();
    const imageId=v.getCurrentImageId(),image=core.cache.getImage(imageId),points=[v.canvasToWorld([80,80]),v.canvasToWorld([120,120])];
    const annotation={annotationUID:'resilience-length',highlighted:false,invalidated:true,isLocked:false,isVisible:true,
      metadata:{toolName:'Length',viewPlaneNormal:v.getCamera().viewPlaneNormal,viewUp:v.getCamera().viewUp,FrameOfReferenceUID:core.metaData.get('imagePlaneModule',imageId).frameOfReferenceUID,referencedImageId:imageId},
      data:{label:'SYNTHETIC RESILIENCE',handles:{points,activeHandleIndex:null,textBox:{hasMoved:false,worldPosition:[0,0,0],worldBoundingBox:{topLeft:[0,0,0],topRight:[0,0,0],bottomLeft:[0,0,0],bottomRight:[0,0,0]}}}}};
    window.cornerstoneTools.annotation.state.addAnnotation(annotation,v.element);
    window.__resilience={document,canvas:v.canvas,viewport:v,engine:v.getRenderingEngine(),image,imageId,index:v.getCurrentImageIdIndex(),camera:v.getCamera(),properties:v.getProperties(),pixels:Array.from(image.getPixelData()),annotation};
  });
  const retainedUrl=await page.evaluate(()=>new URL(window.__resilience.imageId.slice('wadors:'.length),location.origin).href);
  let cachedRequests=0;const cachedRequest=request=>{if(request.url()===retainedUrl)cachedRequests++;};page.on('request',cachedRequest);
  const verify=async()=>{
    const proof=await page.evaluate(()=>{
      const p=window.__resilience,s=window.services,v=s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());
      return {document:p.document===document,canvas:p.canvas===v.canvas,viewport:p.viewport===v,engine:p.engine===v.getRenderingEngine(),image:p.image===window.cornerstone.cache.getImage(p.imageId),
        index:v.getCurrentImageIdIndex(),camera:v.getCamera(),properties:v.getProperties(),pixels:Array.from(window.cornerstone.cache.getImage(p.imageId).getPixelData()),annotation:window.cornerstoneTools.annotation.state.getAnnotation('resilience-length')===p.annotation,
        expected:{index:p.index,camera:p.camera,properties:p.properties,pixels:p.pixels}};
    });
    for(const key of ['document','canvas','viewport','engine','image','annotation'])assert.equal(proof[key],true,key+' survives');
    for(const key of ['index','camera','properties','pixels'])assert.deepEqual(proof[key],proof.expected[key],key+' survives');
    assert.equal(navigations,0,'No page navigation or reload');
    assert.equal(cachedRequests,0,'The retained diagnostic image is never downloaded again');
  };
  const retained='SYNTHETIC unsaved '+c.modality+' findings retained through expiry.';
  // Dictation deliberately keeps this text dirty across authentication recovery.
  await findings.evaluate((el,text)=>{el.dataset.dictationInserting='true';const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(el,text);el.dispatchEvent(new Event('input',{bubbles:true}));delete el.dataset.dictationInserting;},retained);
  await expect(findings).toHaveValue(retained);
  await pool.query("update viewer_launch_sessions set expires_at=now()-interval '12 hours' where report_context_id=$1",[contextId]);
  const expired=jwt.sign({sub:userId,role:'doctor',authVersion:0},env.jwtSecret,{expiresIn:-1});
  await context.addCookies([{name:env.cookieName,value:expired,url:origin,httpOnly:true}]);
  await panel.getByRole('button',{name:'Save',exact:true}).click();
  const dialog=page.getByRole('dialog');await expect(dialog.getByText('Authentication required',{exact:true})).toBeVisible();
  await expect(dialog).toHaveCSS('opacity','1');assert.ok((await dialog.boundingBox()).width<=480,'The sign-in modal stays small on desktop');
  await page.screenshot({path:join(temp,c.modality+'-authentication-desktop.png')});
  await verify();await expect(findings).toHaveValue(retained);
  await dialog.getByLabel('Username',{exact:true}).fill(credentials.username);await dialog.getByLabel('Password',{exact:true}).fill(credentials.password);
  await dialog.getByRole('button',{name:'Sign in',exact:true}).click();await expect(dialog).toBeHidden();
  await expect(findings).toHaveValue(retained);await verify();
  const saved=await page.evaluate(async id=>(await (await fetch('/api/native-reporting/appointments/'+id)).json()).report,c.appointmentId);
  assert.notEqual(saved.sections.findings,retained,'Dictated text still requires explicit Save');
  await panel.getByRole('button',{name:'Save',exact:true}).click();await panel.getByRole('status').filter({hasText:/^Saved$/}).waitFor();

  // Simulate eviction of one synthetic, non-visible frame. Keep the currently
  // displayed image in cache and assert identical decoded values after retry.
  const missing=await page.evaluate(async()=>{
    const p=window.__resilience,id=p.viewport.getImageIds().find(id=>id!==p.imageId),image=await window.cornerstone.imageLoader.loadAndCacheImage(id);
    window.__retryPixels=Array.from(image.getPixelData());
    window.cornerstone.cache.removeImageLoadObject(id);
    return {id,url:id.slice('wadors:'.length)};
  });
  assert.ok(missing.url.includes(nativeDelivery?'/ohif-native/':'/ohif-dicomweb/'),'Exercise the selected actual diagnostic transport');
  let attempts=0,active=0,maxActive=0;
  const route=async route=>{
    attempts++;active++;maxActive=Math.max(maxActive,active);
    try {if(attempts<=3)await route.fulfill({status:[502,503,504][attempts-1],body:'Synthetic temporary outage'});else await route.continue();}finally{active--;}
  };
  await page.route(new URL(missing.url,origin).href,route);
  await page.evaluate(id=>Promise.all([window.cornerstone.imageLoader.loadAndCacheImage(id),window.cornerstone.imageLoader.loadAndCacheImage(id)]).then(([a,b])=>{if(a!==b)throw Error('Duplicate decoded image');}),missing.id);
  assert.equal(attempts,4);assert.equal(maxActive,1);await page.unroute(new URL(missing.url,origin).href,route);
  await verify();
  assert.equal(await page.evaluate(id=>!window.__retryPixels||JSON.stringify(window.__retryPixels)===JSON.stringify(Array.from(window.cornerstone.cache.getImage(id).getPixelData())),missing.id),true);

  await page.evaluate(id=>window.cornerstone.cache.removeImageLoadObject(id),missing.id);attempts=0;
  await page.route(new URL(missing.url,origin).href,async route=>{attempts++;if(attempts===1)await route.abort('connectionreset');else {await new Promise(r=>setTimeout(r,400));await route.continue();}});
  await page.evaluate(id=>window.cornerstone.imageLoader.loadAndCacheImage(id).then(()=>true),missing.id);assert.equal(attempts,2);await page.unroute(new URL(missing.url,origin).href);await verify();
  assert.equal(await page.evaluate(id=>JSON.stringify(window.__retryPixels)===JSON.stringify(Array.from(window.cornerstone.cache.getImage(id).getPixelData())),missing.id),true);

  await context.setOffline(true);await findings.fill(retained+' Offline edit.');await expect(panel.getByRole('status').filter({hasText:/Reconnecting/})).toBeVisible();await verify();
  await context.setOffline(false);await expect(panel.getByRole('status').filter({hasText:/^Saved$/})).toBeVisible({timeout:30000});await expect(findings).toHaveValue(retained+' Offline edit.');await verify();
  await page.setViewportSize({width:390,height:844});
  if(!await panel.isVisible())await page.getByRole('button',{name:'Report',exact:true}).first().click();
  await context.addCookies([{name:env.cookieName,value:expired,url:origin,httpOnly:true}]);
  await findings.fill(retained+' Phone.');await panel.getByRole('button',{name:'Save',exact:true}).click();await expect(dialog.getByText('Authentication required',{exact:true})).toBeVisible();
  await expect(dialog).toHaveCSS('opacity','1');
  await page.screenshot({path:join(temp,c.modality+'-authentication-phone.png')});
  const bounds=await dialog.boundingBox();assert.ok(bounds.width<=390);
  await dialog.getByLabel('Username',{exact:true}).fill(credentials.username);await dialog.getByLabel('Password',{exact:true}).fill(credentials.password);await dialog.getByRole('button',{name:'Sign in',exact:true}).click();await expect(dialog).toBeHidden();
  await page.setViewportSize({width:1600,height:1000});
  await panel.getByRole('button',{name:'Save',exact:true}).click();await panel.getByRole('status').filter({hasText:/^Saved$/}).waitFor();
  const final=await page.evaluate(async id=>(await (await fetch('/api/native-reporting/appointments/'+id)).json()).report,c.appointmentId);
  assert.equal(final.status,'draft');assert.equal(final.addenda?.length||0,0);
  page.off('framenavigated',navigation);
  page.off('request',cachedRequest);
  console.log(JSON.stringify({resilience:'PASS',modality:c.modality,transport:nativeDelivery?'Native':'Express',sameDocument:true,sameRenderingEngine:true,sameViewport:true,cachedPixels:true,annotation:true,unsavedText:true,inPageLogin:true,contextRecovery:true,networkRetries:true,noDuplicateRequests:true,noSigning:true}));
}

export async function runTabIsolation({pages,context,pool,env,userId}) {
  const origin=new URL(pages[0].url()).origin,other=(await pool.query("insert into users(username,full_name,password_hash,role,is_active) values($1,'SYNTHETIC OTHER USER','disabled','doctor',true) returning id",['resilience-other-'+randomUUID()])).rows[0].id;
  const values=[];
  try {
    for(const page of pages){
      const value='SYNTHETIC independent unsaved tab '+values.length;values.push(value);
      await page.locator('textarea[aria-label="Findings"]').evaluate((el,text)=>{el.dataset.dictationInserting='true';Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,text);el.dispatchEvent(new Event('input',{bubbles:true}));delete el.dataset.dictationInserting;},value);
    }
    await context.addCookies([{name:env.cookieName,value:jwt.sign({sub:other,role:'doctor',authVersion:0},env.jwtSecret,{expiresIn:'1h'}),url:origin,httpOnly:true}]);
    await pages[0].evaluate(()=>{const channel=new BroadcastChannel('rispro-session');channel.postMessage({type:'session-changed'});channel.close();});
    for(let i=0;i<pages.length;i++){
      await expect(pages[i].getByRole('dialog').getByText('Viewer access stopped',{exact:true})).toBeVisible();
      assert.equal(await pages[i].locator('textarea[aria-label="Findings"]').inputValue(),values[i]);
    }
    // A fresh original-user login cannot revive explicitly logged-out contexts.
    const original=jwt.sign({sub:userId,role:'doctor',authVersion:0},env.jwtSecret,{expiresIn:'1h'});
    await context.addCookies([{name:env.cookieName,value:original,url:origin,httpOnly:true}]);
    assert.equal((await pages[0].evaluate(async()=>({status:(await fetch('/api/auth/logout',{method:'POST'})).status}))).status,204);
    await context.addCookies([{name:env.cookieName,value:original,url:origin,httpOnly:true}]);
    const contextId=new URL(pages[0].url()).searchParams.get('risproContext');
    const denied=await pages[0].evaluate(async id=>(await fetch('/api/ohif/contexts/'+id+'/renew',{method:'POST'})).status,contextId);assert.equal(denied,403);
    console.log(JSON.stringify({resilience:'PASS',tabIsolation:true,changedUserDenied:true,logoutRevokesContexts:true,unsavedTextRetained:true}));
  } finally {await pool.query('delete from users where id=$1',[other]);}
}
