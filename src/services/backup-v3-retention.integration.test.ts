import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { pool } from "../db/pool.js";
import { executeManualLocalBackupV3Retention } from "./backup-v3-retention-service.js";

test("local retention removes only a redundant older archive and records the deletion", async () => {
  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const root = path.join(process.cwd(), "storage", "backups", `retention-${suffix}`);
  const primaryDestinationId = crypto.randomUUID();
  const secondaryDestinationId = crypto.randomUUID();
  const oldJobId = crypto.randomUUID();
  const newJobId = crypto.randomUUID();
  const oldArtifactId = crypto.randomUUID();
  const newArtifactId = crypto.randomUUID();
  const oldPrimaryCopyId = crypto.randomUUID();
  const oldSecondaryCopyId = crypto.randomUUID();
  const newPrimaryCopyId = crypto.randomUUID();
  const oldArchive = path.join(root, `old-${suffix}.rispro.zip`);
  const newArchive = path.join(root, `new-${suffix}.rispro.zip`);

  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(oldArchive, "old verified backup");
  await fs.writeFile(newArchive, "new verified backup");
  try {
    await pool.query(
      "insert into backup_destination_profiles (destination_id,name,destination_type,config) values ($1::uuid,$2,'local',$3::jsonb),($4::uuid,$5,'local',$3::jsonb)",
      [primaryDestinationId, `Retention primary ${suffix}`, JSON.stringify({ rootPath: root }), secondaryDestinationId, `Retention secondary ${suffix}`]
    );
    await pool.query(
      "insert into backup_jobs (job_id,status,requested_destination_ids,archive_name,completed_at) values ($1::uuid,'completed',array[$2::uuid],$3,now()-interval '8 days'),($4::uuid,'completed',array[$2::uuid],$5,now())",
      [oldJobId, primaryDestinationId, path.basename(oldArchive), newJobId, path.basename(newArchive)]
    );
    await pool.query(
      "insert into backup_artifacts (artifact_id,job_id,archive_name,staging_path,byte_size,sha256,manifest,created_at) values ($1::uuid,$2::uuid,$3,$4,1,'old','{}'::jsonb,now()-interval '8 days'),($5::uuid,$6::uuid,$7,$8,1,'new','{}'::jsonb,now())",
      [oldArtifactId, oldJobId, path.basename(oldArchive), oldArchive, newArtifactId, newJobId, path.basename(newArchive), newArchive]
    );
    await pool.query(
      `insert into backup_destination_copy_attempts (copy_attempt_id,job_id,artifact_id,destination_id,status,remote_path,created_at)
       values ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'verified',$5,now()-interval '8 days'),
              ($6::uuid,$2::uuid,$3::uuid,$7::uuid,'verified',$8,now()-interval '8 days'),
              ($9::uuid,$10::uuid,$11::uuid,$4::uuid,'verified',$12,now())`,
      [oldPrimaryCopyId, oldJobId, oldArtifactId, primaryDestinationId, oldArchive, oldSecondaryCopyId, secondaryDestinationId, path.join(root, `second-${suffix}.rispro.zip`), newPrimaryCopyId, newJobId, newArtifactId, newArchive]
    );

    const result = await executeManualLocalBackupV3Retention({ destinationId: primaryDestinationId, policy: { daily: 0, weekly: 0, monthly: 0 } });
    assert.deepEqual(result, { deleted: 1, retained: 1 });
    await assert.rejects(fs.access(oldArchive));
    await fs.access(newArchive);
    const oldCopy = await pool.query<{ status: string }>("select status from backup_destination_copy_attempts where copy_attempt_id=$1::uuid", [oldPrimaryCopyId]);
    assert.equal(oldCopy.rows[0]?.status, "deleted");
    const action = await pool.query<{ action: string; artifact_id: string }>("select action,artifact_id from backup_retention_actions where destination_id=$1::uuid and artifact_id=$2::uuid order by created_at desc limit 1", [primaryDestinationId, oldArtifactId]);
    assert.equal(action.rows[0]?.action, "delete");
    assert.equal(action.rows[0]?.artifact_id, oldArtifactId);
  } finally {
    await pool.query("delete from backup_retention_actions where destination_id in ($1::uuid,$2::uuid)", [primaryDestinationId, secondaryDestinationId]);
    await pool.query("delete from backup_jobs where job_id in ($1::uuid,$2::uuid)", [oldJobId, newJobId]);
    await pool.query("delete from backup_destination_profiles where destination_id in ($1::uuid,$2::uuid)", [primaryDestinationId, secondaryDestinationId]);
    await fs.rm(root, { recursive: true, force: true });
  }
});
