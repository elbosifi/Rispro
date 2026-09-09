import assert from "node:assert/strict";
import { test } from "node:test";
import { inspectDoctorImport } from "./doctor-import-export-service.js";

test("doctor import metadata keeps english_name and reset_password optional", async () => {
  const csv = [
    "username,full_name,temporary_password,core_role,user_active,doctor_role,doctor_profile_active,can_finalize_reports,can_assign_protocols,can_supervise,modalities_protocol,modalities_report,modalities_supervise",
    "doctor.one,Arabic Name,TempPass123,doctor,true,consultant,true,true,false,false,CT,CT,",
  ].join("\n");
  const inspected = await inspectDoctorImport({ fileContentBase64: Buffer.from(csv).toString("base64"), format: "csv" });
  assert.equal(inspected.requiredColumns.includes("english_name"), false);
  assert.equal(inspected.requiredColumns.includes("reset_password"), false);
  assert.equal(inspected.missingColumns.includes("english_name"), false);
  assert.equal(inspected.rowCount, 1);
});
