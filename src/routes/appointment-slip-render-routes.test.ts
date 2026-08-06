import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import express from "express";
import { appointmentSlipRenderRouter } from "./appointment-slip-render-routes.js";
import { errorHandler } from "../middleware/error-handler.js";

test("internal appointment-slip render data rejects missing and tampered tokens before loading patient data", async () => {
  const app = express();
  app.use("/api/internal/appointment-slip-render", appointmentSlipRenderRouter);
  app.use(errorHandler);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/api/internal/appointment-slip-render/data`;
  try {
    assert.equal((await fetch(baseUrl)).status, 401);
    assert.equal((await fetch(`${baseUrl}?token=tampered`)).status, 401);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
