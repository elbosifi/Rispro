import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(repoRoot, 'codex-db-test.env');

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

function classifyPgError(error) {
  if (error?.code === 'MODULE_NOT_FOUND' || error?.code === 'ERR_MODULE_NOT_FOUND') {
    return {
      cause: 'pg package missing',
      next: 'npm install',
    };
  }

  if (error?.code === '28P01') {
    return {
      cause: 'wrong password',
      next: 'psql -h localhost -p 5432 -U postgres -d postgres -c "ALTER USER rispro_test WITH PASSWORD \'<codex-db-test.env PGPASSWORD>\';"',
    };
  }

  if (error?.code === '3D000') {
    return {
      cause: 'database does not exist',
      next: 'psql -h localhost -p 5432 -U postgres -d postgres -c "CREATE DATABASE rispro_test OWNER rispro_test;"',
    };
  }

  if (error?.code === '28000' || error?.code === '42501' || /role .* does not exist|permission denied/i.test(error?.message ?? '')) {
    return {
      cause: 'user does not exist / permission denied',
      next: 'psql -h localhost -p 5432 -U postgres -d postgres -c "CREATE USER rispro_test WITH PASSWORD \'<codex-db-test.env PGPASSWORD>\'; GRANT ALL PRIVILEGES ON DATABASE rispro_test TO rispro_test;"',
    };
  }

  if (error?.code === 'ECONNREFUSED') {
    return {
      cause: process.env.PGPORT && process.env.PGPORT !== '5432' ? 'port wrong' : 'PostgreSQL not running',
      next: 'pg_isready -h localhost -p 5432',
    };
  }

  if (error?.code === 'ETIMEDOUT' || error?.code === 'ENOTFOUND' || error?.code === 'EHOSTUNREACH') {
    return {
      cause: 'port wrong',
      next: 'pg_isready -h localhost -p 5432',
    };
  }

  return {
    cause: 'unknown PostgreSQL connection failure',
    next: 'pg_isready -h localhost -p 5432',
  };
}

async function main() {
  if (!fs.existsSync(envPath)) {
    console.error(`FAIL: Missing ${envPath}`);
    process.exitCode = 1;
    return;
  }

  loadEnvFile(envPath);

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
      console.error(`detail: ${error.message.replaceAll(process.env.PGPASSWORD ?? '', masked(process.env.PGPASSWORD))}`);
    }
    console.error(`next: ${diagnosis.next}`);
    process.exitCode = 1;
  }
}

main();
