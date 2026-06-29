import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(repoRoot, 'codex-db-test.env');
const REQUIRED_KEYS = ['DATABASE_URL', 'TEST_DATABASE_URL', 'PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD'];

function loadEnvFile(filePath) {
  const values = {};
  const text = fs.readFileSync(filePath, 'utf8');

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const equalsIndex = line.indexOf('=');
    if (equalsIndex === -1) continue;

    const key = line.slice(0, equalsIndex).trim();
    const value = line.slice(equalsIndex + 1).trim();
    values[key] = value;
    process.env[key] = value;
  }

  return values;
}

function masked(value) {
  if (!value) return '(empty)';
  return '*'.repeat(Math.min(8, Math.max(4, value.length)));
}

function redactPassword(text) {
  const password = process.env.PGPASSWORD;
  if (!text || !password) return text;
  if (password === process.env.PGUSER) return text;
  return text.replaceAll(password, masked(password));
}

function repairCommand() {
  return [
    'npm run db:test:repair -- --admin-url "postgresql://postgres:<admin-password>@',
    `${process.env.PGHOST || 'localhost'}:${process.env.PGPORT || '5432'}/postgres"`,
  ].join('');
}

function psqlFallback(command) {
  return [
    'psql -h ',
    process.env.PGHOST || 'localhost',
    ' -p ',
    process.env.PGPORT || '5432',
    ' -U postgres -d postgres -c "',
    command,
    '"',
  ].join('');
}

function validateEnv(values) {
  const missing = REQUIRED_KEYS.filter((key) => !String(values[key] ?? '').trim());
  if (missing.length > 0) {
    return {
      ok: false,
      message: `Missing required keys in codex-db-test.env: ${missing.join(', ')}`,
    };
  }

  const port = Number(values.PGPORT);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return {
      ok: false,
      message: 'PGPORT in codex-db-test.env must be a valid TCP port.',
    };
  }

  for (const key of ['DATABASE_URL', 'TEST_DATABASE_URL']) {
    try {
      const url = new URL(values[key]);
      const urlDb = decodeURIComponent(url.pathname.replace(/^\//, ''));
      const urlUser = decodeURIComponent(url.username);
      const urlHost = url.hostname;
      const urlPort = url.port || '5432';
      if (urlDb !== values.PGDATABASE || urlUser !== values.PGUSER || urlHost !== values.PGHOST || urlPort !== String(values.PGPORT)) {
        return {
          ok: false,
          message: `${key} does not match PGHOST/PGPORT/PGDATABASE/PGUSER in codex-db-test.env.`,
        };
      }
    } catch {
      return {
        ok: false,
        message: `${key} in codex-db-test.env is not a valid PostgreSQL URL.`,
      };
    }
  }

  return { ok: true };
}

function classifyPgError(error) {
  if (error?.code === 'MODULE_NOT_FOUND' || error?.code === 'ERR_MODULE_NOT_FOUND') {
    return {
      cause: 'pg package missing',
      next: 'npm install',
    };
  }

  if (error?.code === '28P01') {
    return {
      cause: `wrong password for ${process.env.PGUSER}`,
      next: repairCommand(),
      fallback: psqlFallback(`ALTER USER ${process.env.PGUSER} WITH PASSWORD '<codex-db-test.env PGPASSWORD>';`),
    };
  }

  if (error?.code === '3D000') {
    return {
      cause: 'database does not exist',
      next: repairCommand(),
      fallback: psqlFallback(`CREATE DATABASE ${process.env.PGDATABASE} OWNER ${process.env.PGUSER};`),
    };
  }

  if (error?.code === '28000' || error?.code === '42501' || /role .* does not exist|permission denied/i.test(error?.message ?? '')) {
    return {
      cause: 'user does not exist / permission denied',
      next: repairCommand(),
      fallback: psqlFallback(`CREATE USER ${process.env.PGUSER} WITH PASSWORD '<codex-db-test.env PGPASSWORD>'; GRANT ALL PRIVILEGES ON DATABASE ${process.env.PGDATABASE} TO ${process.env.PGUSER};`),
    };
  }

  if (error?.code === 'ECONNREFUSED') {
    return {
      cause: `PostgreSQL not reachable at ${process.env.PGHOST}:${process.env.PGPORT}`,
      next: `Start PostgreSQL or update PGHOST/PGPORT in codex-db-test.env, then rerun npm run db:test:check.`,
    };
  }

  if (error?.code === 'ETIMEDOUT' || error?.code === 'ENOTFOUND' || error?.code === 'EHOSTUNREACH') {
    return {
      cause: `PostgreSQL host/port unreachable: ${process.env.PGHOST}:${process.env.PGPORT}`,
      next: `Fix PGHOST/PGPORT in codex-db-test.env, then rerun npm run db:test:check.`,
    };
  }

  return {
    cause: 'unknown PostgreSQL connection failure',
    next: `Confirm PostgreSQL is running at ${process.env.PGHOST}:${process.env.PGPORT} and rerun npm run db:test:check.`,
  };
}

async function main() {
  if (!fs.existsSync(envPath)) {
    console.error(`FAIL: Missing ${envPath}`);
    process.exitCode = 1;
    return;
  }

  const values = loadEnvFile(envPath);
  const envValidation = validateEnv(values);
  if (!envValidation.ok) {
    console.error(`FAIL: ${envValidation.message}`);
    process.exitCode = 1;
    return;
  }

  console.log('DB test parameters from codex-db-test.env');
  console.log(`host: ${process.env.PGHOST}`);
  console.log(`port: ${process.env.PGPORT}`);
  console.log(`database: ${process.env.PGDATABASE}`);
  console.log(`user: ${process.env.PGUSER}`);
  console.log(`password: ${masked(process.env.PGPASSWORD)}`);

  try {
    const { Client } = await import('pg');
    const client = new Client({
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT),
      database: process.env.PGDATABASE,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
    });

    await client.connect();
    const result = await client.query('select current_database(), current_user, version()');
    await client.end();

    const row = result.rows[0];
    console.log('OK: PostgreSQL connection succeeded');
    console.log(`current_database: ${row.current_database}`);
    console.log(`current_user: ${row.current_user}`);
    console.log(`version: ${row.version}`);
  } catch (error) {
    const diagnosis = classifyPgError(error);
    console.error(`FAIL: ${diagnosis.cause}`);
    if (error?.message) {
      console.error(`detail: ${redactPassword(error.message)}`);
    }
    console.error(`next: ${diagnosis.next}`);
    if (diagnosis.fallback) {
      console.error(`psql fallback: ${diagnosis.fallback}`);
    }
    process.exitCode = 1;
  }
}

main();
