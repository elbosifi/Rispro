import { imageLoader, cache } from '@cornerstonejs/core';
import { connection } from './connection';

const requests=new Map(),requestOwners=new Map();
let started=0,completed=0,canceled=0;
const canceledXhrs=new WeakSet();
export function getImageRequestDiagnostics() {
  const reads=connection?.getReadDiagnostics?.() || { pendingReads: 0, activeConsumers: 0 };
  return { ...reads, pendingTransports: [...requests.values()].reduce((count,set)=>count+set.size,0), started, completed, canceled };
}
export function trackImageRequest(imageId,xhr) {
  if(!connection || !imageId || !xhr?.addEventListener)return;
  if(!requests.has(imageId))requests.set(imageId,new Set());
  const pending=requests.get(imageId);pending.add(xhr);started++;
  const owner=requestOwners.get(imageId)?.at(-1);owner?.requests.add(xhr);
  xhr.addEventListener('loadend',()=>{
    pending.delete(xhr);if(!pending.size&&requests.get(imageId)===pending)requests.delete(imageId);
    if(canceledXhrs.has(xhr)) canceled++; else if(xhr.status >= 200 && xhr.status < 300) completed++;
    owner?.requests.delete(xhr);
  },{once:true});
}

function withRequestOwner(imageId,owner,work) {
  if(!requestOwners.has(imageId))requestOwners.set(imageId,[]);
  const stack=requestOwners.get(imageId);stack.push(owner);
  try{return work();}finally{stack.pop();if(!stack.length)requestOwners.delete(imageId);}
}

export function installImageRecovery(dicomImageLoader) {
  if (!connection) return;
  const original = dicomImageLoader.wadors.loadImage;
  imageLoader.registerImageLoader('wadors', (imageId, options) => {
    const cancellation = new AbortController();
    const owner={requests:new Set(),aborted:false};let load;
    const cancel=()=>cancellation.abort();
    const cancelTransport=()=>{
      if(owner.aborted)return;owner.aborted=true;
      if(typeof load?.cancelFn==='function') {
        owner.requests.forEach(xhr=>canceledXhrs.add(xhr));
        try { load.cancelFn(); }
        catch(error) {
          for(const xhr of owner.requests)if(xhr.readyState!==4){canceledXhrs.add(xhr);xhr.abort();}
          throw error;
        }
      } else for(const xhr of owner.requests)if(xhr.readyState!==4){canceledXhrs.add(xhr);xhr.abort();}
    };
    return {
      promise: connection.read('image:' + imageId, operationSignal => {
        if(operationSignal?.aborted)throw new DOMException('Image request canceled.','AbortError');
        load=withRequestOwner(imageId,owner,()=>original(imageId,options));
        return load.promise;
      }, cancellation.signal,cancelTransport),
      cancelFn: cancel,
    };
  });
}

export async function retryDiagnosticImage(viewport) {
  await connection?.renew();
  connection?.retry();
  if (!viewport) throw new Error('Select a diagnostic series, then retry.');
  const imageId = viewport.getCurrentImageId?.();
  if (!imageId) {
    const volume=cache.getVolume(viewport.getVolumeId?.());
    if(!volume)throw new Error('Select a diagnostic series, then retry.');
    volume.load();viewport.render();return;
  }
  const preserve=!!viewport.getCornerstoneImage?.(),camera=viewport.getCamera(),properties=viewport.getProperties();
  const image = await imageLoader.loadAndCacheImage(imageId);
  // v4.15.29 public StackViewport API displays a recovered image without
  // resetting its stack, rendering engine, camera, properties or annotations.
  if (viewport.getCurrentImageId() === imageId) {
    if(!viewport.useCPURendering && viewport.successCallback)viewport.successCallback(imageId,image);
    else viewport.renderImageObject(image);
    // setProperties is also the public transition from the initial LOADING
    // state to PRE_RENDER. Without it real pixels render behind a stuck overlay.
    viewport.setProperties(preserve?properties:viewport.getProperties());
    if(preserve)viewport.setCamera(camera);
    viewport.render();
  }
}
