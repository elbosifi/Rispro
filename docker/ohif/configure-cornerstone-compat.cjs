// Backport cornerstone3D PR #2810 (c4a864febdd7d553826324637172d69a0b9d9932)
// to the ESM source actually consumed by pinned OHIF. No dependency upgrade.
const fs = require('node:fs');
const path = require('node:path');

function canUseFloatOpacityTexture(openGLRenderWindow, context) {
  const supportsFloatTextures = openGLRenderWindow.getWebgl2() ||
    Boolean(context.getExtension('OES_texture_float'));
  const supportsFloatLinearFiltering = Boolean(context.getExtension('OES_texture_float_linear'));
  return supportsFloatTextures && supportsFloatLinearFiltering;
}

function configureCornerstoneCompat(root) {
  const core = path.join(root, 'node_modules/@cornerstonejs/core');
  if (JSON.parse(fs.readFileSync(path.join(core, 'package.json'), 'utf8')).version !== '4.15.29') {
    throw Error('Pinned Cornerstone version changed: review PR #2810 backport');
  }
  const directory = path.join(core, 'dist/esm/RenderingEngine/vtkClasses');
  const file = path.join(directory, 'vtkStreamingOpenGLVolumeMapper.js');
  let source = fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
  const anchor = `model._openGLRenderWindow.getWebgl2() ||
                (model.context.getExtension('OES_texture_float') &&
                    model.context.getExtension('OES_texture_float_linear'))`;
  const imports = "import { getCanUseNorm16Texture } from '../../init';";
  for (const text of [anchor, imports]) {
    if (source.split(text).length !== 2) throw Error('Pinned Cornerstone opacity mapper changed');
  }
  source = source.replace(anchor, 'canUseFloatOpacityTexture(model._openGLRenderWindow, model.context)')
    .replace(imports, imports + "\nimport canUseFloatOpacityTexture from './canUseFloatOpacityTexture';");
  fs.writeFileSync(file, source);
  fs.writeFileSync(path.join(directory, 'canUseFloatOpacityTexture.js'),
    '// cornerstone3D PR #2810: WebGL2 float textures still require float-linear filtering.\nexport default ' + canUseFloatOpacityTexture.toString() + '\n');
}

module.exports = { configureCornerstoneCompat, canUseFloatOpacityTexture };
if (require.main === module) configureCornerstoneCompat(process.cwd());
