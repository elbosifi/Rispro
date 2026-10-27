// Execute the actual compiled ONNX browser module, where an async chunk import
// can have document.currentScript === null. No Node filename global is supplied.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

function verifyMinifiedOnnxGuard(source, file) {
  const at = source.indexOf('__filename');
  const nearby = source.slice(Math.max(0, at - 350), at + 350);
  const guard = /(([$\w]+)=typeof document[\s\S]*?),function\(/.exec(nearby);
  assert.ok(guard, 'Pinned minified ONNX script-location initializer changed');
  for (const currentScript of [null, { src: 'https://synthetic.invalid/ohif/chunk.js' }, undefined]) {
    const context = { document: currentScript === undefined ? undefined : { currentScript } };
    vm.runInNewContext(`let ${guard[2]}; (${guard[1]});`, context, { filename: file, timeout: 3000 });
    assert.equal('__filename' in context, false);
  }
}

function verifyBrowserBuild(dist) {
  const marker = 'node_modules/onnxruntime-web/dist/esm/ort.webgpu.min.js';
  let checked = 0;
  for (const file of fs.readdirSync(dist).filter(file => file.endsWith('.js'))) {
    const source = fs.readFileSync(path.join(dist, file), 'utf8');
    const at = source.indexOf(marker);
    if (at === -1) {
      if (!source.includes('__filename')) continue;
      verifyMinifiedOnnxGuard(source, file);
      checked++;
      continue;
    }
    const start = source.lastIndexOf('\n;//', at);
    const end = source.indexOf('\n;//', at + marker.length);
    assert.ok(start >= 0 && end > start, 'Compiled ONNX module boundaries changed');
    const moduleSource = source.slice(start, end);
    for (const currentScript of [null, { src: 'https://synthetic.invalid/ohif/chunk.js' }, undefined]) {
      const context = { document: currentScript === undefined ? undefined : { currentScript }, __webpack_require__: () => ({ hp: Buffer }) };
      vm.runInNewContext(moduleSource, context, { filename: file, timeout: 3000 });
      assert.equal('__filename' in context, false);
    }
    checked++;
  }
  assert.equal(checked, 1, 'Expected the pinned ONNX browser module in exactly one chunk');
  const workerBootstrap = fs.readFileSync(path.join(dist, 'init-service-worker.js'), 'utf8');
  for (const navigator of [{}, { serviceWorker: { getRegistrations: () => Promise.resolve([]) } }]) {
    vm.runInNewContext(workerBootstrap, { navigator }, { timeout: 1000 });
  }
  console.log('PASS: compiled ONNX browser initialization/guard and service-worker bootstrap use no Node filename global');
}
function protectBootstrapHtml(html) {
  // Cloudflare requires this literal attribute before src, including dependencies.
  return html.replace(/<script\b(?![^>]*\bdata-cfasync=)/g, '<script data-cfasync="false"');
}
module.exports = { verifyBrowserBuild, verifyMinifiedOnnxGuard, protectBootstrapHtml };
if (require.main === module) {
  const dist=process.argv[2] || 'platform/app/dist';
  verifyBrowserBuild(dist);
  const html=path.join(dist,'index.html');
  fs.writeFileSync(html,protectBootstrapHtml(fs.readFileSync(html,'utf8')));
}
