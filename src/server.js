import http from "http";
import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { pingDatabase, pool } from "./db/pool.js";

const app = createApp();
const server = http.createServer(app);
let isShuttingDown = false;

async function shutdown(signal) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log(`Received ${signal}. Shutting down gracefully.`);

  server.close(async (serverError) => {
    try {
      await pool.end();
    } catch (poolError) {
      console.error("Failed to close PostgreSQL pool cleanly.", poolError);
    }

    if (serverError) {
      console.error("HTTP server shutdown failed.", serverError);
      process.exit(1);
    }

    process.exit(0);
  });

  setTimeout(() => {
    console.error("Forced shutdown after timeout.");
    process.exit(1);
  }, 10000).unref();
}

server.on("error", (error) => {
  console.error("Failed to start HTTP server.", error);
  process.exit(1);
});

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

async function start() {
  await pingDatabase();

  server.listen(env.port, () => {
    console.log(`RISpro backend listening on http://localhost:${env.port}`);
  });
}

start().catch(async (error) => {
  console.error("RISpro failed to start.", error);

  try {
    await pool.end();
  } catch (poolError) {
    console.error("Failed to close PostgreSQL pool after startup error.", poolError);
  }

  process.exit(1);
});
