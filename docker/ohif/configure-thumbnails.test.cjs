const { test } = require('node:test');
const assert = require('node:assert/strict');
const { retrieveRenderedThumbnail } = require('./configure-thumbnails.cjs');

test('JPEG thumbnails wait in the existing thumbnail queue and use singlepart rendered retrieval', async () => {
  let run, options, requested = false;
  // The pinned client's XHR adapter wraps even singlepart ArrayBuffers in an array.
  const client = { retrieveInstanceRendered: async value => { requested = true; options = value; return [new Uint8Array([255, 216, 255, 217]).buffer]; } };
  const pool = { addRequest: (fn, type) => { assert.equal(type, 'thumbnail'); run = fn; } };
  const pending = retrieveRenderedThumbnail({ StudyInstanceUID: '1.2', SeriesInstanceUID: '1.2.3', SOPInstanceUID: '1.2.3.4' }, client, pool, 'thumbnail', () => ({ Authorization: 'synthetic' }));
  assert.equal(requested, false);
  await run();
  const url = await pending;
  try {
    assert.deepEqual(options, { studyInstanceUID: '1.2', seriesInstanceUID: '1.2.3', sopInstanceUID: '1.2.3.4', mediaTypes: [{ mediaType: 'image/jpeg' }], queryParams: { viewport: '160,160' } });
    assert.equal(client.headers.Authorization, 'synthetic');
    const response = await fetch(url);
    assert.equal(response.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([255, 216, 255, 217]));
  } finally { URL.revokeObjectURL(url); }
});

test('rendered retrieval failure rejects the thumbnail and releases the existing queue', async () => {
  let run;
  const pending = retrieveRenderedThumbnail({}, { retrieveInstanceRendered: async () => { throw Error('403'); } }, { addRequest: fn => { run = fn; } }, 'thumbnail', () => ({}));
  const rejected = assert.rejects(pending, /403/);
  await run();
  await rejected;
});
