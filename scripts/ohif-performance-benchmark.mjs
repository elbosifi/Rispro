import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
// Synthetic-only benchmark. Never accepts an external archive or patient-data path.
// Run serially with other DB tests; it temporarily replaces disposable-DB source settings.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));
const { chromium, webkit } = require('@playwright/test');
const sharp = require('sharp');
const dcmjs = require('dcmjs');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const db = new URL(process.env.DATABASE_URL || 'http://invalid');
if (!['localhost', '127.0.0.1'].includes(db.hostname) || db.port !== '5433' || db.pathname !== '/rispro_test' || db.username !== 'rispro_test')
    throw Error('Disposable DB only');
process.env.RISPRO_E2E = '1'; // Prevent .env from overriding the guarded test environment.
process.env.JWT_SECRET = 'synthetic-ohif-phase2-secret-not-for-production';
process.env.OHIF_ENABLED = 'true';
process.env.COOKIE_SECURE = 'false';
const temp = mkdtempSync(join(tmpdir(), 'rispro-ohif-phase2-'));
console.log(JSON.stringify({
    artifacts: temp
}));
const containerPrefix = 'rispro-ohif-phase2-' + process.pid;
const docker = (...args) => execFileSync('docker', args, {
    encoding: 'utf8'
}).trim();
const containers = [];
const startContainer = (name, image, extra = []) => {
    docker('run', '--rm', '-d', '--name', name, '-p', '127.0.0.1::80', ...extra, image);
    containers.push(name);
    return Number(docker('port', name, '80/tcp').split(':').at(-1));
};
const { pool } = await import(pathToFileURL(join(root, 'src/db/pool.ts')));
const { env } = await import(pathToFileURL(join(root, 'src/config/env.ts')));
if (env.databaseUrl !== process.env.DATABASE_URL || new URL(env.databaseUrl).href !== db.href || (process.env.PGHOST && !['localhost', '127.0.0.1'].includes(process.env.PGHOST)))
    throw Error('Runtime DB guard failed');
const { ohifDicomWebProxyRouter, ohifViewerRouter } = await import(pathToFileURL(join(root, 'src/modules/ohif-viewer/routes.ts')));
let userId, patientId, bookingId, policySetId, appServer;
let settingsChanged = false;
const priorSettings = (await pool.query("select * from system_settings where category='authoritative_orthanc'")).rows;
const priorOhif = (await pool.query('select * from ohif_viewer_settings where singleton_key=true')).rows[0];
const auth = 'Basic ' + Buffer.from('synthetic:synthetic-only').toString('base64');
const studies = [];
const get = async (url, options = {}) => {
    const t0 = performance.now();
    const r = await fetch(url, {
        ...options, headers: {
            Authorization: auth, ...options.headers
        }
    });
    const ttfb = performance.now() - t0;
    const body = Buffer.from(await r.arrayBuffer());
    return {
        r, body, ttfb, total: performance.now() - t0
    };
};
const rawGet = (url, headers = {}) => new Promise((resolve, reject) => {
    const started = performance.now();
    httpRequest(url, {
        headers
    }, res => {
        const ttfb = performance.now() - started;
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({
            status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), ttfbMs: Math.round(ttfb), totalMs: Math.round(performance.now() - started)
        }));
        res.on('error', reject);
    }).on('error', reject).end();
});
async function verifyVisiblePixels(page, stage) {
    const deadline = performance.now() + 30000;
    let screenshot, stats;
    do {
        screenshot = await page.screenshot();
        stats = await sharp(screenshot).extract({
            left: 650, top: 350, width: 200, height: 200
        }).stats();
        if (stats.channels[0].stdev > 10 && stats.channels[0].mean > 10)
            return {
                screenshot, stats, verifiedAtMs: Math.round(await page.evaluate(() => performance.now()))
            };
        await page.waitForTimeout(100);
    } while (performance.now() < deadline);
    writeFileSync(join(temp, stage + '-blank.png'), screenshot);
    console.log(JSON.stringify({
        failureStage: stage, roiMean: Math.round(stats.channels[0].mean), roiStd: Math.round(stats.channels[0].stdev),
        ...await page.evaluate(() => ({
            renderEvents: window.__phase2.rendered.length,
            completedFrames: performance.getEntriesByType('resource').filter(e => e.name.includes('/frames/')).map(e => ({
                encodedBytes: e.encodedBodySize, decodedBytes: e.decodedBodySize, durationMs: Math.round(e.duration)
            }))
        }))
    }));
    throw Error('Synthetic diagnostic viewport remained blank');
}
try {
    docker('image', 'inspect', 'orthancteam/orthanc:26.4.0', 'rispro-ohif:v3.12.6', 'nginx:1.27.5-alpine');
    writeFileSync(join(temp, 'orthanc.json'), JSON.stringify({
        Name: 'SYNTHETIC OHIF BENCHMARK', RemoteAccessAllowed: true, AuthenticationEnabled: true, RegisteredUsers: {
            synthetic: 'synthetic-only'
        }, DicomServerEnabled: false, Plugins: ['/usr/share/orthanc/plugins'], DicomWeb: {
            Enable: true, EnableMetadataCache: true, StudiesMetadata: 'Full', SeriesMetadata: 'Full'
        }
    }));
    docker('run', '--rm', '-d', '--name', containerPrefix + '-orthanc', '-p', '127.0.0.1::8042', '-e', 'DICOM_WEB_PLUGIN_ENABLED=true', '-v', join(temp, 'orthanc.json') + ':/etc/orthanc/orthanc.json:ro', 'orthancteam/orthanc:26.4.0');
    containers.push(containerPrefix + '-orthanc');
    const orthanc = 'http://127.0.0.1:' + docker('port', containerPrefix + '-orthanc', '8042/tcp').split(':').at(-1);
    for (let n = 0; n < 60; n++) {
        try {
            if ((await get(orthanc + '/system')).r.ok)
                break;
        }
        catch {
        }
        await new Promise(r => setTimeout(r, 500));
    }
    const system = await get(orthanc + '/system');
    if (!system.r.ok)
        throw Error('Synthetic Orthanc did not start');
    const plugins = await get(orthanc + '/plugins/dicom-web');
    console.log(JSON.stringify({
        orthancVersion: JSON.parse(system.body).Version, dicomwebPlugin: JSON.parse(plugins.body).Version
    }));
    for (const [idx, modality, size] of [[1, 'CT', 512], [2, 'MR', 256]]) {
        const study = '2.25.10020261010' + idx;
        const frameOfReference = study + '.9';
        const studyData = {
            study, modality, size, series: []
        };
        studies.push(studyData);
        for (let seriesIndex = 1; seriesIndex <= 2; seriesIndex++) {
            const series = study + '.' + seriesIndex;
            const ser = {
                series, sops: [], originals: [], ids: []
            };
            studyData.series.push(ser);
            for (let slice = 0; slice < 12; slice++) {
                const sop = series + '.' + (slice + 1);
                ser.sops.push(sop);
                const pixels = new Uint16Array(size * size);
                let seed = 731 + slice;
                for (let y = 0; y < size; y++)
                    for (let x = 0; x < size; x++) {
                        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
                        const nx = (x - size / 2) / (size * .39), ny = (y - size / 2) / (size * .31);
                        const r = nx * nx + ny * ny;
                        let value = r < 1 ? 900 + seriesIndex * 200 + 100 * Math.sin(x * .04) + 70 * Math.cos(y * .03) + (seed >>> 24) * 2 : 0;
                        if (r < .3)
                            value += 700;
                        if (x > size * .55 && x < size * .7 && y > size * .38 && y < size * .55)
                            value += 500;
                        if (x > size * .28 && x < size * .4 && y > size * .4 && y < size * .6)
                            value += slice * 35;
                        pixels[y * size + x] = Math.round(value);
                    }
                ser.originals.push(Buffer.from(pixels.buffer));
                const sopClass = modality === 'CT' ? '1.2.840.10008.5.1.4.1.1.2' : '1.2.840.10008.5.1.4.1.1.4';
                const ds = {
                    _vrMap: {
                        PixelData: 'OW'
                    }, SOPClassUID: sopClass, SOPInstanceUID: sop, StudyInstanceUID: study, SeriesInstanceUID: series, FrameOfReferenceUID: frameOfReference, PatientName: 'SYNTHETIC^PERFORMANCE', PatientID: 'SYNTHETIC-PHASE2-' + modality, PatientBirthDate: '19800101', PatientSex: 'O', StudyDate: '20261010', StudyTime: '120000', StudyID: String(idx), StudyDescription: 'Synthetic conventional ' + modality, AccessionNumber: 'SYNTHETIC-' + modality, Modality: modality, SeriesNumber: seriesIndex, SeriesDescription: 'Synthetic ' + modality + ' series ' + seriesIndex, InstanceNumber: slice + 1, ImageType: ['ORIGINAL', 'PRIMARY', 'AXIAL'], Rows: size, Columns: size, SamplesPerPixel: 1, PhotometricInterpretation: 'MONOCHROME2', BitsAllocated: 16, BitsStored: 16, HighBit: 15, PixelRepresentation: 0, ImageOrientationPatient: [1, 0, 0, 0, 1, 0], ImagePositionPatient: [0, 0, slice * 2], PixelSpacing: [1, 1], SliceThickness: 2, SpacingBetweenSlices: 2, WindowCenter: modality === 'CT' ? 700 : 1500, WindowWidth: modality === 'CT' ? 2000 : 3000, RescaleIntercept: modality === 'CT' ? -1024 : 0, RescaleSlope: 1, PixelData: pixels.buffer
                };
                if (modality === 'MR')
                    Object.assign(ds, {
                        ScanningSequence: 'SE', SequenceVariant: 'NONE', ScanOptions: '', MRAcquisitionType: '2D', RepetitionTime: 600, EchoTime: 15, EchoNumbers: 1, MagneticFieldStrength: 1.5
                    });
                const dict = new dcmjs.data.DicomDict(dcmjs.data.DicomMetaDictionary.denaturalizeDataset({
                    MediaStorageSOPClassUID: sopClass, MediaStorageSOPInstanceUID: sop, TransferSyntaxUID: '1.2.840.10008.1.2.1', ImplementationClassUID: '2.25.1002026101099'
                }));
                dict.dict = dcmjs.data.DicomMetaDictionary.denaturalizeDataset(ds);
                const file = Buffer.from(dict.write());
                const result = await get(orthanc + '/instances', {
                    method: 'POST', body: file, headers: {
                        'Content-Type': 'application/dicom'
                    }
                });
                if (!result.r.ok)
                    throw Error('Synthetic DICOM upload failed: ' + result.r.status);
                ser.ids.push(JSON.parse(result.body).ID);
            }
        }
    }
    const suffix = randomBytes(5).toString('hex');
    userId = (await pool.query("insert into users(username,full_name,password_hash,role) values($1,'SYNTHETIC PERFORMANCE','disabled','doctor') returning id", ['ohif_phase2_' + suffix])).rows[0].id;
    policySetId = (await pool.query("insert into appointments_v2.policy_sets(key,name) values($1,'Synthetic OHIF benchmark') returning id", ['ohif_phase2_' + suffix])).rows[0].id;
    const policyVersionId = (await pool.query("insert into appointments_v2.policy_versions(policy_set_id,version_no,status,config_hash) values($1,1,'draft','synthetic') returning id", [policySetId])).rows[0].id;
    patientId = (await pool.query("insert into patients(arabic_full_name,normalized_arabic_name,age_years,sex) values('SYNTHETIC PERFORMANCE','synthetic performance',40,'male') returning id")).rows[0].id;
    bookingId = (await pool.query("insert into appointments_v2.bookings(patient_id,modality_id,booking_date,case_category,status,policy_version_id) select $1,(select id from modalities limit 1),'2026-10-10','non_oncology','scheduled',$2 returning id", [patientId, policyVersionId])).rows[0].id;
    settingsChanged = true;
    for (const [key, value] of Object.entries({
        enabled: 'enabled', base_url: orthanc, username: 'synthetic', password: 'synthetic-only', verify_tls: 'true', timeout_seconds: '30'
    }))
        await pool.query("insert into system_settings(category,setting_key,setting_value) values('authoritative_orthanc',$1,$2::jsonb) on conflict(category,setting_key) do update set setting_value=excluded.setting_value", [key, JSON.stringify({
                value
            })]);
    await pool.query("update ohif_viewer_settings set enabled=true,access_strategy='authoritative_orthanc',selected_pacs_node_id=null where singleton_key=true");
    const token = randomBytes(32).toString('base64url');
    await pool.query("insert into viewer_launch_sessions(user_id,case_id,appointment_id,access_strategy,study_instance_uid,permitted_study_uids,token_hash,expires_at,used_at,viewer_session_token_hash) values($1,$2,$2,'authoritative_orthanc',$3,$4::jsonb,$5,now()+interval '1 hour',now(),$5)", [userId, bookingId, studies[0].study, JSON.stringify(studies.map(s => s.study)), createHash('sha256').update(token).digest('hex')]);
    const login = jwt.sign({
        sub: Number(userId), role: 'doctor'
    }, env.jwtSecret, {
        expiresIn: '1h'
    });
    const app = express();
    app.use(cookieParser());
    app.use('/ohif-dicomweb', ohifDicomWebProxyRouter);
    app.use('/api/ohif', ohifViewerRouter);
    app.use((error, req, res, next) => res.status(error.statusCode || 500).json({
        error: {
            message: error.statusCode ? error.message : 'Synthetic benchmark failure'
        }
    }));
    appServer = createServer(app);
    await new Promise(r => appServer.listen(0, '127.0.0.1', r));
    const appPort = appServer.address().port;
    writeFileSync(join(temp, 'app-config.js'), readFileSync(join(root, 'docker/ohif/app-config.js')));
    const viewerMounts = ['-v', join(temp, 'app-config.js') + ':/usr/share/nginx/html/ohif/app-config.js:ro'];
    const originConfig = readFileSync(join(root, 'docker/ohif/nginx.conf'), 'utf8');
    writeFileSync(join(temp, 'origin.conf'), process.env.OHIF_PHASE2_VARIANT === 'baseline' ? originConfig.replace('gzip on;', 'gzip off;') : originConfig);
    viewerMounts.push('-v', join(temp, 'origin.conf') + ':/etc/nginx/conf.d/default.conf:ro');
    const viewerPort = startContainer(containerPrefix + '-viewer', 'rispro-ohif:v3.12.6', viewerMounts);
    let nginx = readFileSync(join(root, 'docker/reverse-proxy/nginx.conf'), 'utf8').replace('server app:3000 resolve;', `server host.docker.internal:${appPort};`).replace('http {', `http {\n upstream phase2_viewer {server host.docker.internal:${viewerPort};}`).replace('http://ohif:80', 'http://phase2_viewer').replace('listen 8080;', 'listen 80;');
    writeFileSync(join(temp, 'edge.conf'), nginx);
    const edgePort = startContainer(containerPrefix + '-edge', 'nginx:1.27.5-alpine', ['-v', join(temp, 'edge.conf') + ':/etc/nginx/nginx.conf:ro']);
    const origin = 'http://127.0.0.1:' + edgePort;
    const cookie = env.cookieName + '=' + login + '; ' + env.ohifSessionCookieName + '=' + token;
    let producerClosed = false, producerBytes = 0;
    const slow = createServer((req, res) => {
        res.writeHead(200, {
            'Content-Type': 'application/octet-stream'
        });
        const chunk = randomBytes(16384);
        let count = 0;
        const timer = setInterval(() => {
            producerBytes += chunk.length;
            res.write(chunk);
            if (++count === 512) {
                clearInterval(timer);
                res.end();
            }
        }, 5);
        res.once('close', () => {
            producerClosed = true;
            clearInterval(timer);
        });
    });
    await new Promise(r => slow.listen(0, '127.0.0.1', r));
    await pool.query("update system_settings set setting_value=$1::jsonb where category='authoritative_orthanc' and setting_key='base_url'", [JSON.stringify({
            value: 'http://127.0.0.1:' + slow.address().port
        })]);
    try {
        await new Promise((resolve, reject) => {
            const call = httpRequest(origin + `/ohif-dicomweb/studies/${studies[0].study}/series/1.2.3/instances/1.2.4/frames/1`, {
                headers: {
                    Cookie: cookie
                }
            }, res => {
                res.once('data', () => {
                    res.destroy();
                    call.destroy();
                    resolve();
                });
            });
            call.on('error', e => e.code === 'ECONNRESET' ? resolve() : reject(e));
            call.end();
        });
        await new Promise(r => setTimeout(r, 250));
        console.log(JSON.stringify({
            cancellation: 'SIMULATED slow frame through real authenticated gateway', closedWithin250ms: producerClosed, producedBytes: producerBytes
        }));
    }
    finally {
        slow.closeAllConnections();
        await new Promise(r => slow.close(r));
        await pool.query("update system_settings set setting_value=$1::jsonb where category='authoritative_orthanc' and setting_key='base_url'", [JSON.stringify({
                value: orthanc
            })]);
    }
    for (const s of studies) {
        const ser = s.series[0];
        const path = `/studies/${s.study}/series/${ser.series}/instances/${ser.sops[0]}`;
        for (const [name, base, headers] of [['direct', orthanc + '/dicom-web', {
                    Accept: 'multipart/related; type="application/octet-stream"; transfer-syntax=*'
                }], ['gateway', origin + '/ohif-dicomweb', {
                    Cookie: cookie, Accept: 'multipart/related; type="application/octet-stream"; transfer-syntax=*'
                }]]) {
            const x = await get(base + path + '/frames/1', {
                headers
            });
            assert.equal(x.r.status, 200);
            const boundary = x.r.headers.get('content-type').match(/boundary="?([^";]+)/)[1];
            const pixelStart = x.body.indexOf('\r\n\r\n') + 4;
            const pixelEnd = x.body.lastIndexOf('\r\n--' + boundary);
            assert.deepEqual(x.body.subarray(pixelStart, pixelEnd), ser.originals[0]);
            const metadata = await get(base + `/studies/${s.study}/series/${ser.series}/metadata`, {
                headers: {
                    ...headers, Accept: 'application/dicom+json'
                }
            });
            const rendered = await get(base + path + '/rendered?accept=image/jpeg', {
                headers: {
                    ...headers, Accept: 'image/jpeg'
                }
            });
            console.log(JSON.stringify({
                network: name, modality: s.modality, frame: {
                    status: x.r.status, ttfbMs: Math.round(x.ttfb), totalMs: Math.round(x.total), decodedBytes: x.body.length, encoding: x.r.headers.get('content-encoding'), type: x.r.headers.get('content-type')?.replace(/boundary=.*/, 'boundary=<redacted>')
                }, metadata: {
                    status: metadata.r.status, totalMs: Math.round(metadata.total), bytes: metadata.body.length
                }, rendered: {
                    status: rendered.r.status, totalMs: Math.round(rendered.total), bytes: rendered.body.length, type: rendered.r.headers.get('content-type')
                }
            }));
        }
    }
    // Create a distinct, initially compressed synthetic CT fixture. The source
    // fixture stays unchanged; this never rewrites a stored diagnostic object.
    const sourceFile = await get(orthanc + '/instances/' + studies[0].series[0].ids[0] + '/file');
    const sourceHash = createHash('sha256').update(sourceFile.body).digest('hex');
    const fixtureFile = await get(orthanc + '/instances/' + studies[0].series[0].ids[0] + '/file?transcode=1.2.840.10008.1.2.4.70');
    assert.equal(fixtureFile.r.status, 200);
    const fixture = dcmjs.data.DicomMessage.readFile(fixtureFile.body.buffer.slice(fixtureFile.body.byteOffset, fixtureFile.body.byteOffset + fixtureFile.body.length));
    const storedStudy = '2.25.100202610103', storedSeries = storedStudy + '.1', storedSop = storedSeries + '.1';
    fixture.meta['00020003'].Value = [storedSop];
    fixture.dict['00080018'].Value = [storedSop];
    fixture.dict['0020000D'].Value = [storedStudy];
    fixture.dict['0020000E'].Value = [storedSeries];
    const storedDict = new dcmjs.data.DicomDict(fixture.meta);
    storedDict.dict = fixture.dict;
    const stored = await get(orthanc + '/instances', {
        method: 'POST', body: Buffer.from(storedDict.write()), headers: {
            'Content-Type': 'application/dicom'
        }
    });
    assert.equal(stored.r.status, 200);
    await pool.query('update viewer_launch_sessions set permitted_study_uids=$1::jsonb where appointment_id=$2', [JSON.stringify([...studies.map(s => s.study), storedStudy]), bookingId]);
    const originalAgain = await get(orthanc + '/instances/' + studies[0].series[0].ids[0] + '/file');
    assert.equal(createHash('sha256').update(originalAgain.body).digest('hex'), sourceHash);
    const jpeg = await rawGet(origin + `/ohif-dicomweb/studies/${storedStudy}/series/${storedSeries}/instances/${storedSop}/frames/1`, {
        Cookie: cookie, Accept: 'multipart/related; type="application/octet-stream"; transfer-syntax=*', 'Accept-Encoding': 'gzip'
    });
    assert.equal(jpeg.status, 200);
    const jpegBody = jpeg.headers['content-encoding'] === 'gzip' ? gunzipSync(jpeg.body) : jpeg.body;
    const jpegBoundary = jpeg.headers['content-type'].match(/boundary="?([^";]+)/)[1];
    const jpegPixels = jpegBody.subarray(jpegBody.indexOf('\r\n\r\n') + 4, jpegBody.lastIndexOf('\r\n--' + jpegBoundary));
    assert.match(jpeg.headers['content-type'], /transfer-syntax=1\.2\.840\.10008\.1\.2\.4\.70/);
    assert.deepEqual(jpegPixels, Buffer.from(fixture.dict['7FE00010'].Value[0]));
    console.log(JSON.stringify({
        losslessJpegResponse: {
            wireBytes: jpeg.body.length, decodedMultipartBytes: jpegBody.length, encodedPixelBytes: jpegPixels.length, ttfbMs: jpeg.ttfbMs, totalMs: jpeg.totalMs, gzipSavingsPercent: Math.round(100 * (1 - jpeg.body.length / jpegBody.length))
        }, originalCompressedBytesPreserved: true, sourceFixtureUnchanged: true, note: 'Default transfer-syntax=* preserves stored synthetic lossless JPEG'
    }));
    const workerName = docker('exec', containerPrefix + '-viewer', 'ls', '/usr/share/nginx/html/ohif').split('\n').find(n => n.startsWith('1927.bundle.') && n.endsWith('.js'));
    for (const [engine, browserType] of [['chromium', chromium], ['webkit', webkit]]) {
        const browser = await browserType.launch();
        try {
            const page = await browser.newPage();
            await page.goto(origin + '/ohif/', {
                waitUntil: 'domcontentloaded', timeout: 60000
            });
            const decoded = await page.evaluate(async ({ workerName, pixels, expected }) => {
                const input = Uint8Array.from(atob(pixels), c => c.charCodeAt(0));
                const reference = Uint8Array.from(atob(expected), c => c.charCodeAt(0));
                const start = performance.now();
                const worker = new Worker('/ohif/' + workerName);
                const result = await new Promise((resolve, reject) => {
                    const timer = setTimeout(() => reject(Error('Synthetic JPEG decode timed out')), 15000);
                    worker.onerror = e => {
                        clearTimeout(timer);
                        reject(Error('Synthetic worker failed'));
                    };
                    worker.onmessage = e => {
                        clearTimeout(timer);
                        resolve(e.data);
                    };
                    worker.postMessage({
                        id: 'phase2-synthetic', type: 'APPLY', path: ['decodeTask'], argumentList: [{
                                type: 'RAW', value: {
                                    imageFrame: {
                                        rows: 512, columns: 512, samplesPerPixel: 1, bitsAllocated: 16, bitsStored: 16, pixelRepresentation: 0, photometricInterpretation: 'MONOCHROME2'
                                    }, transferSyntax: '1.2.840.10008.1.2.4.70', pixelData: input, decodeConfig: {}, options: {
                                        preScale: {
                                            enabled: false
                                        }
                                    }
                                }
                            }]
                    });
                });
                worker.terminate();
                if (result.type !== 'RAW')
                    throw Error('Synthetic JPEG decode failed');
                const data = result.value.pixelData;
                let exact = data.length === reference.length / 2;
                for (let i = 0; exact && i < data.length; i++)
                    exact = data[i] === (reference[i * 2] | reference[i * 2 + 1] << 8);
                return {
                    pixels: data.length, pixelExact: exact, startupAndDecodeMs: Math.round(performance.now() - start)
                };
            }, {
                workerName, pixels: jpegPixels.toString('base64'), expected: studies[0].series[0].originals[0].toString('base64')
            });
            assert.equal(decoded.pixelExact, true);
            console.log(JSON.stringify({
                engine, losslessJpegDecoder: decoded
            }));
        }
        finally {
            await browser.close();
        }
    }
    const variants = process.env.OHIF_PHASE2_MATRIX === '1' ? ['interaction2', 'interaction4', 'interaction6', 'rendered'] : [process.env.OHIF_PHASE2_THUMBNAILS === 'rendered' ? 'rendered' : 'interaction4'];
    for (const variant of variants) {
        let config = readFileSync(join(root, 'docker/ohif/app-config.js'), 'utf8');
        if (variant === 'interaction2')
            config = config.replace('interaction: 4', 'interaction: 2');
        if (variant === 'interaction6')
            config = config.replace('interaction: 4', 'interaction: 6');
        if (variant === 'rendered')
            config = config.replace("thumbnailRendering: 'wadors'", "thumbnailRendering: 'rendered'");
        writeFileSync(join(temp, 'app-config.js'), config);
        for (const [engine, browserType] of [['chromium', chromium], ['webkit', webkit]]) {
            const browser = await browserType.launch({
                headless: true
            });
            try {
                for (const s of studies) {
                    const context = await browser.newContext({
                        viewport: {
                            width: 1440, height: 1000
                        }
                    });
                    await context.addCookies([{
                            name: env.cookieName, value: login, url: origin, httpOnly: true
                        }, {
                            name: env.ohifSessionCookieName, value: token, url: origin, httpOnly: true
                        }]);
                    await context.addInitScript(() => {
                        window.__phase2 = {
                            rendered: [], images: []
                        };
                        const isDiagnosticViewport = event => {
                            const rect = event.target.getBoundingClientRect();
                            return rect.width > 500 && rect.height > 300;
                        };
                        document.addEventListener('CORNERSTONE_IMAGE_RENDERED', event => {
                            if (isDiagnosticViewport(event))
                                window.__phase2.rendered.push(performance.now());
                        }, true);
                        document.addEventListener('CORNERSTONE_STACK_NEW_IMAGE', event => {
                            if (isDiagnosticViewport(event))
                                window.__phase2.images.push(event.detail.imageId);
                        }, true);
                    });
                    const page = await context.newPage();
                    const errors = [];
                    const failed = [];
                    const renderedRequests = [];
                    let active = 0, peak = 0;
                    const isFrame = r => r.url().includes('/frames/');
                    page.on('request', r => {
                        if (isFrame(r)) {
                            active++;
                            peak = Math.max(peak, active);
                        }
                    });
                    page.on('requestfinished', r => {
                        if (isFrame(r))
                            active--;
                    });
                    page.on('requestfailed', r => {
                        if (isFrame(r))
                            active--;
                        failed.push({
                            type: isFrame(r) ? 'frame' : r.url().includes('/ohif-dicomweb/') ? 'dicomweb' : 'asset', status: 0, canceled: /abort|cancel/i.test(r.failure()?.errorText || '')
                        });
                    });
                    if (process.env.OHIF_PHASE2_NETWORK === '10mbps' && engine === 'chromium') {
                        const cdp = await context.newCDPSession(page);
                        await cdp.send('Network.enable');
                        await cdp.send('Network.emulateNetworkConditions', {
                            offline: false, latency: 40, downloadThroughput: 1250000, uploadThroughput: 1250000
                        });
                    }
                    page.on('pageerror', e => errors.push(e.name));
                    page.on('response', r => {
                        if (r.url().includes('/rendered'))
                            renderedRequests.push({
                                accept: r.request().headers()['accept'], status: r.status(), mime: r.headers()['content-type']
                            });
                        if (r.status() >= 400)
                            failed.push({
                                type: r.url().includes('/frames/') ? 'frame' : r.url().includes('/ohif-dicomweb/') ? 'dicomweb' : 'asset', status: r.status()
                            });
                    });
                    await page.goto(origin + '/ohif/viewer?StudyInstanceUIDs=' + s.study, {
                        waitUntil: 'domcontentloaded', timeout: 60000
                    });
                    await page.waitForFunction(() => window.__phase2.rendered.length > 0, null, {
                        timeout: 90000
                    });
                    // Fresh contexts show onboarding over the diagnostic viewport.
                    // Acknowledge it before inspecting pixels; keep this time in the navigation measurement.
                    const skipTour = page.getByText('Skip all', { exact: true });
                    await skipTour.waitFor({ state: 'visible' });
                    await skipTour.click();
                    await skipTour.waitFor({ state: 'hidden' });
                    const confirm = page.getByRole('button', { name: 'Confirm and hide' });
                    await confirm.waitFor({ state: 'visible' });
                    await confirm.click();
                    await confirm.waitFor({ state: 'hidden' });
                    const stage = variant + '-' + engine + '-' + s.modality;
                    const { screenshot, stats, verifiedAtMs } = await verifyVisiblePixels(page, stage + '-first');
                    const pixelsValid = stats.channels[0].stdev > 10 && stats.channels[0].mean > 10;
                    const visibleVerifiedAtMs = verifiedAtMs;
                    writeFileSync(join(temp, variant + '-' + engine + '-' + s.modality + '.png'), screenshot);
                    const measurements = await page.evaluate(() => ({
                        firstRenderEventMs: Math.round(window.__phase2.rendered[0]), requests: performance.getEntriesByType('resource').filter(e => e.name.includes('/ohif-dicomweb/')).map(e => ({
                            type: e.name.includes('/frames/') ? 'frame' : e.name.includes('/metadata') ? 'metadata' : e.name.includes('/rendered') ? 'thumbnail' : 'qido', ttfbMs: Math.round(e.responseStart - e.requestStart), downloadMs: Math.round(e.responseEnd - e.responseStart), encodedBytes: e.encodedBodySize, decodedBytes: e.decodedBodySize
                        }))
                    }));
                    console.log(JSON.stringify({
                        variant, engine, modality: s.modality, network: process.env.OHIF_PHASE2_NETWORK === '10mbps' && engine === 'chromium' ? 'SIMULATED 10 Mbps / 40 ms' : 'OBSERVED loopback', visibleVerifiedAtMs, peakFrameRequests: peak, pixelsValid, roiMean: Math.round(stats.channels[0].mean), roiStd: Math.round(stats.channels[0].stdev), errors, failed, effectiveConcurrency: await page.evaluate(() => window.config.maxNumRequests), ...measurements
                    }));
                    if (!pixelsValid)
                        throw Error(engine + ' ' + s.modality + ' did not display valid pixels');
                    const unloadedAtSwitch = await page.evaluate(series => 12 - new Set(performance.getEntriesByType('resource').filter(e => e.name.includes('/series/' + series + '/') && e.name.includes('/frames/')).map(e => e.name)).size, s.series[1].series);
                    const switchingSamplesMs = [], scrollingSamplesMs = [];
                    const cycles = process.env.OHIF_PHASE2_STRESS === '1' ? 5 : 1;
                    for (let cycle = 0; cycle < cycles; cycle++) {
                        const target = s.series[cycle % 2 === 0 ? 1 : 0];
                        const switchingAt = await page.evaluate(() => performance.now());
                        await page.getByText('Synthetic ' + s.modality + ' series ' + (cycle % 2 === 0 ? 2 : 1), {
                            exact: true
                        }).first().dblclick();
                        await page.waitForFunction(series => window.__phase2.images.at(-1)?.includes('/series/' + series + '/'), target.series, {
                            timeout: 60000
                        });
                        const switched = await verifyVisiblePixels(page, stage + '-switch-' + cycle);
                        switchingSamplesMs.push(Math.round((await page.evaluate(() => performance.now())) - switchingAt));
                        if (cycle === 0)
                            writeFileSync(join(temp, stage + '-switch.png'), switched.screenshot);
                        const imageBefore = await page.evaluate(() => window.__phase2.images.at(-1));
                        const scrollingAt = await page.evaluate(() => performance.now());
                        await page.mouse.move(900, 450);
                        await page.mouse.wheel(0, 120);
                        await page.waitForFunction(before => window.__phase2.images.at(-1) !== before, imageBefore, {
                            timeout: 60000
                        });
                        const scrolled = await verifyVisiblePixels(page, stage + '-scroll-' + cycle);
                        scrollingSamplesMs.push(Math.round((await page.evaluate(() => performance.now())) - scrollingAt));
                        if (cycle === 0)
                            writeFileSync(join(temp, stage + '-scroll.png'), scrolled.screenshot);
                    }
                    console.log(JSON.stringify({
                        variant, engine, modality: s.modality, switchingMs: switchingSamplesMs[0], scrollingMs: scrollingSamplesMs[0], switchingSamplesMs, scrollingSamplesMs, previouslyUnloadedFramesAtSwitch: unloadedAtSwitch, pixelsAfterSwitchAndScroll: true, canceledRequests: failed.filter(f => f.canceled).length, renderedRequests, failedFrames: failed.filter(f => f.type === 'frame' && !f.canceled).length
                    }));
                    assert.deepEqual(errors, []);
                    assert.equal(failed.filter(f => f.type === 'frame' && !f.canceled).length, 0);
                    await context.close();
                }
            }
            finally {
                await browser.close();
            }
        }
    }
}
finally {
    if (appServer)
        await new Promise(r => {
            appServer.closeAllConnections();
            appServer.close(r);
        });
    for (const name of containers.reverse()) {
        try {
            docker('rm', '-f', name);
        }
        catch {
        }
    }
    if (bookingId)
        await pool.query('delete from viewer_launch_sessions where appointment_id=$1', [bookingId]);
    if (userId)
        await pool.query('delete from audit_log where changed_by_user_id=$1', [userId]);
    if (bookingId)
        await pool.query('delete from appointments_v2.bookings where id=$1', [bookingId]);
    if (patientId)
        await pool.query('delete from patients where id=$1', [patientId]);
    if (policySetId)
        await pool.query('delete from appointments_v2.policy_sets where id=$1', [policySetId]);
    if (userId)
        await pool.query('delete from users where id=$1', [userId]);
    if (settingsChanged) {
        await pool.query("delete from system_settings where category='authoritative_orthanc'");
        for (const row of priorSettings)
            await pool.query('insert into system_settings(category,setting_key,setting_value,updated_by_user_id,updated_at) values($1,$2,$3,$4,$5)', [row.category, row.setting_key, row.setting_value, row.updated_by_user_id, row.updated_at]);
        await pool.query('update ohif_viewer_settings set enabled=$1,access_strategy=$2,selected_pacs_node_id=$3 where singleton_key=true', [priorOhif.enabled, priorOhif.access_strategy, priorOhif.selected_pacs_node_id]);
    }
    await pool.end();
}
