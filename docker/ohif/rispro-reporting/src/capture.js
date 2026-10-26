import { StackViewport, BaseVolumeViewport, metaData, Enums } from '@cornerstonejs/core';
import { utilities } from '@cornerstonejs/tools';

const nextPaint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const clean = value => JSON.parse(JSON.stringify(value, (key, item) => ArrayBuffer.isView(item) ? [...item] : item));
const frame = imageId => {
  // This pinned RISpro data source uses WADO-RS, whose frame URL is one based.
  // Do not guess the numbering of an unrelated WADO-URI loader.
  const match = /\/frames\/(\d+)(?:[/?#]|$)/.exec(imageId);
  return match ? Number(match[1]) : null;
};
export function createCaptureAdapter(servicesManager, commandsManager) {
  const { viewportGridService, cornerstoneViewportService, displaySetService } = servicesManager.services;
  const rendered = new WeakMap();
  const listener = event => {
    const viewport = cornerstoneViewportService.getCornerstoneViewport(event.detail?.viewportId);
    if (viewport) rendered.set(viewport, signature(viewport));
  };
  document.addEventListener(Enums.Events.IMAGE_RENDERED, listener, true);
  function displaySet(viewport) {
    const uids = viewportGridService.getState().viewports.get(viewport.id)?.displaySetInstanceUIDs;
    if (uids?.length !== 1) throw new Error('Capture supports a single CT/MRI source series. Fusion/multiple sources are not supported in v1.');
    const set = displaySetService.getDisplaySetByUID(uids[0]);
    if (!set || !['CT','MR'].includes(set.Modality)) throw new Error('Select a CT or MRI diagnostic viewport.');
    return set;
  }
  function signature(viewport) {
    return JSON.stringify({ image: viewport.getCurrentImageId?.(), index: viewport.getCurrentImageIdIndex?.(), target: viewport.getTargetImageIdIndex?.(),
      camera: clean(viewport.getCamera()), properties: clean(viewport.getProperties()),
      slab: viewport.getSlabThickness?.(), sets: viewportGridService.getState().viewports.get(viewport.id)?.displaySetInstanceUIDs,
      size: [viewport.canvas.width,viewport.canvas.height], blend: viewport.getActors?.().map(a=>a.actor?.getMapper?.()?.getBlendMode?.()) });
  }
  function svg(viewport) { return viewport.element.querySelector('svg.svg-layer'); }
  async function capture() {
    const id = viewportGridService.getActiveViewportId();
    const viewport = cornerstoneViewportService.getCornerstoneViewport(id);
    if (!(viewport instanceof StackViewport) && !(viewport instanceof BaseVolumeViewport)) throw new Error('Select a rendered stack or MPR/MIP viewport.');
    if (viewport.type === Enums.ViewportType.VOLUME_3D) throw new Error('3D volume rendering capture is outside v1. Select a stack or MPR/MIP plane.');
    const set = displaySet(viewport);
    if (viewport instanceof StackViewport && viewport.getTargetImageIdIndex?.() !== undefined
      && viewport.getTargetImageIdIndex() !== viewport.getCurrentImageIdIndex()) throw new Error('Scrolling is still loading an image. Wait for the diagnostic pixels and retry.');
    const before = signature(viewport);
    if (rendered.get(viewport) !== before) {
      // A render request changes no camera, tool state, stack, or image data.
      viewport.render(); await nextPaint();
    }
    if (rendered.get(viewport) !== before || signature(viewport) !== before) throw new Error('The viewport is still rendering. Wait and retry capture.');
    const source = viewport.canvas;
    if (source.width < 32 || source.height < 32) throw new Error('The active viewport has no diagnostic pixels.');
    const canvas = document.createElement('canvas');
    const scale = Math.min(1,4096/source.width,4096/source.height);
    canvas.width = Math.floor(source.width*scale); canvas.height = Math.floor(source.height*scale);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(source,0,0,canvas.width,canvas.height);
    // Reject blank/stale WebGL output before adding annotation or orientation text.
    const pixels = ctx.getImageData(0,0,canvas.width,canvas.height).data;
    let min=255,max=0;
    for(let i=0;i<pixels.length;i+=16) { min=Math.min(min,pixels[i]);max=Math.max(max,pixels[i]); }
    if(max-min<4) throw new Error('The rendered snapshot is blank. Wait for valid diagnostic pixels and retry.');
    const overlay = svg(viewport);
    const overlayBefore = overlay?.outerHTML;
    if (overlay) {
      const clone = overlay.cloneNode(true);
      clone.setAttribute('xmlns','http://www.w3.org/2000/svg');
      const box = overlay.getBoundingClientRect();
      clone.setAttribute('width',String(box.width)); clone.setAttribute('height',String(box.height));
      const originals=[overlay,...overlay.querySelectorAll('*')], copies=[clone,...clone.querySelectorAll('*')];
      originals.forEach((node,index)=>{
        const style=getComputedStyle(node);
        for(const name of ['font-family','font-size','font-weight','fill','stroke','stroke-width','opacity','visibility','display']) copies[index].style.setProperty(name,style.getPropertyValue(name));
      });
      const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)],{type:'image/svg+xml'}));
      try {
        const image=new Image();image.src=url;await image.decode();
        const bounds=viewport.element.getBoundingClientRect();
        ctx.drawImage(image,(box.left-bounds.left)/bounds.width*canvas.width,(box.top-bounds.top)/bounds.height*canvas.height,box.width/bounds.width*canvas.width,box.height/bounds.height*canvas.height);
      } finally {URL.revokeObjectURL(url);}
    }
    // Derive LPS labels from the actual displayed canvas geometry (including flips/obliquity).
    const origin=viewport.canvasToWorld([0,0]);
    const direction=point=>{const v=viewport.canvasToWorld(point).map((x,i)=>x-origin[i]);const n=Math.hypot(...v);return v.map(x=>x/n);};
    const {getOrientationStringLPS,invertOrientationStringLPS}=utilities.orientation;
    const right=getOrientationStringLPS(direction([1,0])),bottom=getOrientationStringLPS(direction([0,1]));
    ctx.font=`${Math.max(14,Math.round(canvas.width/65))}px sans-serif`;ctx.fillStyle='#fff';ctx.strokeStyle='#000';ctx.lineWidth=3;ctx.textAlign='center';
    [[invertOrientationStringLPS(bottom),canvas.width/2,24],[bottom,canvas.width/2,canvas.height-12],[invertOrientationStringLPS(right),22,canvas.height/2],[right,canvas.width-22,canvas.height/2]].forEach(([label,x,y])=>{ctx.strokeText(label,x,y);ctx.fillText(label,x,y);});
    const stack=viewport instanceof StackViewport;
    const imageId=stack?viewport.getCurrentImageId():null;
    const instance=imageId?metaData.get('instance',imageId):null;
    const sop=imageId?metaData.get('sopCommonModule',imageId):null;
    const blend=stack?null:viewport.getActors()[0]?.actor?.getMapper?.()?.getBlendMode?.();
    const provenance={studyInstanceUid:set.StudyInstanceUID,seriesInstanceUid:set.SeriesInstanceUID,
      sopInstanceUid:stack?(instance?.SOPInstanceUID || sop?.sopInstanceUID):null,
      frameNumber:stack?(frame(imageId) ?? (Number(instance?.NumberOfFrames || 1)===1?1:null)):null,
      frameOfReferenceUid:instance?.FrameOfReferenceUID || set.images?.[0]?.FrameOfReferenceUID || null,
      viewportType:stack?'stack':blend===(Enums.BlendModes?.MAXIMUM_INTENSITY_BLEND ?? 1)?'mip':'mpr',
      camera:clean(viewport.getCamera()),display:{...clean(viewport.getProperties()),rotation:viewport.getRotation?.(),
        framing:{origin:[...origin],right:[...viewport.canvasToWorld([1,0])],down:[...viewport.canvasToWorld([0,1])]}},
      slabThickness:stack?null:viewport.getSlabThickness(),blendMode:blend ?? null};
    if(stack && (!provenance.sopInstanceUid || !provenance.frameNumber)) throw new Error('This image has no reliable SOP/frame reference. Capture stopped.');
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    if (!blob || viewportGridService.getActiveViewportId()!==id || cornerstoneViewportService.getCornerstoneViewport(id)!==viewport
      || signature(viewport)!==before || svg(viewport)?.outerHTML!==overlayBefore) throw new Error('The viewport changed during capture. No image was uploaded. Retry after scrolling stops.');
    return {blob,provenance};
  }
  async function locate(source) {
    const sets=displaySetService.getActiveDisplaySets().filter(s=>s.StudyInstanceUID===source.studyInstanceUid && s.SeriesInstanceUID===source.seriesInstanceUid);
    if(sets.length!==1) throw new Error('Open the authorized source study/series from the Studies panel first.');
    const viewportId=viewportGridService.getActiveViewportId();
    commandsManager.runCommand('setDisplaySetsForViewports',{viewportsToUpdate:[{viewportId,displaySetInstanceUIDs:[sets[0].displaySetInstanceUID],viewportOptions:{viewportType:'stack'}}]});
    if(source.viewportType!=='stack') return;
    const deadline=Date.now()+10000;
    while(Date.now()<deadline) {
      const viewport=cornerstoneViewportService.getCornerstoneViewport(viewportId);
      if(viewport instanceof StackViewport) {
        const index=viewport.getImageIds().findIndex(imageId=>{
          const item=metaData.get('instance',imageId),common=metaData.get('sopCommonModule',imageId);
          return (item?.SOPInstanceUID || common?.sopInstanceUID)===source.sopInstanceUid && (frame(imageId)??1)===source.frameNumber;
        });
        if(index>=0) {await viewport.setImageIdIndex(index);viewport.render();return;}
      }
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    throw new Error('The saved SOP/frame is unavailable. The source series was opened.');
  }
  return {capture,locate,destroy:()=>document.removeEventListener(Enums.Events.IMAGE_RENDERED,listener,true)};
}
