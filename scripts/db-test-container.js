import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(repoRoot, 'codex-db-test.env');
const containerName = 'rispro-test-postgres';
const image = 'postgres:16-alpine';
const managedKeys = ['DATABASE_URL', 'TEST_DATABASE_URL', 'PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD'];

function loadEnvFile(filePath) {
  const values = {};
  if (!fs.existsSync(filePath)) return values;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const equalsIndex = line.indexOf('=');
    if (equalsIndex === -1) continue;
    values[line.slice(0, equalsIndex).trim()] = line.slice(equalsIndex + 1).trim();
  }
  return values;
}

function mask(value) {
  if (!value) return '(empty)';
  return '*'.repeat(Math.min(8, Math.max(4, value.length)));
}

function redact(text, password) {
  if (!text || !password) return text;
  return text.replaceAll(password, mask(password));
}

function runDocker(args, options = {}) {
  const result = spawnSync('docker', args, { encoding: 'utf8', ...options });
  return {
    ...result,
    stdout: redact(result.stdout ?? '', options.password),
    stderr: redact(result.stderr ?? '', options.password),
  };
}

function dockerOk(args) {
  return runDocker(args).status === 0;
}

function validateTarget(database, user) {
  if (!/test/i.test(database) || !/test/i.test(user)) {
    throw new Error('Refusing to manage a database/user that does not look test-only. Check PGDATABASE and PGUSER in codex-db-test.env.');
  }
}

function postgresUrl(values) {
  const user = encodeURIComponent(values.PGUSER);
  const password = encodeURIComponent(values.PGPASSWORD);
  const database = encodeURIComponent(values.PGDATABASE);
  return `postgresql://${user}:${password}@${values.PGHOST}:${values.PGPORT}/${database}`;
}

function updateEnvFile(nextValues) {
  const existingText = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const seen = new Set();
  const lines = existingText
    .split(/\r?\n/)
    .filter((line, index, all) => index < all.length - 1 || line !== '')
    .map((line) => {
      const equalsIndex = line.indexOf('=');
      if (equalsIndex === -1) return line;
      const key = line.slice(0, equalsIndex).trim();
      if (!managedKeys.includes(key)) return line;
      seen.add(key);
      return `${key}=${nextValues[key]}`;
    });

  for (const key of managedKeys) {
    if (!seen.has(key)) lines.push(`${key}=${nextValues[key]}`);
  }

  fs.writeFileSync(envPath, `${lines.join('\n')}\n`);
}

function portAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function selectPort() {
  if (await portAvailable(5432)) return 5432;
  if (await portAvailable(5433)) return 5433;
  throw new Error('Neither localhost:5432 nor localhost:5433 is available for the disposable test PostgreSQL container.');
}

function preserveRunningContainerIfPresent() {
  const result = runDocker(['inspect', '--format', '{{.State.Running}}', containerName]);
  if (result.status !== 0) return false;
  if (result.stdout.trim() === 'true') {
    console.log(`OK: preserving already-running disposable test container ${containerName}`);
    return true;
  }

  if (!dockerOk(['inspect', containerName])) return;
  const removeResult = runDocker(['rm', '-f', containerName]);
  if (removeResult.status !== 0) {
    throw new Error(`Failed to remove stopped disposable test container ${containerName}: ${removeResult.stderr || removeResult.stdout}`);
  }
  console.log(`OK: removed stopped disposable test container ${containerName}`);
  return false;
}

async function waitForPostgres(values) {
  const { Client } = await import('pg');
  const deadline = Date.now() + 45_000;
  let lastError = null;
  while (Date.now() < deadline) {
    const client = new Client({
      host: values.PGHOST,
      port: Number(values.PGPORT),
      database: values.PGDATABASE,
      user: values.PGUSER,
      password: values.PGPASSWORD,
    });
    try {
      await client.connect();
      await client.query('select 1');
      await client.end();
      return;
    } catch (error) {
      lastError = error;
      try {
        await client.end();
      } catch {
        // ignore cleanup errors while PostgreSQL is booting
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error(`PostgreSQL test container did not become ready: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function up() {
  const values = loadEnvFile(envPath);
  const database = values.PGDATABASE || 'rispro_test';
  const user = values.PGUSER || 'rispro_test';
  const password = values.PGPASSWORD || 'rispro_test_password';
  validateTarget(database, user);

  const dockerVersion = runDocker(['version', '--format', '{{.Server.Version}}']);
  if (dockerVersion.status !== 0) {
    throw new Error(`Docker is not available. Start Docker Desktop, then rerun npm run db:test:up. ${dockerVersion.stderr || dockerVersion.stdout}`);
  }

  if (preserveRunningContainerIfPresent()) return;
  const port = await selectPort();
  const nextValues = {
    DATABASE_URL: '',
    TEST_DATABASE_URL: '',
    PGHOST: 'localhost',
    PGPORT: String(port),
    PGDATABASE: database,
    PGUSER: user,
    PGPASSWORD: password,
  };
  nextValues.DATABASE_URL = postgresUrl(nextValues);
  nextValues.TEST_DATABASE_URL = nextValues.DATABASE_URL;
  updateEnvFile(nextValues);

  const result = runDocker([
    'run',
    '-d',
    '--name',
    containerName,
    '--label',
    'rispro.role=test-db',
    '-e',
    `POSTGRES_DB=${database}`,
    '-e',
    `POSTGRES_USER=${user}`,
    '-e',
    `POSTGRES_PASSWORD=${password}`,
    '-p',
    `127.0.0.1:${port}:5432`,
    image,
  ], { password });

  if (result.status !== 0) {
    throw new Error(`Failed to start disposable PostgreSQL container: ${result.stderr || result.stdout}`);
  }

  await waitForPostgres(nextValues);
  console.log(`OK: disposable RISpro test PostgreSQL is running in Docker container ${containerName}`);
  console.log(`host: ${nextValues.PGHOST}`);
  console.log(`port: ${nextValues.PGPORT}`);
  console.log(`database: ${nextValues.PGDATABASE}`);
  console.log(`user: ${nextValues.PGUSER}`);
  console.log(`password: ${mask(nextValues.PGPASSWORD)}`);
  console.log('OK: codex-db-test.env now matches the disposable test container');
  console.log('next: npm run db:test:check');
}

function down() {
  if (!dockerOk(['inspect', containerName])) {
    console.log(`OK: disposable test container ${containerName} is not present`);
    return;
  }
  const result = runDocker(['rm', '-f', containerName]);
  if (result.status !== 0) {
    throw new Error(`Failed to remove disposable test container ${containerName}: ${result.stderr || result.stdout}`);
  }
  console.log(`OK: removed disposable test container ${containerName}`);
}

const command = process.argv[2];
try {
  if (command === 'up') {
    await up();
  } else if (command === 'down') {
    down();
  } else {
    throw new Error('Usage: node scripts/db-test-container.js up|down');
  }
} catch (error) {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
