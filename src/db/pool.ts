import pg from "pg";
import { env } from "../config/env.js";
import { getRisproRuntimeIdentity } from "../services/rispro-runtime-identity.js";

const { Pool } = pg;

const poolConfig: pg.PoolConfig = {
  connectionString: env.databaseUrl,
  max: env.dbPoolMax,
  application_name: getRisproRuntimeIdentity().postgresApplicationName,
  connectionTimeoutMillis: 5_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
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

// Do not log driver messages, connection strings, SQL, or parameters here.
export class RisproPool extends Pool {
  private lastWaitLogAt = 0;

  private logFailure(error: Error): void {
    const rawCode = (error as Error & { code?: string }).code || "";
    const code = /^(?:[0-9A-Z]{5}|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EPIPE)$/.test(rawCode) ? rawCode : "UNKNOWN";
    console.error(JSON.stringify({ event: "postgres_pool_failure", code,
      timeout: /timeout|timed out/i.test(error.message), total: this.totalCount,
      idle: this.idleCount, waiting: this.waitingCount }));
  }

  constructor(config: pg.PoolConfig) {
    super(config);
    // pg removes idle broken clients before emitting this event. Active
    // pool.query errors also release/destroy their client automatically.
    this.on("error", (error: Error) => this.logFailure(error));
    // pool.connect transactions do not get pool.query's temporary error listener.
    // Catch connection errors while checked out; pg rejects pending queries and
    // the transaction's finally block releases the now-unqueryable client.
    const clientError = (error: Error) => this.logFailure(error);
    this.on("acquire", (client: pg.PoolClient) => client.on("error", clientError));
    this.on("release", (error: Error | undefined, client: pg.PoolClient) => {
      client.removeListener("error", clientError);
      const code = (error as (Error & { code?: string }) | undefined)?.code || "";
      if (error && (/timeout|timed out/i.test(error.message) || /^(08|57P0|ECONN|ETIMEDOUT|EPIPE)/.test(code))) this.logFailure(error);
    });
  }

  override connect(): Promise<pg.PoolClient>;
  override connect(callback: (err: Error | undefined, client: pg.PoolClient | undefined, done: (release?: boolean) => void) => void): void;
  override connect(callback?: (err: Error | undefined, client: pg.PoolClient | undefined, done: (release?: boolean) => void) => void): Promise<pg.PoolClient> | void {
    if (this.totalCount >= (this.options.max || 10) && this.idleCount === 0 && Date.now() - this.lastWaitLogAt > 30_000) {
      this.lastWaitLogAt = Date.now();
      console.warn(JSON.stringify({ event: "postgres_pool_wait", total: this.totalCount, idle: this.idleCount, waiting: this.waitingCount }));
    }
    if (callback) {
      return super.connect((error, client, done) => {
        if (error) this.logFailure(error);
        callback(error, client, done);
      });
    }
    return super.connect().catch((error: Error) => { this.logFailure(error); throw error; });
  }
}

export const pool = new RisproPool(poolConfig);

export async function pingDatabase(): Promise<void> {
  const query = { text: "select 1", query_timeout: 5_000 };
  await pool.query(query);
}
