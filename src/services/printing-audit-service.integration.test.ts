import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import http from "node:http";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import { pool } from "../db/pool.js";
import { env } from "../config/env.js";
import { printingRouter } from "../routes/printing-routes.js";
import { errorHandler } from "../middleware/error-handler.js";

const WORKSTATION_SENTINEL = "00000000-0000-4000-8000-000000000099";
let userId = 0;

async function cleanup(): Promise<void> {
  await pool.query("delete from audit_log where entity_type = 'print_job' and new_values->>'workstationId' = $1", [WORKSTATION_SENTINEL]);
  if (userId) await pool.query("delete from users where id = $1", [userId]);
}

before(async () => {
  await cleanup();
  const inserted = await pool.query<{ id: string }>("insert into users (username, full_name, password_hash, role, is_active) values ($1, $2, 'unused', 'receptionist', true) returning id::text", [`qz_audit_${Date.now()}`, "QZ Audit Test"]);
  userId = Number(inserted.rows[0].id);
});
after(async () => { await cleanup(); await pool.end(); });

describe("print audit route persistence", () => {
  it("records a validated submitted event through the authenticated route without document content", async () => {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use("/api/printing", printingRouter);
    app.use(errorHandler);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const token = jwt.sign({ sub: userId, role: "receptionist", username: "qz-audit" }, env.jwtSecret);
    try {
      const response = await fetch(`http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/api/printing/audit`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: `${env.cookieName}=${token}` }, body: JSON.stringify({ workstationId: WORKSTATION_SENTINEL, documentType: "A4_DOCUMENT", appointmentId: null, printerName: "TEST-QUEUE", paperWidthMm: 210, paperHeightMm: 297, outcome: "submitted", failureCode: null }) });
      assert.equal(response.status, 201);
      const { rows } = await pool.query<{ action_type: string; new_values: Record<string, unknown> }>("select action_type,new_values from audit_log where entity_type='print_job' and new_values->>'workstationId'=$1", [WORKSTATION_SENTINEL]);
      assert.equal(rows[0]?.action_type, "print_job_submitted");
      assert.equal(rows[0]?.new_values.outcome, "submitted");
      assert.equal(rows[0]?.new_values.clientReported, true);
      assert.equal("documentContent" in rows[0].new_values, false);
    } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
  });
});
