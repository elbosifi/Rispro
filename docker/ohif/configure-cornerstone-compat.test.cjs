const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { canUseFloatOpacityTexture, configureCornerstoneCompat } = require('./configure-cornerstone-compat.cjs');

test('PR #2810 preserves float precision only when float textures AND linear filtering are supported', () => {
  for (const [webgl2, extensions, expected] of [
    [true, [], false], [true, ['OES_texture_float_linear'], true],
    [false, ['OES_texture_float', 'OES_texture_float_linear'], true],
    [false, ['OES_texture_float_linear'], false], [false, ['OES_texture_float'], false], [false, [], false],
  ]) {
    assert.equal(canUseFloatOpacityTexture({ getWebgl2: () => webgl2 }, {
      getExtension: name => extensions.includes(name) ? {} : null,
    }), expected);
  }
});

test('backport patches the pinned consumed ESM source once, leaves scalar and byte paths intact and rejects drift', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ohif-opacity-'));
  const core = path.join(root, 'node_modules/@cornerstonejs/core');
  const directory = path.join(core, 'dist/esm/RenderingEngine/vtkClasses');
  const filename = path.join(directory, 'vtkStreamingOpenGLVolumeMapper.js');
  fs.mkdirSync(directory, { recursive: true });
  const source = `import { getCanUseNorm16Texture } from '../../init';
if (model._openGLRenderWindow.getWebgl2() ||
                (model.context.getExtension('OES_texture_float') &&
                    model.context.getExtension('OES_texture_float_linear'))) {
  create2DFromRaw({ dataType: VtkDataTypes.FLOAT, data: ofTable });
} else {
  const oTable = new Uint8ClampedArray(oSize);
  create2DFromRaw({ dataType: VtkDataTypes.UNSIGNED_CHAR, data: oTable });
}
scalarTexture.enableUseHalfFloat(false);`;
  try {
    fs.writeFileSync(path.join(core, 'package.json'), JSON.stringify({ version: '4.15.29' }));
    fs.writeFileSync(filename, source);
    configureCornerstoneCompat(root);
    const patched = fs.readFileSync(filename, 'utf8');
    assert.ok(patched.includes('if (canUseFloatOpacityTexture(model._openGLRenderWindow, model.context))'));
    assert.equal(patched.slice(patched.indexOf('  create2DFromRaw')), source.slice(source.indexOf('  create2DFromRaw')));
    assert.throws(() => configureCornerstoneCompat(root), /mapper changed/);
    fs.writeFileSync(path.join(core, 'package.json'), JSON.stringify({ version: '4.16.0' }));
    assert.throws(() => configureCornerstoneCompat(root), /version changed/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
