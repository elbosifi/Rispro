import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const executable = process.env.RISPRO_TEST_PWSH || (process.platform === 'win32' ? 'powershell.exe' : 'pwsh');
const probe = spawnSync(executable, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], { encoding: 'utf8' });
test('NAPS2 setup XML, policy and restricted firewall behavior', { skip: probe.error ? `PowerShell unavailable: ${probe.error.message}. Run this file on Windows or set RISPRO_TEST_PWSH to a portable runtime.` : false }, () => {
  const result = spawnSync(executable, ['-NoProfile', '-File', fileURLToPath(new URL('./naps2-setup.test.ps1', import.meta.url))], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /PASS: 15 setup tests/);
});

test('setup probes real HTTP capabilities and CORS without scanning, rejects HTML 200', { skip: probe.error ? 'PowerShell unavailable' : false }, async () => {
  let html = false;
  let scans = 0;
  const server = createServer((req, res) => {
    if (req.method !== 'GET') scans++;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end(html ? '<html>not a scanner</html>' : '<scan:ScannerCapabilities xmlns:scan="http://schemas.hp.com/imaging/escl/2011/05/03"><scan:DocumentFormatExt>application/pdf</scan:DocumentFormatExt></scan:ScannerCapabilities>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  async function runProbe() {
    const command = "$env:RISPRO_NAPS2_TEST='1'; $s=[IO.File]::ReadAllText($env:RISPRO_NAPS2_SETUP_FILE); $m=[regex]::Match($s,'(?m)^# RISPRO_NAPS2_POWERSHELL\\r?$'); . ([scriptblock]::Create($s.Substring($m.Index+$m.Length))); ConvertTo-Json -Compress -InputObject @(Get-EsclEndpoint @($env:RISPRO_NAPS2_PROBE_ENDPOINT) 'http://192.9.101.30')";
    const child = spawn(executable, ['-NoProfile', '-Command', command], { env: { ...process.env, RISPRO_NAPS2_SETUP_FILE: fileURLToPath(new URL('./windows/RISpro-NAPS2-Setup.cmd', import.meta.url)), RISPRO_NAPS2_PROBE_ENDPOINT: endpoint }, timeout: 15_000 });
    let stdout = '', stderr = '';
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });
    const code = await new Promise((resolve, reject) => { child.on('exit', resolve); child.on('error', reject); });
    assert.equal(code, 0, stderr);
    return JSON.parse(stdout);
  }
  try {
    assert.deepEqual(await runProbe(), [{ Endpoint: endpoint, Cors: true }]);
    html = true;
    assert.deepEqual(await runProbe(), []);
    assert.equal(scans, 0);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
