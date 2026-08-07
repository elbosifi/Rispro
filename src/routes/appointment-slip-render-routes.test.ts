import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import express from "express";
import { appointmentSlipRenderRouter } from "./appointment-slip-render-routes.js";
import { errorHandler } from "../middleware/error-handler.js";
import { createRegistrationListRenderContext, deleteRegistrationListRenderContext, issueRegistrationListRenderToken } from "../services/registration-list-render-context-service.js";

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

test("internal registration-list data fails instead of returning a partial list when an exact ID is unresolved", async () => {
  const context = createRegistrationListRenderContext([2_147_483_647], "Exact list");
  const token = issueRegistrationListRenderToken(context.id);
  const app = express();
  app.use("/api/internal/appointment-slip-render", appointmentSlipRenderRouter);
  app.use(errorHandler);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/api/internal/appointment-slip-render/registration-list/data?token=${encodeURIComponent(token)}`;
  try {
    const response = await fetch(url);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("cache-control"), null);
  } finally {
    deleteRegistrationListRenderContext(context.id);
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
