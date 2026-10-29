import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requestKind, summarizeRequests } from './ohif-loading-profile-benchmark.mjs';

test('diagnostic frame accounting excludes metadata and rendered thumbnails', () => {
  const root = 'http://127.0.0.1/ohif-native/context/test/studies/1.2/series/1.3/instances/1.4';
  assert.equal(requestKind(root + '/frames/1?accept=rendered'), 'frame');
  assert.equal(requestKind(root + '/rendered?viewport=160,160'), 'thumbnail');
  assert.equal(requestKind(root + '/metadata'), 'metadata');
  assert.deepEqual(summarizeRequests([
    { kind: 'frame', outcome: 'completed', bodyBytes: 100 },
    { kind: 'frame', outcome: 'failed', bodyBytes: 0 },
    { kind: 'frame', outcome: 'canceled', bodyBytes: 30 },
    { kind: 'frame', outcome: 'pending', bodyBytes: 10 },
    { kind: 'thumbnail', outcome: 'completed', bodyBytes: 999 },
    { kind: 'metadata', outcome: 'completed', bodyBytes: 999 },
  ]), { requested: 4, completed: 1, failed: 1, canceled: 1, pendingAtEnd: 1, imageBytes: 140 });
});
