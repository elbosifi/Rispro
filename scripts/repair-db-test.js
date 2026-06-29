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
  }

  return values;
}

function argValue(name) {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function quoteIdent(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function quoteLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function requireValue(values, key) {
  const value = String(values[key] ?? '').trim();
  if (!value) throw new Error(`Missing ${key} in codex-db-test.env.`);
  return value;
}

function validateTarget(database, user) {
  if (!/test/i.test(database) || !/test/i.test(user)) {
    throw new Error('Refusing to repair a database/user that does not look test-only. Check PGDATABASE and PGUSER in codex-db-test.env.');
  }
}

async function databaseExists(client, database) {
  const result = await client.query('select 1 from pg_database where datname = $1 limit 1', [database]);
  return result.rows.length > 0;
}

async function roleExists(client, user) {
  const result = await client.query('select 1 from pg_roles where rolname = $1 limit 1', [user]);
  return result.rows.length > 0;
}

function targetDatabaseAdminUrl(adminUrl, database) {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

async function main() {
  if (!fs.existsSync(envPath)) {
    throw new Error(`Missing ${envPath}`);
  }

  const values = loadEnvFile(envPath);
  const database = requireValue(values, 'PGDATABASE');
  const user = requireValue(values, 'PGUSER');
  const password = requireValue(values, 'PGPASSWORD');
  validateTarget(database, user);

  const adminUrl = argValue('--admin-url') || process.env.TEST_DB_ADMIN_URL;
  if (!adminUrl) {
    throw new Error('Missing admin URL. Pass --admin-url "postgresql://postgres:<admin-password>@host:port/postgres" or set TEST_DB_ADMIN_URL.');
  }

  const { Client } = await import('pg');
  const adminClient = new Client({ connectionString: adminUrl });
  await adminClient.connect();

  try {
    if (await roleExists(adminClient, user)) {
      await adminClient.query(`alter role ${quoteIdent(user)} with login password ${quoteLiteral(password)}`);
      console.log(`OK: updated password for local test role ${user}`);
    } else {
      await adminClient.query(`create role ${quoteIdent(user)} with login password ${quoteLiteral(password)}`);
      console.log(`OK: created local test role ${user}`);
    }

    if (await databaseExists(adminClient, database)) {
      await adminClient.query(`alter database ${quoteIdent(database)} owner to ${quoteIdent(user)}`);
      console.log(`OK: ensured local test database ${database} is owned by ${user}`);
    } else {
      await adminClient.query(`create database ${quoteIdent(database)} owner ${quoteIdent(user)}`);
      console.log(`OK: created local test database ${database}`);
    }
  } finally {
    await adminClient.end();
  }

  const targetClient = new Client({ connectionString: targetDatabaseAdminUrl(adminUrl, database) });
  await targetClient.connect();
  try {
    await targetClient.query(`grant all privileges on schema public to ${quoteIdent(user)}`);
    console.log(`OK: granted public schema privileges in ${database}`);
  } finally {
    await targetClient.end();
  }

  console.log('OK: local test DB credentials now match codex-db-test.env');
  console.log('next: npm run db:test:check');
}

main().catch((error) => {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
