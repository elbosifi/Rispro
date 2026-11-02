import { imageLoader, cache } from '@cornerstonejs/core';
import { connection } from './connection';

const requests=new Map();
export function trackImageRequest(imageId,xhr) {
  if(!connection || !imageId || !xhr?.addEventListener)return;
  if(!requests.has(imageId))requests.set(imageId,new Set());
  requests.get(imageId).add(xhr);
  xhr.addEventListener('loadend',()=>{const pending=requests.get(imageId);pending?.delete(xhr);if(!pending?.size)requests.delete(imageId);},{once:true});
}

export function installImageRecovery(dicomImageLoader) {
  if (!connection) return;
  const original = dicomImageLoader.wadors.loadImage;
  imageLoader.registerImageLoader('wadors', (imageId, options) => {
    let load;
    const cancellation = new AbortController();
    const cancel=()=>{cancellation.abort();load?.cancelFn?.();requests.get(imageId)?.forEach(xhr=>xhr.abort());};
    return {
      promise: connection.read('image:' + imageId, () => { load = original(imageId, options); return load.promise; }, cancellation.signal,cancel),
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
