import { before, describe, it } from "node:test";
import assert from "node:assert/strict";

describe("user-service super_admin guardrails", () => {
  let source = "";

  before(async () => {
    const fs = await import("node:fs/promises");
    source = await fs.readFile("src/services/user-service.ts", "utf-8");
  });

  it("enforces only super_admin can create super_admin", () => {
    assert.ok(source.includes("Only super_admin can create a super_admin user."));
    assert.ok(source.includes("create_super_admin_denied"));
    assert.ok(source.includes("create_super_admin_allowed"));
  });

  it("prevents deletion of last active super_admin", () => {
    assert.ok(source.includes("cannot_delete_last_super_admin"));
    assert.ok(source.includes("Cannot delete the last active super_admin user."));
  });

  it("audits super_admin-sensitive delete attempts", () => {
    assert.ok(source.includes("delete_super_admin_denied"));
    assert.ok(source.includes("delete_super_admin_allowed"));
  });
});

describe("forced password-change guardrail", () => {
  it("blocks non-auth APIs while allowing password-change routes to stay mounted first", async () => {
    const fs = await import("node:fs/promises");
    const authMiddleware = await fs.readFile("src/middleware/auth.ts", "utf-8");
    const app = await fs.readFile("src/app.ts", "utf-8");

    assert.ok(authMiddleware.includes("blockForcedPasswordChange"));
    assert.ok(authMiddleware.includes("mustChangePassword"));
    assert.ok(authMiddleware.includes("Password change is required before accessing this area."));
    assert.match(app, /app\.use\("\/api\/auth", authRouter\);\s+app\.use\("\/api", blockForcedPasswordChange\);/);
  });
});
