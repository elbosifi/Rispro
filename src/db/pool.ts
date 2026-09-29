import pg from "pg";
import { env } from "../config/env.js";
import { getRisproRuntimeIdentity } from "../services/rispro-runtime-identity.js";

const { Pool } = pg;

const poolConfig: pg.PoolConfig = {
  connectionString: env.databaseUrl,
  max: env.dbPoolMax,
  application_name: getRisproRuntimeIdentity().postgresApplicationName,
};

// Support local Unix socket connections for development
if (process.env.PGHOST) {
  poolConfig.host = process.env.PGHOST;
}

if (env.databaseSsl) {
  poolConfig.ssl = {
    rejectUnauthorized: env.databaseSslRejectUnauthorized
  };
}

export const pool = new Pool(poolConfig);

pool.on("error", (error: Error) => {
  console.error("Unexpected PostgreSQL pool error.", error);
});

export async function pingDatabase(): Promise<void> {
  await pool.query("select 1");
}
