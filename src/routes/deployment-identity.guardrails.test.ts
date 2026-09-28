import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("deployment identity has a dedicated super-admin re-auth route and cannot use generic settings routes", async () => {
  const source = await readFile("src/routes/settings.ts", "utf8");
  assert.match(source, /settingsRouter\.use\(requireAuth, requireSupervisor, requireRecentSupervisorReauth\);/);
  assert.match(source, /"\/deployment-identity"/);
  assert.match(source, /Only super_admin can view Deployment & Application Identity/);
  assert.match(source, /Only super_admin can update Deployment & Application Identity/);
  assert.match(source, /category === PUBLIC_APP_URL_CATEGORY\) throw new HttpError\(404/);
  assert.match(source, /normalizePublicAppBaseUrl\(body\.publicAppBaseUrl\)/);
});
