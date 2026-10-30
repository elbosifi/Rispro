import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

export async function verifyOhifAppConfig(url, expectedSource) {
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200, `OHIF app-config.js returned HTTP ${response.status}`);
  const source = await response.text();
  // Reject stale config and HTML fallback pages as well as malformed JavaScript.
  assert.ok(source.replace(/\r\n/g, '\n') === expectedSource.replace(/\r\n/g, '\n'), 'OHIF app-config.js differs from the checked-out configuration');
  const context = { window: { location: { search: '' } }, URLSearchParams };
  vm.runInNewContext(source, context, { timeout: 1000, filename: 'ohif/app-config.js' });
  const config = context.window.config;
  assert.equal(config?.routerBasename, '/ohif');
  assert.equal(config.defaultDataSourceName, 'risproDicomWeb');
  const dataSource = config.dataSources?.find(source => source.sourceName === 'risproDicomWeb');
  assert.equal(dataSource?.namespace, '@ohif/extension-default.dataSourcesModule.dicomweb');
  assert.equal(dataSource.configuration.qidoRoot, '/ohif-dicomweb');
  assert.equal(dataSource.configuration.wadoRoot, '/ohif-dicomweb');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await verifyOhifAppConfig(process.argv[2], readFileSync(new URL('../docker/ohif/app-config.js', import.meta.url), 'utf8'));
    console.log('OHIF app-config.js is reachable (HTTP 200) and matches the expected RISpro configuration.');
  } catch (error) {
    console.error(`OHIF deployment check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
