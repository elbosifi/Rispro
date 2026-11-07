const {test}=require('node:test');
const assert=require('node:assert/strict');
const {recoverMobileMpr,failedCacheCleanupGuard,createCornerstoneImageOwnership}=require('./configure-viewport-reliability.cjs');

test('late failed image-cache insertion cannot delete a newer same-key image load',()=>{
  const removeIfCurrent=new Function('cache','imageId','cachedImage',failedCacheCleanupGuard().replaceAll('this._imageCache','cache'));
  const cache=new Map(),old={},current={pixels:77};
  cache.set('same-image',current);
  removeIfCurrent(cache,'same-image',old);
  assert.equal(cache.get('same-image'),current,'A late old rejection must leave the replacement request registered');
  removeIfCurrent(cache,'same-image',current);
  assert.equal(cache.has('same-image'),false,'The active failed insertion must still be removed');
});

test('Cornerstone same-key load leases cancel one consumer and abort only the final consumer',async()=>{
  const requestPool={interaction:{0:[]}};
  const pool={getRequestPool:()=>requestPool};
  const ownership=createCornerstoneImageOwnership(pool,{getImageLoadObject:()=>undefined});
  let resolveImage,rejectImage,aborts=0;
  const pixels=new Uint16Array([7,1024,4095]);
  const shared=ownership.track('wadors:shared',{promise:new Promise((resolve,reject)=>{resolveImage=resolve;rejectImage=reject;}),cancelFn:()=>{aborts++;rejectImage(Object.assign(Error('transport aborted'),{name:'AbortError'}));}});
  const first=ownership.createConsumer(shared),second=ownership.createConsumer(shared);
  assert.equal(ownership.cancelConsumer('wadors:shared'),true);
  await assert.rejects(first.promise,{name:'AbortError'});
  resolveImage({getPixelData:()=>pixels});
  assert.deepEqual((await second.promise).getPixelData(),pixels);
  assert.equal(aborts,0,'The shared transport remains active while another Cornerstone consumer owns it');

  let rejectOld,oldAborts=0;
  const old=ownership.track('wadors:reused',{promise:new Promise((_,reject)=>{rejectOld=reject;}),cancelFn:()=>{oldAborts++;rejectOld(Object.assign(Error('old request canceled'),{name:'AbortError'}));}});
  const last=ownership.createConsumer(old);
  ownership.cancelConsumer('wadors:reused');
  await assert.rejects(last.promise,{name:'AbortError'});
  assert.equal(oldAborts,1,'Final consumer cancellation aborts the transport exactly once');
  let resolveNew;
  const current=ownership.track('wadors:reused',{promise:new Promise(resolve=>{resolveNew=resolve;})});
  await Promise.resolve();
  assert.equal(ownership.get('wadors:reused'),current,'Late cleanup from the canceled operation cannot unregister the replacement');
  resolveNew({getPixelData:()=>new Uint16Array([88])});
  await current.promise;
});

for (const canceledIndex of [0, 1]) {
  test(`a Cornerstone consumer cancel handle preserves the other consumer (cancel ${canceledIndex + 1})`,async()=>{
    const ownership=createCornerstoneImageOwnership({getRequestPool:()=>({})},{getImageLoadObject:()=>undefined});
    let resolveImage,aborts=0;
    const shared=ownership.track('wadors:two-owners',{promise:new Promise(resolve=>{resolveImage=resolve;}),cancelFn:()=>aborts++});
    const consumers=[ownership.createConsumer(shared),ownership.createConsumer(shared)];
    consumers[canceledIndex].cancelFn();
    await assert.rejects(consumers[canceledIndex].promise,{name:'AbortError'});
    const pixels=new Uint16Array([31,2048,65535]);
    resolveImage({getPixelData:()=>pixels});
    assert.deepEqual((await consumers[1-canceledIndex].promise).getPixelData(),pixels);
    assert.equal(aborts,0);
  });
}

test('image-key cancellation must target the requesting second consumer',async()=>{
  const ownership=createCornerstoneImageOwnership({getRequestPool:()=>({})},{getImageLoadObject:()=>undefined});
  let resolveImage;
  const shared=ownership.track('wadors:second-owner',{promise:new Promise(resolve=>{resolveImage=resolve;})});
  const first=ownership.createConsumer(shared),second=ownership.createConsumer(shared);
  let firstCanceled=false,secondCanceled=false;
  first.promise.catch(error=>{firstCanceled=error.name==='AbortError';});
  second.promise.catch(error=>{secondCanceled=error.name==='AbortError';});
  // The proposed owner argument makes the caller's intent explicit. The baseline
  // ignores it and cancels the first Set entry. Keep this failing until that API
  // can be corrected with evidence; production semantics are unchanged here.
  ownership.cancelConsumer('wadors:second-owner',second);
  await Promise.resolve();
  resolveImage({getPixelData:()=>new Uint16Array([73])});
  await Promise.allSettled([first.promise,second.promise]);
  assert.equal(firstCanceled,false,'Canceling the later owner must preserve the first owner');
  assert.equal(secondCanceled,true,'Only the requesting second owner should be canceled');
});

test('mobile MPR rejection restores only the affected static CT/MR stack once and does not overwrite later selection',()=>{
  const previous=global.window;
  let coarse=true,type='orthographic',uid='ct';
  global.window={matchMedia:()=>({matches:coarse})};
  const updates=[],notifications=[];
  const servicesManager={services:{viewportGridService:{getState:()=>({viewports:new Map([['viewport',{
    displaySetInstanceUIDs:[uid],viewportOptions:{viewportType:type},
  }]])}),setDisplaySetsForViewport:update=>{updates.push(update);type=update.viewportOptions.viewportType;}},
  uiNotificationService:{show:value=>notifications.push(value)}}};
  const sets=[{Modality:'CT',displaySetInstanceUID:'ct',images:[{}]}];
  const recover=()=>recoverMobileMpr(servicesManager,'viewport',sets,'orthographic',Error('synthetic initialization rejection'));
  try{
    coarse=false;assert.equal(recover(),false);assert.equal(updates.length,0);
    coarse=true;assert.equal(recover(),true);assert.equal(updates.length,1);
    assert.deepEqual(updates[0].displaySetInstanceUIDs,['ct']);assert.equal(updates[0].viewportOptions.viewportType,'stack');
    assert.equal(notifications.length,1);assert.equal(recover(),true);assert.equal(updates.length,1,'No retry or duplicate fallback');
    type='orthographic';uid='another';assert.equal(recover(),true);assert.equal(updates.length,1,'Late errors leave later series alone');
    assert.equal(recoverMobileMpr(servicesManager,'viewport',sets,'stack',Error()),false);
    assert.equal(recoverMobileMpr(servicesManager,'viewport',[{Modality:'DOC'}],'orthographic',Error()),false);
    assert.equal(recoverMobileMpr(servicesManager,'viewport',[...sets,...sets],'orthographic',Error()),false);
    assert.equal(recoverMobileMpr(servicesManager,'viewport',[{...sets[0],isDynamicVolume:true}],'orthographic',Error()),false,
      'OHIF forces dynamic data back to volume; it cannot safely use automatic stack recovery');
  }finally{global.window=previous;}
});
