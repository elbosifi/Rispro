import assert from "node:assert/strict";
import { describe, it } from "node:test";
import http from "node:http";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import { __printingRouteTestables } from "./printing-routes.js";
import { printingRouter } from "./printing-routes.js";
import { errorHandler } from "../middleware/error-handler.js";
import { env } from "../config/env.js";

const valid = { workstationId: "00000000-0000-4000-8000-000000000001", documentType: "ACCESSION_LABEL", appointmentId: 7, accessionNumber: "ACC-7", printerName: "Label Queue", paperWidthMm: 50, paperHeightMm: 30, outcome: "submitted", failureCode: null };
describe("printing audit validation", () => {
  it("accepts a submitted client-reported audit", () => assert.equal(__printingRouteTestables.parseAudit(valid).outcome, "submitted"));
  it("rejects arbitrary document types, failure codes, nested values, and dimensions", () => {
    assert.throws(() => __printingRouteTestables.parseAudit({ ...valid, documentType: "PATIENT_NAME" }));
    assert.throws(() => __printingRouteTestables.parseAudit({ ...valid, outcome: "failed", failureCode: "anything" }));
    assert.throws(() => __printingRouteTestables.parseAudit({ ...valid, accessionNumber: { patient: "secret" } }));
    assert.throws(() => __printingRouteTestables.parseAudit({ ...valid, paperWidthMm: Infinity }));
  });
});

describe("QZ signing route limits", () => {
  it("returns 413 for an oversized route-specific JSON request and rate-limits by user", async () => {
    const app = express();
    app.use(cookieParser());
    app.use("/api/printing", printingRouter);
    app.use(errorHandler);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/api/printing/qz-sign`;
    const cookie = `${env.cookieName}=${jwt.sign({ sub: 42, role: "receptionist" }, env.jwtSecret)}`;
    try {
      const oversized = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ request: "A".repeat(env.qzSigningRequestLimitMb * 1024 * 1024 + 1), digest: "0".repeat(64) }) });
      assert.equal(oversized.status, 413);
      let status = 0;
      for (let index = 0; index < 61; index += 1) status = (await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ request: "not-json", digest: "0".repeat(64) }) })).status;
      assert.equal(status, 429);
    } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
  });
});
