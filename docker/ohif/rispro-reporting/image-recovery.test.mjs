import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createConnection} from './src/connection.js';
const source=readFileSync(new URL('./src/image-recovery.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'').replaceAll('export ','');
function module(imageLoader,cache,connection) {return new Function('imageLoader','cache','connection',source+'\nreturn {installImageRecovery,trackImageRequest,retryDiagnosticImage};')(imageLoader,cache,connection);}
test('image recovery registers only WADO reads and cancels the original XHR through the pinned cancellation API',async()=>{
  for(const destroy of [false,true]){
  const target=new EventTarget();target.navigator={onLine:true};let loader,reject,xhr,aborts=0;
  const connection=createConnection({contextId:'tab',target,fetcher:async()=>Response.json({userId:7})});
  const api=module({registerImageLoader:(scheme,fn)=>{assert.equal(scheme,'wadors');loader=fn;}},{},connection);
  const options={priority:-5,requestType:'interaction',targetBuffer:{type:'Float32Array'}};
  api.installImageRecovery({wadors:{loadImage:(id,supplied)=>{
    assert.equal(supplied,options);xhr=new EventTarget();xhr.abort=()=>{aborts++;reject({status:0});xhr.dispatchEvent(new Event('loadend'));};api.trackImageRequest(id,xhr);
    return {promise:new Promise((_r,j)=>reject=j)};
  }}});
  const load=loader('wadors:frame',options);await new Promise(r=>setImmediate(r));if(destroy)connection.destroy();else load.cancelFn();await assert.rejects(load.promise);assert.equal(aborts,1);
  api.trackImageRequest('frame',null); // Progressive fetch beforeSend uses null.
  }
});
test('explicit image Retry displays the recovered frame in the same viewport with its presentation retained',async()=>{
  let renewals=0,reads=0,renders=0;const image={},camera={zoom:3},properties={voiRange:{lower:1,upper:7}};
  const viewport={getCurrentImageId:()=> 'wadors:frame',getCornerstoneImage:()=>image,getCamera:()=>camera,getProperties:()=>properties,
    renderImageObject:actual=>assert.equal(actual,image),setCamera:actual=>assert.equal(actual,camera),setProperties:actual=>assert.equal(actual,properties),render:()=>renders++};
  const api=module({loadAndCacheImage:async id=>{assert.equal(id,'wadors:frame');reads++;return image;}},{},{renew:async()=>renewals++,retry:()=>{}});
  await api.retryDiagnosticImage(viewport);assert.equal(renewals,1);assert.equal(reads,1);assert.equal(renders,1);
  assert.doesNotMatch(source,/location\.reload|setStack|destroy|purgeCache|removeImageLoadObject/);
});
