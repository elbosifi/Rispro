// @ts-check

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "./pool.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * @typedef {object} SchemaMigrationRow
 * @property {string} filename
 */

async function run() {
  const migrationsDir = path.join(__dirname, "migrations");
  const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();

  await pool.query(`
    create table if not exists schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  for (const file of files) {
    const existingMigration = await pool.query(
      `
        select filename
        from schema_migrations
        where filename = $1
        limit 1
      `,
      [file]
    );

    const existingRows = /** @type {SchemaMigrationRow[]} */ (existingMigration.rows);
    if (existingRows.length > 0) {
      console.log(`Skipped migration: ${file}`);
      continue;
    }

    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
    const client = await pool.connect();

    try {
      await client.query("begin");
      await client.query(sql);
      await client.query(
        `
          insert into schema_migrations (filename)
          values ($1)
        `,
        [file]
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }

    console.log(`Applied migration: ${file}`);
  }

  await pool.end();
}

run().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
