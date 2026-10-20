import assert from "node:assert/strict";
import test from "node:test";
import net from "node:net";
import { env } from "../config/env.js";
import { pool, RisproPool } from "./pool.js";

test("pool discards a terminated PostgreSQL connection and subsequent requests succeed", async () => {
  const client = await pool.connect();
  const pid = (await client.query("select pg_backend_pid() as pid")).rows[0].pid;
  const errorEvent = new Promise<void>((resolve) => pool.once("error", () => resolve()));
  client.release();
  // Use a separate test connection to terminate only this suite's idle client.
  const control = new RisproPool({ connectionString: env.databaseUrl, max: 1, connectionTimeoutMillis: 1000 });
  try {
    await control.query("select pg_terminate_backend($1)", [pid]);
    await errorEvent;
    assert.equal((await pool.query("select 1 as restored")).rows[0].restored, 1);
  } finally { await control.end(); }
});

test("acquisition timeout is finite, logs are redacted, and releasing capacity restores requests", async (t) => {
  const log = t.mock.method(console, "error", () => undefined);
  const waitLog = t.mock.method(console, "warn", () => undefined);
  const limited = new RisproPool({ connectionString: env.databaseUrl, max: 1, connectionTimeoutMillis: 80 });
  const held = await limited.connect();
  try {
    await assert.rejects(limited.query("select 1"), /timeout/i);
    assert.equal(limited.waitingCount, 0);
    held.release();
    assert.equal((await limited.query("select 1 as restored")).rows[0].restored, 1);
    limited.emit("error", Object.assign(new Error("postgres://secret:password@host patient-name"), { code: "ECONNRESET" }));
    const output = log.mock.calls.map((call) => call.arguments.join(" ")).join("\n");
    assert.match(output, /postgres_pool_failure/);
    assert.doesNotMatch(output, /secret|password|patient-name|postgres:\/\//);
    assert.ok(waitLog.mock.calls.length > 0);
  } finally { await limited.end(); }
});

test("a checked-out transaction connection handles failover errors and is replaced", async () => {
  const client = await pool.connect();
  const control = new RisproPool({ connectionString: env.databaseUrl, max: 1, connectionTimeoutMillis: 1000 });
  let discardClient = false;
  try {
    assert.ok(client.listenerCount("error") > 0, "checked-out transaction clients need an error listener");
    await client.query("begin");
    const pid = (await client.query("select pg_backend_pid() as pid")).rows[0].pid;
    const rejected = assert.rejects(client.query("select pg_sleep(10)"), /terminat/i);
    await control.query("select pg_terminate_backend($1)", [pid]);
    await rejected;
  } finally {
    // Match dictionary transaction cleanup: failed rollback must never return a
    // closing connection to the pool, even before its TCP end event arrives.
    await client.query("rollback").catch(() => { discardClient = true; });
    client.release(discardClient);
    await control.end();
  }
  assert.equal(discardClient, true);
  assert.equal((await pool.query("select 1 as restored")).rows[0].restored, 1);
});

test("silent network interruptions time out and recover through the same pool", async () => {
  const target = new URL(env.databaseUrl);
  const sockets = new Set<net.Socket>();
  let stallConnections = true;
  let dropQueries = false;
  const proxy = net.createServer((socket) => {
    sockets.add(socket); socket.on("close", () => sockets.delete(socket)); socket.on("error", () => undefined);
    if (stallConnections) return;
    const upstream = net.connect(Number(target.port || 5432), target.hostname);
    sockets.add(upstream); upstream.on("close", () => sockets.delete(upstream));
    upstream.on("error", () => socket.destroy());
    socket.on("data", (data) => { if (!dropQueries) upstream.write(data); });
    upstream.on("data", (data) => socket.write(data));
    socket.on("close", () => upstream.destroy()); upstream.on("close", () => socket.destroy());
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const url = new URL(target); url.hostname = "127.0.0.1"; url.port = String((proxy.address() as net.AddressInfo).port);
  const recovering = new RisproPool({ connectionString: url.toString(), max: 1, connectionTimeoutMillis: 150, keepAlive: true });
  try {
    await assert.rejects(recovering.query("select 1"), /timeout/i);
    stallConnections = false;
    assert.equal((await recovering.query("select 1 as restored")).rows[0].restored, 1);
    dropQueries = true;
    const bounded = { text: "select 1", query_timeout: 150 };
    await assert.rejects(recovering.query(bounded), /timeout/i);
    dropQueries = false;
    assert.equal((await recovering.query("select 1 as restored")).rows[0].restored, 1);
  } finally {
    for (const socket of sockets) socket.destroy();
    await recovering.end();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
  }
});
