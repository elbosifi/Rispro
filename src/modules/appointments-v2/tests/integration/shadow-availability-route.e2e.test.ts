/**
 * Appointments V2 — Shadow availability route E2E test.
 *
 * Verifies real GET /api/v2/scheduling/availability request path:
 * - shadow mode is exercised
 * - response remains pass-through/non-user-visible
 * - policySetKey is honored through availability + shadow path
 * - structured shadow_summary logs are emitted
 *
 * This test runs the route assertion in a dedicated child process so the
 * shadow flag cache is deterministic and isolated.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  isDatabaseAvailable,
  canReachDatabase,
  setupTestDatabase,
  seedTestData,
  createTestApp,
  createTestAuthCookie,
  fetchJson,
} from "./helpers.js";

const TEST_PREFIX = "SHADOW_ROUTE_E2E_";
const CHILD_ARG = "--run-shadow-child";
const thisFile = fileURLToPath(import.meta.url);

type ShadowSummaryLog = {
  type: "shadow_summary";
  total: number;
  matches: number;
  mismatches: number;
  v2Stricter: number;
  v2Looser: number;
  mismatchRate: number;
};

function hasShadowOnlyKeys(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => hasShadowOnlyKeys(item));
  }
  if (!value || typeof value !== "object") {
    return false;
  }

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (
      lower === "shadow" ||
      lower === "shadowdiff" ||
      lower === "shadowsummary" ||
      lower === "shadow_diff" ||
      lower === "shadow_summary"
    ) {
      return true;
    }
    if (hasShadowOnlyKeys(nested)) {
      return true;
    }
  }

  return false;
}

async function runChildAssertions(): Promise<void> {
  const previousEnvShadow = process.env.APPOINTMENTS_V2_SHADOW_MODE_ENABLED;
  process.env.APPOINTMENTS_V2_SHADOW_MODE_ENABLED = "true";

  const { pool } = await import("../../../../db/pool.js");
  let previousSettingValue: unknown = null;
  let hadPreviousSetting = false;

  let testDb: Awaited<ReturnType<typeof setupTestDatabase>> | null = null;
  let app: Awaited<ReturnType<typeof createTestApp>> | null = null;

  try {
    testDb = await setupTestDatabase(TEST_PREFIX);
    const testData = await seedTestData(testDb.schemaName, TEST_PREFIX);

    app = await createTestApp();
    const authCookie = createTestAuthCookie(testData.userId, "supervisor");

    const existingSetting = await pool.query<{ settingValue: unknown }>(
      `
        select setting_value as "settingValue"
        from system_settings
        where category = 'scheduling_and_capacity'
          and setting_key = 'appointments_v2_shadow_mode_enabled'
        limit 1
      `
    );
    if (existingSetting.rows.length > 0) {
      hadPreviousSetting = true;
      previousSettingValue = existingSetting.rows[0].settingValue;
    }

    await pool.query(
      `
        insert into system_settings (category, setting_key, setting_value, updated_by_user_id)
        values ('scheduling_and_capacity', 'appointments_v2_shadow_mode_enabled', '{"value":"true"}'::jsonb, $1)
        on conflict (category, setting_key) do update set
          setting_value = excluded.setting_value,
          updated_by_user_id = excluded.updated_by_user_id,
          updated_at = now()
      `,
      [testData.userId]
    );

    const updateLimit = await pool.query(
      `
        update appointments_v2.category_daily_limits
        set daily_limit = 0, is_active = true
        where policy_version_id = $1
          and modality_id = $2
          and case_category = 'non_oncology'
      `,
      [testData.policyVersionId, testData.modalityId]
    );
    if ((updateLimit.rowCount ?? 0) === 0) {
      await pool.query(
        `
          insert into appointments_v2.category_daily_limits
            (policy_version_id, modality_id, case_category, daily_limit, is_active)
          values ($1, $2, 'non_oncology', 0, true)
        `,
        [testData.policyVersionId, testData.modalityId]
      );
    }

    const capturedLogs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      capturedLogs.push(
        args
          .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
          .join(" ")
      );
    };

    let response: { status: number; data: unknown };
    try {
      response = await fetchJson(app.baseUrl, `/api/v2/scheduling/availability?modalityId=${testData.modalityId}&days=3&offset=0&caseCategory=non_oncology&includeOverrideCandidates=true&policySetKey=${encodeURIComponent(testData.policySetKey)}`, {
        cookie: authCookie,
      });
    } finally {
      console.log = originalLog;
    }

    assert.equal(response.status, 200);
    const payload = response.data as Record<string, unknown>;
    const items = payload.items as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(items), "Availability response should include items array");
    assert.ok(items.length > 0, "Availability response should include days");

    // Shadow mode must remain pass-through and non-user-visible.
    assert.equal(hasShadowOnlyKeys(payload), false, "HTTP response must not contain shadow-only fields");
    assert.equal(JSON.stringify(payload).includes("\"type\":\"shadow_"), false, "HTTP response must not include log artifacts");

    const firstDecision = items[0].decision as Record<string, unknown>;
    const policyRef = firstDecision.policyVersionRef as Record<string, unknown>;
    assert.equal(Number(policyRef.versionId), testData.policyVersionId, "Availability must use requested policySetKey");
    assert.equal(String(policyRef.policySetKey), testData.policySetKey, "Availability policySetKey must match query");

    const parsedLogs = capturedLogs
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is Record<string, unknown> => entry !== null);

    const shadowDiffLogs = parsedLogs.filter((e) => e.type === "shadow_diff");
    const shadowSummaryLogs = parsedLogs.filter((e) => e.type === "shadow_summary");

    assert.equal(shadowSummaryLogs.length, 1, "Expected exactly one shadow_summary log from route path");

    const summary = shadowSummaryLogs[0] as ShadowSummaryLog;
    assert.ok(summary.total > 0, "Shadow summary should include evaluated availability days");
    assert.equal(summary.matches + summary.mismatches, summary.total, "Shadow summary counts should add up to total");
    assert.equal(
      summary.v2Stricter + summary.v2Looser,
      summary.mismatches,
      "Shadow summary mismatch breakdown should add up"
    );
    assert.equal(
      summary.mismatchRate,
      summary.total > 0 ? summary.mismatches / summary.total : 0,
      "Shadow summary mismatch rate should match counts"
    );

    console.log(`SHADOW_ROUTE_E2E_RESULT=${JSON.stringify({
      ok: true,
      diffCount: shadowDiffLogs.length,
      summaryCount: shadowSummaryLogs.length,
      summary,
    })}`);
  } finally {
    // Restore DB setting state so child-run enablement does not leak to later suites.
    if (hadPreviousSetting) {
      await pool.query(
        `
          update system_settings
          set setting_value = $1::jsonb,
              updated_at = now()
          where category = 'scheduling_and_capacity'
            and setting_key = 'appointments_v2_shadow_mode_enabled'
        `,
        [JSON.stringify(previousSettingValue)]
      );
    } else {
      await pool.query(
        `
          delete from system_settings
          where category = 'scheduling_and_capacity'
            and setting_key = 'appointments_v2_shadow_mode_enabled'
        `
      );
    }

    if (app) {
      await app.close();
    }
    if (testDb) {
      await testDb.cleanup();
    }

    if (previousEnvShadow === undefined) {
      delete process.env.APPOINTMENTS_V2_SHADOW_MODE_ENABLED;
    } else {
      process.env.APPOINTMENTS_V2_SHADOW_MODE_ENABLED = previousEnvShadow;
    }
  }
}

if (process.argv.includes(CHILD_ARG)) {
  runChildAssertions()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

if (!process.argv.includes(CHILD_ARG)) {
  const skipEnv = !isDatabaseAvailable() ? "DATABASE_URL not set" : undefined;

  describe("Shadow availability route — E2E", { skip: skipEnv }, () => {
    it("exercises real route-path shadow logging with pass-through response", async (t) => {
      if (!await canReachDatabase()) {
        t.skip("Database is not reachable in this environment");
        return;
      }

      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];

      const child = spawn(process.execPath, ["--import", "tsx", thisFile, CHILD_ARG], {
        cwd: process.cwd(),
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      });

      child.stdout.on("data", (chunk: Buffer | string) => {
        stdoutChunks.push(chunk.toString());
      });
      child.stderr.on("data", (chunk: Buffer | string) => {
        stderrChunks.push(chunk.toString());
      });

      const exitCode = await new Promise<number>((resolve) => {
        child.on("exit", (code) => resolve(code ?? 1));
      });

      const stdout = stdoutChunks.join("");
      const stderr = stderrChunks.join("");
      assert.equal(exitCode, 0, `Child run failed.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);

      const resultLine = stdout
        .split("\n")
        .find((line) => line.startsWith("SHADOW_ROUTE_E2E_RESULT="));
      assert.ok(resultLine, `Missing child result marker.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);

      const result = JSON.parse(resultLine.replace("SHADOW_ROUTE_E2E_RESULT=", "")) as {
        ok: boolean;
        diffCount: number;
        summaryCount: number;
        summary: ShadowSummaryLog;
      };
      assert.equal(result.ok, true);
      assert.ok(result.diffCount >= 0);
      assert.equal(result.summaryCount, 1);
      assert.ok(result.summary.total > 0);
      assert.equal(result.summary.matches + result.summary.mismatches, result.summary.total);
      assert.equal(result.summary.v2Stricter + result.summary.v2Looser, result.summary.mismatches);
    });
  });
}
