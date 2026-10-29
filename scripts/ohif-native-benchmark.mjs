// Invoked only inside the synthetic, disposable-DB reporting harness.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { gunzipSync } from 'node:zlib';
const require = createRequire(import.meta.url), dcmjs = require('dcmjs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function installProbe() {
  performance.setResourceTimingBufferSize(30000);
  window.__nativeBench = { renders: [], firstPixels: null, thumbnails: null, longTasksMs: 0, poolPeaks:{},queuePeaks:{} };
  try { new PerformanceObserver(list => { for (const entry of list.getEntries()) window.__nativeBench.longTasksMs += entry.duration; }).observe({ type: 'longtask', buffered: true }); } catch {}
  function sample() {
    const b = window.__nativeBench;
    // Dismiss the same upstream tour/disclaimer in every fresh context.
    for (const element of document.querySelectorAll('button, a')) {
      if (['Skip all', 'Confirm and hide'].includes(element.textContent?.trim()) && element.getBoundingClientRect().width) element.click();
    }
    try {
      const s = window.services, v = s?.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());
      const pool=window.cornerstone?.imageLoadPoolManager;
      if(pool)for(const type of ['interaction','thumbnail','prefetch']){
        b.poolPeaks[type]=Math.max(b.poolPeaks[type]||0,pool.numRequests[type]);
        b.queuePeaks[type]=Math.max(b.queuePeaks[type]||0,Object.values(pool.requestPool[type]).reduce((n,queue)=>n+queue.length,0));
      }
      const image = v?.getCornerstoneImage?.(), rect = v?.element?.getBoundingClientRect();
      if (v?.viewportStatus === 'rendered' && image?.getPixelData()?.length && rect?.width > 100 && !document.querySelector('.shepherd-modal-is-visible')) {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
        const ctx = canvas.getContext('2d'); ctx.drawImage(v.canvas, 0, 0, 64, 64);
        const pixels = ctx.getImageData(0, 0, 64, 64).data;
        let low = 255, high = 0; for (let i = 0; i < pixels.length; i += 16) { low = Math.min(low, pixels[i]); high = Math.max(high, pixels[i]); }
        if (high - low > 20) {
          const id = v.getCurrentImageId();
          if (b.renders.at(-1)?.imageId !== id) b.renders.push({ atMs: performance.now(), imageId: id });
          b.firstPixels ||= { atMs: performance.now(), imageId: id, rows: image.rows, columns: image.columns, decodedPixels: image.getPixelData().length, voi: v.getProperties().voiRange };
        }
      }
      const images = [...document.querySelectorAll('[data-cy="study-browser-thumbnail"] img')];
      if (images.length >= window.__nativeExpectedThumbnails && images.every(image => image.complete && image.naturalWidth > 0)) b.thumbnails ||= { atMs: performance.now(), count: images.length };
    } catch {}
    requestAnimationFrame(sample);
  }
  requestAnimationFrame(sample);
}

export async function waitPixels(page, series, since = 0) {
  await page.waitForFunction(({ series, since }) => window.__nativeBench?.renders.some(r => r.atMs >= since && (!series || r.imageId.includes('/series/' + series + '/'))), { series, since }, { timeout: 90000 });
  return page.evaluate(({ series, since }) => window.__nativeBench.renders.find(r => r.atMs >= since && (!series || r.imageId.includes('/series/' + series + '/'))).atMs, { series, since });
}

async function fixture(c, seriesNo, slices, size, archiveRequest) {
  let firstId;
  for (let slice = 0; slice < slices; slice++) {
    const pixels = new Uint16Array(size * size); let seed = slice + seriesNo * 173;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const r = ((x - size / 2) / (size * .38)) ** 2 + ((y - size / 2) / (size * .31)) ** 2;
      pixels[y * size + x] = r < 1 ? 900 + Math.round(220 * Math.sin(x / 17) + 180 * Math.cos(y / 19)) + (seed >>> 25) + slice % 20 * 10 : 0;
    }
    const sop = c.study + '.' + seriesNo + '.' + (slice + 1), sopClass = c.modality === 'CT' ? '1.2.840.10008.5.1.4.1.1.2' : '1.2.840.10008.5.1.4.1.1.4';
    const ds = { _vrMap: { PixelData: 'OW' }, SOPClassUID: sopClass, SOPInstanceUID: sop, StudyInstanceUID: c.study, SeriesInstanceUID: c.study + '.' + seriesNo, FrameOfReferenceUID: c.study + '.99', PatientName: 'SYNTHETIC^BENCHMARK', PatientID: c.identifier, PatientBirthDate: '19860101', PatientSex: 'O', StudyDate: new Date().toISOString().slice(0, 10).replaceAll('-', ''), StudyTime: '120000', StudyDescription: 'SYNTHETIC ' + (c.label || c.modality), AccessionNumber: 'V2-' + String(c.appointmentId).padStart(6, '0'), Modality: c.modality, SeriesNumber: seriesNo, SeriesDescription: 'SYNTHETIC ' + c.modality + ' SERIES ' + seriesNo, InstanceNumber: slice + 1, ImageType: ['ORIGINAL', 'PRIMARY', 'AXIAL'], Rows: size, Columns: size, SamplesPerPixel: 1, PhotometricInterpretation: 'MONOCHROME2', BitsAllocated: 16, BitsStored: 16, HighBit: 15, PixelRepresentation: 0, ImageOrientationPatient: [1, 0, 0, 0, 1, 0], ImagePositionPatient: [0, 0, slice * 2], PixelSpacing: [1, 1], SliceThickness: 2, SpacingBetweenSlices: 2, WindowCenter: seriesNo === 2 ? 420 : 700, WindowWidth: seriesNo === 2 ? 900 : 1800, RescaleIntercept: 0, RescaleSlope: 1, PixelData: pixels.buffer };
    if (c.modality === 'MR') Object.assign(ds, { ScanningSequence: 'SE', SequenceVariant: 'NONE', MRAcquisitionType: '2D', RepetitionTime: 600, EchoTime: 15, EchoNumbers: 1, MagneticFieldStrength: 1.5 });
    const dict = new dcmjs.data.DicomDict(dcmjs.data.DicomMetaDictionary.denaturalizeDataset({ MediaStorageSOPClassUID: sopClass, MediaStorageSOPInstanceUID: sop, TransferSyntaxUID: '1.2.840.10008.1.2.1', ImplementationClassUID: '2.25.20261027009' }));
    dict.dict = dcmjs.data.DicomMetaDictionary.denaturalizeDataset(ds);
    const response = await archiveRequest('/instances', { method: 'POST', headers: { 'Content-Type': 'application/dicom' }, body: Buffer.from(dict.write()) });
    assert.equal(response.status, 200); const result = await response.json(); firstId ||= result.ID;
  }
  return firstId;
}

async function raw(url, headers) {
  const started = performance.now();
  return new Promise((resolve, reject) => request(url, { headers }, response => {
    const ttfbMs = performance.now() - started, chunks = [];
    response.on('data', chunk => chunks.push(chunk));
    response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks), ttfbMs, downloadMs: performance.now() - started - ttfbMs }));
    response.on('error', reject);
  }).on('error', reject).end());
}
function frameBytes(body, type) {
  const boundary = /boundary="?([^";]+)/.exec(type)?.[1]; assert.ok(boundary);
  return body.subarray(body.indexOf('\r\n\r\n') + 4, body.lastIndexOf('\r\n--' + boundary));
}

export function summarizeCompilation(events) {
  // Use V8's thread CPU clock; omit HTML/CSS parsing and network-wait wrappers.
  const selected=events.filter(e=>e.ph==='X'&&/^(V8\.(ParseProgram|ParseFunction|PreParse|Compile|CompileCode|CompileCodeBackground|CompileIgnition|CompileIgnitionFinalization|CompileScript|CompileEval)|v8\.parseOnBackgroundParsing)$/.test(e.name));
  const measured=selected.filter(e=>Number.isFinite(e.tts)&&Number.isFinite(e.tdur));
  const union=entries=>{
    const threads=new Map();for(const e of entries){const key=e.pid+':'+e.tid;if(!threads.has(key))threads.set(key,[]);threads.get(key).push([e.tts,e.tts+e.tdur]);}
    let duration=0;for(const intervals of threads.values()){intervals.sort((a,b)=>a[0]-b[0]);let start=0,end=0;for(const [a,b] of intervals){if(a>end){duration+=end-start;start=a;end=b;}else end=Math.max(end,b);}duration+=end-start;}
    return duration/1000;
  };
  assert.ok(measured.length,'V8 thread CPU parse/compile events captured');
  return {parseCpuMs:union(measured.filter(e=>/Parse|Parsing/.test(e.name))),parseCompileCpuMs:union(measured),measuredEvents:measured.length,eventsWithoutCpuClock:selected.length-measured.length};
}

export async function runNativeBenchmark(h) {
  const { browser, cases, origin, baselineOrigin, quickOrigin, backendOrigin, archive, archiveRequest, pool, env, temp, login, doctorId } = h;
  assert.equal(env.ohifNativeDeliveryEnabled, true);
  const results = [], security = [], compression = [], compilation = [];
  const emit = value => { console.log(JSON.stringify(value)); writeFileSync(join(temp, 'benchmark-results.json'), JSON.stringify({ conditions: 'Docker loopback; synthetic only; not hospital LAN', results, security, compression, compilation }, null, 2)); };
  const metadata = await (await archiveRequest('/plugins/ohif')).json(); emit({ officialOhifPlugin: metadata });
  const ct = cases[0];
  const booking = (await pool.query(`insert into appointments_v2.bookings(patient_id,modality_id,booking_date,case_category,status,requires_report,policy_version_id,completed_at) select patient_id,modality_id,current_date,'non_oncology','completed',true,policy_version_id,now() from appointments_v2.bookings where id=$1 returning id,modality_id`, [ct.appointmentId])).rows[0];
  const large = { ...ct, appointmentId: Number(booking.id), study: ct.study + '.20', label: 'CT-large' }; cases.push(large);
  await pool.query("insert into doctor_portal.case_team_assignments(appointment_id,assigned_doctor_id,modality_id,assignment_type,status,expected_reporting_date) values($1,$2,$3,'reporting','active',current_date)", [large.appointmentId, doctorId, booking.modality_id]);
  for (const c of cases) {
    if (c === large) { c.firstId = await fixture(c, 1, 512, 512, archiveRequest); await fixture(c, 2, 64, 512, archiveRequest); }
    for (let series = 5; series <= 14; series++) await fixture(c, series, c === large ? 8 : 16, c.modality === 'CT' ? 512 : 256, archiveRequest);
    c.expectedSeries=(await (await archiveRequest(`/dicom-web/studies/${c.study}/series`)).json()).length;
    emit({ syntheticFixture: { label: c.label || c.modality, study: c.study, largeCtSlices: c === large ? 656 : undefined, seriesAdded: 10 } });
  }
  async function exchange(c, context) {
    const launch = await h.launch(c); assert.equal(launch.status, 'ready');
    const response = await context.request.get(origin + launch.launchUrl, { maxRedirects: 0 });
    assert.equal(response.status(), 302);
    return response.headers().location;
  }
  // Real gateway authorization, login cookie and viewer sessions.
  const authorized = await browser.newContext(); await authorized.addCookies([{ name: env.cookieName, value: login, url: origin }]);
  const location = await exchange(ct, authorized), contextId = new URL(location, origin).searchParams.get('risproContext');
  const native = `${origin}/ohif-native/context/${contextId}/studies/${ct.study}`;
  const checks = [
    ['authenticated study metadata', await authorized.request.get(native + '/metadata'), 200],
    ['unrelated existing study', await authorized.request.get(native.replace(ct.study, cases[1].study) + '/metadata'), 403],
    ['write forbidden', await authorized.request.post(native + '/metadata'), 405],
    ['unrestricted search unavailable', await authorized.request.get(`${origin}/ohif-native/context/${contextId}/studies`), 403],
  ];
  const anonymous = await browser.newContext(); checks.push(['missing login', await anonymous.request.get(native + '/metadata'), 401]); await anonymous.close();
  for (const [check, response, expected] of checks) { assert.equal(response.status(), expected, check); security.push({ check, status: 'PASS', http: response.status() }); }
  const jwt=require('jsonwebtoken');
  const otherId=(await pool.query("insert into users(username,full_name,password_hash,role,is_active) values($1,'SYNTHETIC OTHER READER','disabled','doctor',true) returning id",['native-denied.'+randomUUID()])).rows[0].id;
  const other=await browser.newContext();
  try{
    await other.addCookies([{name:env.cookieName,value:jwt.sign({sub:Number(otherId),role:'doctor'},env.jwtSecret,{expiresIn:'1h'}),url:origin}]);
    assert.equal((await other.request.get(native+'/metadata')).status(),401);security.push({check:'wrong user cannot reuse another viewer context',status:'PASS'});
  }finally{await other.close();await pool.query('delete from users where id=$1',[otherId]);}
  const otherLocation=await exchange(cases[1],authorized),otherContext=new URL(otherLocation,origin).searchParams.get('risproContext');
  const otherNative=`${origin}/ohif-native/context/${otherContext}/studies/${cases[1].study}`;
  assert.equal((await authorized.request.get(otherNative+'/metadata')).status(),200);
  assert.equal((await authorized.request.get(otherNative.replace(cases[1].study,ct.study)+'/metadata')).status(),403);
  assert.equal((await authorized.request.get(native+'/metadata')).status(),200);security.push({check:'two viewer contexts keep distinct study allowlists',status:'PASS'});
  const expired=await browser.newContext();await expired.addCookies([{name:env.cookieName,value:jwt.sign({sub:h.userId,role:'doctor'},env.jwtSecret,{expiresIn:-1}),url:origin}]);
  assert.equal((await expired.request.get(native+'/metadata')).status(),401);await expired.close();security.push({check:'expired login',status:'PASS'});
  const session = (await pool.query('select id from viewer_launch_sessions where report_context_id=$1', [contextId])).rows[0];
  await pool.query("update viewer_launch_sessions set expires_at=now()-interval '1 second' where id=$1",[session.id]);await sleep(1100);
  assert.equal((await authorized.request.get(native+'/metadata')).status(),401);security.push({check:'expired viewer session',status:'PASS'});
  await pool.query("update viewer_launch_sessions set expires_at=now()+interval '1 hour' where id=$1",[session.id]);await sleep(1100);
  await pool.query('update viewer_launch_sessions set revoked_at=now() where id=$1', [session.id]); await sleep(1100);
  assert.equal((await authorized.request.get(native + '/metadata')).status(), 401); security.push({ check: 'revocation without gateway authorization cache', status: 'PASS' });
  assert.equal((await authorized.request.get(otherNative+'/metadata')).status(),200);security.push({check:'revoking one context leaves another permitted context isolated',status:'PASS'});
  await authorized.close(); emit({ security });
  if (process.env.OHIF_LOADING_PROFILE_BENCHMARK === '1') {
    const { runLoadingProfileBenchmark } = await import('./ohif-loading-profile-benchmark.mjs');
    return runLoadingProfileBenchmark({ ...h, exchange });
  }
  const variants = [
    { name: 'stock', origin: archive, stock: true }, { name: 'proxy', origin: baselineOrigin },
    { name: 'proxy-final', origin },
    { name: 'native-final', origin, native: true },
    { name: 'native-quick', origin: quickOrigin, native: true, limits: [4, 1, 1] },
    ...[1, 4, 8].map(thumbnail => ({ name: 'native-t' + thumbnail, origin, native: true, limits: [4, thumbnail, 1] })),
    ...[8, 12].map(interaction => ({ name: 'native-i' + interaction, origin, native: true, limits: [interaction, 4, 1] })),
    ...[2, 4].map(prefetch => ({ name: 'native-p' + prefetch, origin, native: true, limits: [4, 4, prefetch] })),
  ].filter(v => process.env.OHIF_BENCH_VARIANTS ? process.env.OHIF_BENCH_VARIANTS.split(',').includes(v.name) : v.name !== 'proxy-final');
  const repeats = Number(process.env.OHIF_BENCH_REPEATS || 3);
  for (let repeat = 0; repeat < repeats; repeat++) for (const c of cases) for (const variant of [...variants.slice(repeat % variants.length), ...variants.slice(0, repeat % variants.length)]) {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, ...(variant.stock ? { extraHTTPHeaders: { Authorization: 'Basic '+Buffer.from('synthetic:synthetic-only').toString('base64') } } : {}) });
    if (!variant.stock) await context.addCookies([{ name: env.cookieName, value: login, url: variant.origin }]);
    const launchLocation = variant.stock ? '/ohif/viewer?StudyInstanceUIDs=' + c.study : await exchange(c, context);
    const url = new URL(launchLocation, variant.origin); if (!variant.stock) url.searchParams.set('risproDelivery', variant.native ? 'native' : 'proxy');
    if (variant.limits) await context.route('**/ohif/app-config.js', async route => {
      const response = await route.fetch(), source = await response.text();
      const [interaction, thumbnail, prefetch] = variant.limits;
      await route.fulfill({ response, body: source + `\nwindow.config.maxNumRequests=${JSON.stringify({ interaction, thumbnail, prefetch })};` });
    });
    await context.addInitScript(count=>{window.__nativeExpectedThumbnails=count;},c.expectedSeries);
    await context.addInitScript(installProbe);
    const page = await context.newPage(), requests = [], pending = new Set(), errors = [], failures = [],network=new Map();
    let phase='cold';
    let peak = 0; const seenFrames=new Set();
    const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');await cdp.send('Network.enable');
    // Final stock/proxy/native-final comparisons use no routes and retain HTTP caching.
    await cdp.send('Network.setCacheDisabled',{cacheDisabled:false});
    cdp.on('Network.requestWillBeSent',event=>network.set(event.requestId,{url:event.request.url,phase,start:event.timestamp,bodyBytes:0}));
    cdp.on('Network.responseReceived',event=>{const item=network.get(event.requestId);if(item){item.response=event.response;item.responseAt=event.timestamp;}});
    cdp.on('Network.dataReceived',event=>{const item=network.get(event.requestId);if(item){item.bodyBytes+=event.encodedDataLength;item.lastDataAt=event.timestamp;}});
    const finish=(event,canceled=false)=>{
      const item=network.get(event.requestId);if(!item?.response||!/^http/.test(item.url))return;
      const {response}=item,t=response.timing;network.delete(event.requestId);
      requests.push({phase:item.phase,path:new URL(item.url).pathname,type:item.url.includes('/metadata')?'metadata':item.url.includes('/frames/')?'frame':item.url.includes('/rendered')?'thumbnail':item.url.includes('/studies')?'qido':'asset',ttfbMs:t?t.receiveHeadersEnd-t.sendStart:0,downloadMs:1000*Math.max(0,(item.lastDataAt||event.timestamp)-item.responseAt),browserQueueMs:t?Math.max(0,t.sendStart-Math.max(t.proxyEnd,t.dnsEnd,t.connectEnd,t.sslEnd,0)):0,bytes:item.bodyBytes,transferredBytes:event.encodedDataLength??item.bodyBytes+(response.encodedDataLength||0),canceled});
    };
    cdp.on('Network.loadingFinished',event=>finish(event));
    cdp.on('Network.loadingFailed',event=>{if(event.canceled)finish(event,true);});
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', r => { if (/\/frames\/|\/rendered/.test(r.url())) { pending.add(r); peak = Math.max(peak, pending.size); } if(r.url().includes('/frames/'))seenFrames.add(new URL(r.url()).pathname); });
    page.on('requestfailed', r => { pending.delete(r); if (!/abort|cancel/i.test(r.failure()?.errorText || '')) failures.push({ path: new URL(r.url()).pathname, error: r.failure()?.errorText }); });
    page.on('response', r => { if (r.status() >= 400) failures.push({ path: new URL(r.url()).pathname, status: r.status() }); });
    page.on('requestfinished', r => pending.delete(r));
    try {
      emit({ benchmarkStart: { repeat, case: c.label || c.modality, variant: variant.name } });
      const archiveCpuStart=h.archiveCpuMs();
      await fetch(backendOrigin + '/__benchmark/metrics?reset=1');
      await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await waitPixels(page);
      const first = await page.evaluate(() => window.__nativeBench.firstPixels);
      assert.equal(first.decodedPixels, first.rows * first.columns, 'Complete original-resolution decoded pixels');
      assert.ok(first.imageId.includes('/studies/'+c.study+'/'),'Primary study must be displayed');
      const scriptMetrics=(await cdp.send('Performance.getMetrics')).metrics;
      const scriptCpuMs=1000*scriptMetrics.find(m=>m.name==='ScriptDuration').value;
      const initialSeries = /\/series\/([^/]+)/.exec(first.imageId)[1];
      const switchAt = await page.evaluate(() => performance.now());
      const unloaded = { selectedFirstFrameRequested: [...seenFrames].some(path=>path.includes(`/series/${c.study}.2/instances/${c.study}.2.1/frames/1`)), seriesFrameRequests:[...seenFrames].filter(path=>path.includes(`/series/${c.study}.2/`)).length };
      await page.locator('[data-cy="study-browser-thumbnail"][data-series="2"]').first().dblclick();
      const selectedPixelsMs = await waitPixels(page, c.study + '.2', switchAt) - switchAt;
      await page.waitForFunction(() => window.__nativeBench.thumbnails, null, { timeout: 60000 });
      const revisitAt = await page.evaluate(() => performance.now());
      await page.locator(`[data-cy="study-browser-thumbnail"][data-series="${initialSeries.split('.').at(-1)}"]`).first().dblclick();
      const revisitMs = await waitPixels(page, initialSeries, revisitAt) - revisitAt;
      const thumbnail = await page.evaluate(() => window.__nativeBench.thumbnails);
      const resource = await page.evaluate(() => ({ domContentLoadedMs: performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd, firstRenderPixels: window.__nativeBench.firstPixels, longTasksMs: window.__nativeBench.longTasksMs, limits: window.config.maxNumRequests,effectivePoolLimits:window.cornerstone.imageLoadPoolManager.maxNumRequests,poolPeaks:window.__nativeBench.poolPeaks,queuePeaks:window.__nativeBench.queuePeaks }));
      if(variant.limits){for(const [index,type] of ['interaction','thumbnail','prefetch'].entries())assert.equal(resource.effectivePoolLimits[type],variant.limits[index]);assert.ok(resource.poolPeaks.thumbnail<=variant.limits[1],'Native thumbnail pool must respect its measured limit');}
      const backend = await (await fetch(backendOrigin + '/__benchmark/metrics')).json();
      backend.orthancCpuMs=h.archiveCpuMs()-archiveCpuStart;
      await page.screenshot({ path: join(temp, `${variant.name}-${c.label || c.modality}-${repeat}-pixels.png`) });
      phase='reopen';await page.reload({ waitUntil: 'domcontentloaded' }); await waitPixels(page);
      const reopenMs = await page.evaluate(() => window.__nativeBench.firstPixels.atMs);
      assert.deepEqual(errors, [], 'Browser runtime errors'); assert.deepEqual(failures, [], 'Unexpected HTTP or transport failures');
      if (variant.native) assert.equal(backend.proxyFrames, 0, 'Native frames must bypass Express');
      if (variant.name==='proxy-final') assert.ok(backend.proxyFrames>0,'Final minified rollback must stream through the existing proxy');
      const cold=requests.filter(r=>r.phase==='cold'),warm=requests.filter(r=>r.phase==='reopen');
      const result = { repeat, case: c.label || c.modality, variant: variant.name, firstPixelsMs: first.atMs, scriptCpuMs, allThumbnailsMs: thumbnail.atMs, thumbnails: thumbnail.count, selectedPixelsMs, revisitMs, reopenMs, unloadedAtSwitch: unloaded, peakImageRequests: peak, networkRequestCount: cold.length, transferredBytes: cold.reduce((n, r) => n + r.transferredBytes, 0), reopenRequestCount:warm.length,reopenTransferredBytes:warm.reduce((n,r)=>n+r.transferredBytes,0),metadataRequests: cold.filter(r => r.type === 'metadata'), frames: cold.filter(r => r.type === 'frame'), assets: cold.filter(r => r.type === 'asset'), backend, ...resource };
      results.push(result); emit({ benchmarkResult: { ...result, frames: result.frames.length, assets: result.assets.length,metadataRequests:result.metadataRequests.length } });
    } catch (error) {
      await page.screenshot({ path: join(temp, 'benchmark-failure.png') }).catch(() => {});
      writeFileSync(join(temp, 'benchmark-failure.json'), JSON.stringify({ variant, c, errors, failures, body: await page.locator('body').innerText().catch(() => ''), probe: await page.evaluate(() => window.__nativeBench).catch(() => null) }, null, 2));
      throw error;
    } finally { await context.close(); }
  }
  // Separate traced launches: tracing never adds overhead to the timing matrix.
  if(process.env.OHIF_BENCH_TRACE==='1')for(const variant of [
    {name:'stock',origin:archive,stock:true},{name:'proxy',origin:baselineOrigin},
    {name:'native-quick',origin:quickOrigin,native:true},{name:'native-final',origin,native:true},
  ]){
    const context=await browser.newContext({viewport:{width:1600,height:1000},...(variant.stock?{extraHTTPHeaders:{Authorization:'Basic '+Buffer.from('synthetic:synthetic-only').toString('base64')}}:{})});
    try{
      if(!variant.stock)await context.addCookies([{name:env.cookieName,value:login,url:variant.origin}]);
      const location=variant.stock?'/ohif/viewer?StudyInstanceUIDs='+ct.study:await exchange(ct,context);
      const url=new URL(location,variant.origin);if(!variant.stock)url.searchParams.set('risproDelivery',variant.native?'native':'proxy');
      await context.addInitScript(installProbe);
      const page=await context.newPage(),cdp=await context.newCDPSession(page),events=[];
      cdp.on('Tracing.dataCollected',data=>events.push(...data.value));
      const done=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));
      await cdp.send('Tracing.start',{categories:'v8,devtools.timeline,disabled-by-default-v8.compile',transferMode:'ReportEvents'});
      await page.goto(url.href,{waitUntil:'domcontentloaded'});await waitPixels(page);
      await cdp.send('Tracing.end');await done;
      const sample={variant:variant.name,...summarizeCompilation(events)};
      compilation.push(sample);
      writeFileSync(join(temp,'compile-'+variant.name+'.json'),JSON.stringify(events));emit({compilation:sample});
    }finally{await context.close();}
  }
  if(process.env.OHIF_BENCH_CODECS!=='0'){
    const quality=await browser.newContext({viewport:{width:1600,height:1000}});
    await quality.addCookies([{name:env.cookieName,value:login,url:origin}]);
    await quality.addInitScript(count=>{window.__nativeExpectedThumbnails=count;},large.expectedSeries);
    await quality.addInitScript(installProbe);
    const qualityLocation=await exchange(large,quality),qualityContext=new URL(qualityLocation,origin).searchParams.get('risproContext');
    const page=await quality.newPage();await page.goto(origin+qualityLocation,{waitUntil:'domcontentloaded'});await waitPixels(page);
    const source=Buffer.from(await(await archiveRequest('/instances/'+large.firstId+'/file')).arrayBuffer()),sourceHash=hash(source);
    const original=dcmjs.data.DicomMessage.readFile(source.buffer.slice(source.byteOffset,source.byteOffset+source.length));
    const reference=Buffer.from(original.dict['7FE00010'].Value[0]);
    const uploaded=[];
    for(const [seriesNo,syntax] of [[90,'1.2.840.10008.1.2.5'],[91,'1.2.840.10008.1.2.4.70'],[92,'1.2.840.10008.1.2.4.80'],[93,'1.2.840.10008.1.2.4.90'],[94,'1.2.840.10008.1.2.1']]){
      const response=await archiveRequest('/instances/'+large.firstId+'/file?transcode='+syntax);
      assert.equal(response.status,200,'Supported lossless transcode '+syntax);
      const file=Buffer.from(await response.arrayBuffer()),parsed=dcmjs.data.DicomMessage.readFile(file.buffer.slice(file.byteOffset,file.byteOffset+file.length));
      const series=large.study+'.'+seriesNo,sop=series+'.1';
      parsed.meta['00020003'].Value=[sop];parsed.dict['00080018'].Value=[sop];parsed.dict['0020000E'].Value=[series];parsed.dict['00200011'].Value=[seriesNo];
      parsed.dict['0008103E'].Value=['SYNTHETIC LOSSLESS '+syntax];
      if(seriesNo===94){parsed.meta['00020002'].Value=['1.2.840.10008.5.1.4.1.1.7'];parsed.dict['00080016'].Value=['1.2.840.10008.5.1.4.1.1.7'];parsed.dict['00080060'].Value=['OT'];parsed.dict['0008103E'].Value=['SYNTHETIC SECONDARY IMAGE'];parsed.dict['00080008'].Value=['DERIVED','SECONDARY'];}
      const dict=new dcmjs.data.DicomDict(parsed.meta);dict.dict=parsed.dict;
      assert.equal((await archiveRequest('/instances',{method:'POST',headers:{'Content-Type':'application/dicom'},body:Buffer.from(dict.write())})).status,200);
      uploaded.push({seriesNo,series,sop,syntax,storedPixels:Buffer.from(parsed.dict['7FE00010'].Value[0])});
    }
    // Reopen after ingestion: metadata must expose the newly added compressed
    // series and the new secondary image, without a persistent viewer cache.
    await page.reload({waitUntil:'domcontentloaded'});await waitPixels(page);
    const cookie=env.cookieName+'='+login;
    for(const item of uploaded){
      await page.waitForFunction(series=>window.services.displaySetService.getActiveDisplaySets().some(ds=>ds.SeriesInstanceUID===series),item.series,{timeout:60000});
      const at=await page.evaluate(()=>performance.now());
      await page.evaluate(series=>{const s=window.services,ds=s.displaySetService.getActiveDisplaySets().find(ds=>ds.SeriesInstanceUID===series);window.commandsManager.runCommand('setDisplaySetsForViewports',{viewportsToUpdate:[{viewportId:s.viewportGridService.getActiveViewportId(),displaySetInstanceUIDs:[ds.displaySetInstanceUID],viewportOptions:{viewportType:'stack'}}]});},item.series);
      await waitPixels(page,item.series,at);
      const decoded=await page.evaluate(base64=>{
        const s=window.services,v=s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId()),image=v.getCornerstoneImage(),data=image.getPixelData(),expected=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
        let exact=data.length===expected.length/2;for(let i=0;exact&&i<data.length;i++)exact=data[i]===(expected[i*2]|expected[i*2+1]<<8);
        return {exact,pixels:data.length,rows:image.rows,columns:image.columns};
      },reference.toString('base64'));
      assert.equal(decoded.exact,true,'Lossless browser pixels '+item.syntax);
      const path=`/ohif-native/context/${qualityContext}/studies/${large.study}/series/${item.series}/instances/${item.sop}/frames/1`;
      const samples=[];
      for(let pair=0;pair<10;pair++)for(const encoding of pair%2?['gzip','identity']:['identity','gzip']){
        const response=await raw(origin+path,{Cookie:cookie,Accept:'multipart/related; type="application/octet-stream"; transfer-syntax=*','Accept-Encoding':encoding});
        assert.equal(response.status,200);
        const body=response.headers['content-encoding']==='gzip'?gunzipSync(response.body):response.body;
        assert.deepEqual(frameBytes(body,response.headers['content-type']),item.storedPixels,'Stored compressed frame bytes must remain unchanged');
        samples.push({encoding,contentEncoding:response.headers['content-encoding']||'identity',bytes:response.body.length,ttfbMs:response.ttfbMs,downloadMs:response.downloadMs});
      }
      compression.push({syntax:item.syntax,secondary:item.seriesNo===94,decoded,storedPixelsUnchanged:true,samples});
      await page.screenshot({path:join(temp,'native-lossless-'+item.seriesNo+'.png')});
    }
    assert.equal(hash(Buffer.from(await(await archiveRequest('/instances/'+large.firstId+'/file')).arrayBuffer())),sourceHash,'Original stored DICOM must remain unchanged');
    security.push({check:'new series and secondary image visible after reopening; RLE/JPEG lossless/JPEG-LS/JPEG2000 exact original-resolution pixels',status:'PASS'});
    await quality.close();emit({losslessAndCompression:{syntaxes:compression.map(c=>c.syntax),originalDicomUnchanged:true}});
    // Also exercise a compressed MR SOP class and its stored VOI, not just CT.
    const mr=cases.find(c=>c.modality==='MR'),syntax='1.2.840.10008.1.2.4.90';
    const ids=await(await archiveRequest('/tools/find',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({Level:'Instance',Query:{SOPInstanceUID:mr.study+'.1.1'}})})).json();
    assert.equal(ids.length,1);
    const originalMr=Buffer.from(await(await archiveRequest('/instances/'+ids[0]+'/file')).arrayBuffer());
    const mrHash=hash(originalMr),mrReference=Buffer.from(dcmjs.data.DicomMessage.readFile(originalMr.buffer.slice(originalMr.byteOffset,originalMr.byteOffset+originalMr.length)).dict['7FE00010'].Value[0]);
    const encoded=Buffer.from(await(await archiveRequest('/instances/'+ids[0]+'/file?transcode='+syntax)).arrayBuffer());
    const parsed=dcmjs.data.DicomMessage.readFile(encoded.buffer.slice(encoded.byteOffset,encoded.byteOffset+encoded.length));
    const series=mr.study+'.95',sop=series+'.1';
    parsed.meta['00020003'].Value=[sop];parsed.dict['00080018'].Value=[sop];parsed.dict['0020000E'].Value=[series];parsed.dict['00200011'].Value=[95];
    const mrDict=new dcmjs.data.DicomDict(parsed.meta);mrDict.dict=parsed.dict;
    assert.equal((await archiveRequest('/instances',{method:'POST',headers:{'Content-Type':'application/dicom'},body:Buffer.from(mrDict.write())})).status,200);
    const mrContext=await browser.newContext({viewport:{width:1600,height:1000}});
    await mrContext.addCookies([{name:env.cookieName,value:login,url:origin}]);await mrContext.addInitScript(installProbe);
    const mrLocation=await exchange(mr,mrContext),mrPage=await mrContext.newPage();
    await mrPage.goto(origin+mrLocation,{waitUntil:'domcontentloaded'});await waitPixels(mrPage);
    await mrPage.waitForFunction(series=>window.services.displaySetService.getActiveDisplaySets().some(ds=>ds.SeriesInstanceUID===series),series);
    const at=await mrPage.evaluate(()=>performance.now());
    await mrPage.evaluate(series=>{const s=window.services,ds=s.displaySetService.getActiveDisplaySets().find(ds=>ds.SeriesInstanceUID===series);window.commandsManager.runCommand('setDisplaySetsForViewports',{viewportsToUpdate:[{viewportId:s.viewportGridService.getActiveViewportId(),displaySetInstanceUIDs:[ds.displaySetInstanceUID],viewportOptions:{viewportType:'stack'}}]});},series);
    await waitPixels(mrPage,series,at);
    const mrDecoded=await mrPage.evaluate(base64=>{const s=window.services,v=s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId()),image=v.getCornerstoneImage(),pixels=image.getPixelData(),expected=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));return {exact:pixels.length===expected.length/2&&pixels.every((p,i)=>p===(expected[i*2]|expected[i*2+1]<<8)),rows:image.rows,columns:image.columns,voi:v.getProperties().voiRange};},mrReference.toString('base64'));
    assert.equal(mrDecoded.exact,true);assert.deepEqual(mrDecoded.voi,{lower:-200,upper:1599});
    const mrViewerContext=new URL(mrLocation,origin).searchParams.get('risproContext');
    const mrFrame=await raw(`${origin}/ohif-native/context/${mrViewerContext}/studies/${mr.study}/series/${series}/instances/${sop}/frames/1`,{Cookie:env.cookieName+'='+login,Accept:'multipart/related; type="application/octet-stream"; transfer-syntax=*'});
    assert.equal(mrFrame.status,200);assert.deepEqual(frameBytes(mrFrame.body,mrFrame.headers['content-type']),Buffer.from(parsed.dict['7FE00010'].Value[0]));
    assert.equal(hash(Buffer.from(await(await archiveRequest('/instances/'+ids[0]+'/file')).arrayBuffer())),mrHash);
    await mrPage.screenshot({path:join(temp,'native-mr-jpeg2000.png')});await mrContext.close();
    security.push({check:'JPEG2000 lossless MR: exact original pixels, stored VOI and compressed frame bytes; original file unchanged',status:'PASS',...mrDecoded});emit({compressedMr:mrDecoded});
  }
  emit({ benchmarkComplete: true, runs: results.length });
}
