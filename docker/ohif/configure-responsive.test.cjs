const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const {configureResponsive,selectSupportedDisplaySet}=require('./configure-responsive.cjs');

function fixture() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'rispro-responsive-patch-'));
  const write=(file,text)=>{const name=path.join(root,file);fs.mkdirSync(path.dirname(name),{recursive:true});fs.writeFileSync(name,text);};
  write('extensions/default/src/ViewerLayout/index.tsx',`const resizableHandleClassName = '';
useState(leftPanelClosed); useState(rightPanelClosed);
    leftPanelClosed,
    setLeft;
    rightPanelClosed,
    setRight;
  const handleMouseEnter = () => {};
    <div>
      <ViewerHeader />
<div className="relative flex w-full flex-row flex-nowrap items-stretch overflow-hidden bg-black" />
<ResizablePanel {...resizableLeftPanelProps}>
<ResizablePanel {...resizableRightPanelProps}>
<ViewportGridComp />`);
  write('extensions/default/src/ViewerLayout/ViewerHeader.tsx',"import { Button, Header, Icons, useModal } from '@ohif/ui-next';\nimport { Toolbar } from '../Toolbar/Toolbar';");
  write('extensions/default/src/Toolbar/Toolbar.tsx',"  buttonSection?: string;\nexport function Toolbar({ buttonSection = 'primary', viewportId, location }: ToolbarProps) {\n        if (!toolDef) { return null; }\n}");
  write('extensions/default/src/Panels/StudyBrowser/PanelStudyBrowser.tsx','function PanelStudyBrowser({\n        onClickThumbnail={() => {}}\n        onDoubleClickThumbnail={onDoubleClickThumbnailHandler}');
  write('platform/ui-next/src/components/Thumbnail/Thumbnail.tsx',"import React, { useState } from 'react';\n  const [lastTap, setLastTap] = useState(0);\n      onTouchEnd={handleTouchEnd}");
  write('platform/app/public/html-templates/index.html','width=device-width, initial-scale=1, shrink-to-fit=no, maximum-scale=1.0, user-scalable=no');
  const preserved=['modes/basic/src/initToolGroups.ts','extensions/cornerstone/src/Viewport/OHIFCornerstoneViewport.tsx','extensions/default/src/RisproLoading.tsx'];
  preserved.forEach(file=>write(file,'existing rendering, bindings and loading'));
  return {root,preserved};
}

test('responsive integration keeps the viewport and binding/loading sources and rejects upstream drift',()=>{
  const {root,preserved}=fixture();
  try {
    configureResponsive(root);
    for(const file of preserved)assert.equal(fs.readFileSync(path.join(root,file),'utf8'),'existing rendering, bindings and loading');
    const layout=fs.readFileSync(path.join(root,'extensions/default/src/ViewerLayout/index.tsx'),'utf8');
    assert.equal(layout.split('<ViewportGridComp />').length,2,'The original grid remains at the same mount location');
    assert.throws(()=>configureResponsive(root),/Pinned OHIF responsive anchor changed/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('thumbnail touch accepts one tap and rejects scrolling, multi-touch, cancellation and embedded menu controls', async()=>{
  const {thumbnailTouchHandlers}=await import('./responsive/thumbnailTouch.js');
  let calls=0,prevented=0,coarse=true;
  const gesture={current:null};
  const handler=()=>thumbnailTouchHandlers(gesture,()=>calls++,()=>coarse);
  const event=(x=20,y=20,touches=1,menu=false)=>({
    touches:Array.from({length:touches},(_,identifier)=>({identifier,clientX:x,clientY:y})),
    changedTouches:[{identifier:0,clientX:x,clientY:y}],
    target:{closest:()=>menu?{}:null},preventDefault:()=>prevented++,
  });
  handler().onTouchStart(event());
  handler().onTouchEnd(event(20,20,0));
  assert.equal(calls,1);assert.equal(prevented,1);
  handler().onTouchStart(event());handler().onTouchMove(event(20,55));
  handler().onTouchEnd(event(20,20,0));assert.equal(calls,1,'Moving away and back is a drag');
  handler().onTouchStart(event());handler().onTouchMove(event(20,20,2));
  handler().onTouchEnd(event(20,20,0));assert.equal(calls,1);
  handler().onTouchStart(event());handler().onTouchCancel();
  handler().onTouchEnd(event(20,20,0));assert.equal(calls,1);
  handler().onTouchStart(event(20,20,1,true));
  handler().onTouchEnd(event(20,20,0,true));assert.equal(calls,1);assert.equal(prevented,1);
  coarse=false;handler().onTouchStart(event());
  assert.equal(handler().onTouchEnd(event(20,20,0)),false,'Fine pointers retain the upstream handler');
});

test('touch series selection reuses the original selection and closes only after success; desktop retains double-click',async()=>{
  const {root}=fixture();
  try {
    configureResponsive(root);
    const source=fs.readFileSync(path.join(root,'extensions/default/src/Panels/StudyBrowser/PanelStudyBrowser.tsx'),'utf8');
    const handler=source.slice(source.indexOf('async uid =>'),source.indexOf('\n        }}')+10).trimEnd();
    let coarse=false,narrow=true,fail=false;
    const selections=[],events=[];
    const select=vm.runInNewContext('('+handler+')',{
      selectSupportedDisplaySet,
      commandsManager: {},
      window:{matchMedia:q=>({matches:q.includes('coarse')?coarse:narrow})},
      onDoubleClickThumbnailHandler:async uid=>{selections.push(uid);if(fail)throw Error('selection failed');},
      servicesManager:{services:{displaySetService:{getDisplaySetByUID:()=>({})},uiNotificationService:{show:()=>{}},panelService:{EVENTS:{PANELS_CHANGED:'changed'},_broadcastEvent:(...args)=>events.push(args)}}},
    });
    await select('synthetic.1');assert.equal(selections.length,0);
    coarse=true;await select('synthetic.2');assert.deepEqual(selections,['synthetic.2']);assert.equal(events[0][1].options.leftPanelClosed,true);
    narrow=false;await select('synthetic.3');assert.equal(events.length,1,'Landscape tablet sidebar stays open');
    narrow=true;fail=true;await select('synthetic.4');assert.equal(events.length,1,'Failed selection keeps the browser accessible');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('supported images without reconstruction geometry leave MPR through the existing stack command',async()=>{
  const ds={Modality:'OT',images:[{}],isReconstructable:false,SOPClassHandlerId:'@ohif/extension-default.sopClassHandlerModule.stack'};
  let selected=0;const updates=[];
  const servicesManager={services:{displaySetService:{getDisplaySetByUID:()=>ds},
    viewportGridService:{getActiveViewportId:()=> 'viewport'},
    cornerstoneViewportService:{getCornerstoneViewport:()=>({type:'orthographic'})},uiNotificationService:{show:()=>{}}}};
  assert.equal(await selectSupportedDisplaySet('scan',servicesManager,async()=>selected++,{run:(...args)=>updates.push(args)}),true);
  assert.equal(selected,0,'Do not send non-reconstructable geometry to a volume loader');
  assert.equal(updates[0][0],'setDisplaySetsForViewports');
  assert.equal(updates[0][1].viewportsToUpdate[0].viewportOptions.viewportType,'stack');
  ds.isReconstructable=true;
  await selectSupportedDisplaySet('ct',servicesManager,async()=>selected++,{});
  assert.equal(selected,1,'Reconstructable CT/MR retains ordinary selection');
});

test('unsupported SOP display sets never reach a diagnostic viewport; supported documents retain their handlers',async()=>{
  const sets={ct:{Modality:'CT'},mr:{Modality:'MR'},scan:{Modality:'OT',isReconstructable:false,messages:['warning']},
    pdf:{Modality:'DOC',SOPClassHandlerId:'dicom-pdf'},cda:{Modality:'DOC',unsupported:true}};
  const selected=[],notifications=[];
  const servicesManager={services:{displaySetService:{getDisplaySetByUID:uid=>sets[uid]},uiNotificationService:{show:value=>notifications.push(value)}}};
  for(const uid of ['ct','mr','scan','pdf'])assert.equal(await selectSupportedDisplaySet(uid,servicesManager,async uid=>selected.push(uid)),true);
  for(const uid of ['cda','missing'])assert.equal(await selectSupportedDisplaySet(uid,servicesManager,async uid=>selected.push(uid)),false);
  assert.deepEqual(selected,['ct','mr','scan','pdf']);assert.equal(notifications.length,2);
  assert.equal(await selectSupportedDisplaySet('pdf',servicesManager,async()=>{throw Error('handler rejected');}),false);
  assert.equal(await selectSupportedDisplaySet('ct',servicesManager,async uid=>selected.push(uid)),true);
});
