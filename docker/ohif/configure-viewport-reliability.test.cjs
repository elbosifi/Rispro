const {test}=require('node:test');
const assert=require('node:assert/strict');
const {recoverMobileMpr}=require('./configure-viewport-reliability.cjs');

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
