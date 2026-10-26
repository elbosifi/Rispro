import React from 'react';
import { Button } from '@ohif/ui-next';
import { createReportStore } from './report-store';
import { createCaptureAdapter } from './capture';
import ReportPanel from './ReportPanel';

const id='@rispro/extension-reporting',panel=id+'.panelModule.report';
let store,adapter,subscriptions=[],beforeUnload;
function show(servicesManager) {
  const service=servicesManager.services.panelService;
  // v3.12.6's wrapper retains closedManually even for forceActive. Its layout
  // accepts this existing public PubSub event to reopen without resetting panels.
  service._broadcastEvent(service.EVENTS.PANELS_CHANGED,{position:'right',options:{rightPanelClosed:false}});
  service.activatePanel(panel,true);
}
const extension={
  id,
  getPanelModule(){return [{name:'report',iconName:'tab-linear',iconLabel:'Report',label:'Report',component:()=>store?<ReportPanel store={store}/>:null}];},
  getToolbarModule({servicesManager}){return [{name:'risproReport',defaultComponent:({action,label})=><Button variant="ghost" onClick={()=>{
    show(servicesManager);if(action==='capture')store.capture().catch(store.setError);
  }}>{label}</Button>}];},
  onModeEnter({servicesManager,commandsManager}) {
    const contextId=new URLSearchParams(window.location.search).get('risproContext');
    if(!contextId)return;
    adapter=createCaptureAdapter(servicesManager,commandsManager);
    store=createReportStore({contextId,captureViewport:adapter.capture,locateSource:adapter.locate});
    const activeStore=store;
    beforeUnload=e=>{if(store.hasUnsaved()){e.preventDefault();e.returnValue='';}};
    window.addEventListener('beforeunload',beforeUnload);
    const {panelService,toolbarService}=servicesManager.services;
    const install=()=>{
      if(store!==activeStore)return;
      if(!panelService.getPanels('right').length || panelService.getPanels('right').some(p=>p.id===panel))return;
      panelService.addPanels('right',[panel],{});
      toolbarService.register([
        {id:'RISproReport',uiType:'risproReport',props:{label:'Report',action:'report'}},
        {id:'RISproKeyImage',uiType:'risproReport',props:{label:'Add Key Image',action:'capture'}},
      ]);
      toolbarService.updateSection('primary',['RISproReport',...(store.getSnapshot().context?.canEdit?['RISproKeyImage']:[])]);
    };
    store.load().then(context=>{
      if(store===activeStore && (context.enabled || context.report)) {
        install();subscriptions.push(panelService.subscribe(panelService.EVENTS.PANELS_CHANGED,install));
      }
    }).catch(error=>{if(store===activeStore){store.setError(error);install();}});
  },
  onModeExit(){subscriptions.forEach(s=>s.unsubscribe());subscriptions=[];window.removeEventListener('beforeunload',beforeUnload);store?.destroy();adapter?.destroy();store=null;adapter=null;},
};
export default extension;
