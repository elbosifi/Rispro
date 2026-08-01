import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { pool } from "../db/pool.js";
import { logAuditEntry } from "./audit-service.js";

const WORKSTATION_SENTINEL = "qz-printing-integration-test";

async function cleanup(): Promise<void> {
  await pool.query(
    `delete from audit_log
     where entity_type = 'print_job'
       and new_values->>'workstationId' = any($1::text[])`,
    [[WORKSTATION_SENTINEL, "qz-validation"]]
  );
}

before(cleanup);
after(async () => { await cleanup(); await pool.end(); });

describe("print audit persistence", () => {
  it("records submission metadata without document content", async () => {
    const inserted = await logAuditEntry({
      entityType: "print_job",
      actionType: "print_job_submitted",
      changedByUserId: null,
      newValues: {
        outcome: "successful",
        workstationId: WORKSTATION_SENTINEL,
        documentType: "A4_DOCUMENT",
        printerName: "TEST-QUEUE",
        paperWidthMm: 210,
        paperHeightMm: 297,
      },
    });
    assert.ok(inserted);
    const { rows } = await pool.query<{ new_values: Record<string, unknown> }>("select new_values from audit_log where id = $1", [inserted.id]);
    assert.equal(rows[0]?.new_values.workstationId, WORKSTATION_SENTINEL);
    assert.equal(rows[0]?.new_values.printerName, "TEST-QUEUE");
    assert.equal("documentContent" in rows[0].new_values, false);
  });
});
