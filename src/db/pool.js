// @ts-check

import pg from "pg";
import { env } from "../config/env.js";

const { Pool } = pg;

/** @type {import("pg").PoolConfig} */
const poolConfig = {
  connectionString: env.databaseUrl,
  max: env.dbPoolMax
};

if (env.databaseSsl) {
  poolConfig.ssl = {
    rejectUnauthorized: env.databaseSslRejectUnauthorized
  };
}

export const pool = new Pool(poolConfig);

/**
 * @param {Error} error
 */
pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error.", error);
});

/** @returns {Promise<void>} */
export async function pingDatabase() {
  await pool.query("select 1");
}
