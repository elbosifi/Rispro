import assert from "node:assert/strict";
import test from "node:test";
import { TEACHING_PERMISSIONS } from "../domain/teaching-permission.js";
import { resolveLegacyTeachingBootstrapPermissions } from "../services/legacy-teaching-permission-adapter.js";

test("legacy doctors bootstrap only as Teaching learners", () => {
  assert.deepEqual(resolveLegacyTeachingBootstrapPermissions("doctor"), [
    "teaching.access",
    "teaching.learn",
  ]);
});

test("legacy supervisors bootstrap with the Teaching capability vocabulary", () => {
  assert.deepEqual(resolveLegacyTeachingBootstrapPermissions("supervisor"), TEACHING_PERMISSIONS);
  assert.deepEqual(resolveLegacyTeachingBootstrapPermissions("super_admin"), TEACHING_PERMISSIONS);
});

test("unmapped RISpro roles receive no Teaching bootstrap permissions", () => {
  assert.deepEqual(resolveLegacyTeachingBootstrapPermissions("receptionist"), []);
  assert.deepEqual(resolveLegacyTeachingBootstrapPermissions("modality_staff"), []);
});
