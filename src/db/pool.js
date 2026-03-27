import pg from "pg";
import { env } from "../config/env.js";

const { Pool } = pg;

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

pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error.", error);
});

export async function pingDatabase() {
  await pool.query("select 1");
}
