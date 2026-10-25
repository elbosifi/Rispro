import { randomInt, randomUUID } from "node:crypto";
import pg from "pg";
import { expect, test } from "@playwright/test";
import { assertSafeE2eEnvironment } from "../../scripts/e2e-db-safety.mjs";
import { signInWithSession } from "../helpers/auth.js";
import { e2eTodayInTripoli } from "../helpers/fixtures.js";

process.loadEnvFile("e2e/.env");
const target = assertSafeE2eEnvironment();

for (const width of [1440, 390]) {
  test(`reopens a special-quota examination with its original identity at ${width}px`, async ({ page }, testInfo) => {
    const pool = new pg.Pool({ connectionString: target.url });
    try {
      const identity = (await pool.query(
        `select b.policy_version_id, b.modality_id, b.exam_type_id, u.id as user_id
         from appointments_v2.bookings b join modalities m on m.id = b.modality_id
         cross join users u where m.code = 'E2E_CT' and u.username = 'e2e_supervisor' limit 1`
      )).rows[0];
      const nationalId = `990${randomInt(100000000, 1000000000)}`;
      const patient = (await pool.query(
        `insert into patients (arabic_full_name, english_full_name, normalized_arabic_name, national_id, identifier_type, identifier_value, phone_1, sex, age_years)
         values ($1::text, $1::text, $1::text, $2::text, 'national_id', $2::text, '0910000099', 'F', 40) returning id`,
        [`E2E Reactivation ${width}`, nationalId]
      )).rows[0];
      const quota = (await pool.query(
        `insert into appointments_v2.special_quota_rules (logical_key, policy_version_id, modality_id, daily_extra_slots, is_active)
         values ($1, $2, $3, 1, true) returning id, logical_key`,
        [randomUUID(), identity.policy_version_id, identity.modality_id]
      )).rows[0];
      await pool.query("insert into appointments_v2.special_quota_rule_exam_types (quota_rule_id, exam_type_id) values ($1, $2)", [quota.id, identity.exam_type_id]);
      await pool.query("insert into appointments_v2.special_quota_rule_users (quota_rule_id, user_id) values ($1, $2)", [quota.id, identity.user_id]);
      const booking = (await pool.query(
        `insert into appointments_v2.bookings
           (patient_id, modality_id, exam_type_id, booking_date, case_category, status, policy_version_id,
            capacity_resolution_mode, uses_special_quota, special_reason_code, created_by_user_id, updated_by_user_id)
         values ($1, $2, $3, $4, 'non_oncology', 'scheduled', $5, 'special_quota_extra', true, 'urgent_oncology', $6, $6) returning id`,
        [patient.id, identity.modality_id, identity.exam_type_id, e2eTodayInTripoli(), identity.policy_version_id, identity.user_id]
      )).rows[0];
      const consumption = (await pool.query(
        `insert into appointments_v2.special_quota_consumptions
           (booking_id, quota_rule_id, quota_logical_key, policy_version_id, booking_date, exam_type_id, consumed_by_user_id)
         values ($1, $2, $3, $4, $5, $6, $7) returning id, consumed_at, consumed_by_user_id`,
        [booking.id, quota.id, quota.logical_key, identity.policy_version_id, e2eTodayInTripoli(), identity.exam_type_id, identity.user_id]
      )).rows[0];
      await signInWithSession(page, "e2e_supervisor");
      expect((await page.request.post(`http://127.0.0.1:3100/api/v2/read/appointments/${booking.id}/status`, {
        data: { status: "discontinued", reason: "Synthetic scanner interruption" },
      })).ok()).toBeTruthy();
      await page.setViewportSize({ width, height: 960 });
      if (width === 1440) {
        await page.goto(`/modality?modalityId=${identity.modality_id}&date=${e2eTodayInTripoli()}&view=problem`);
        const row = page.getByTestId(`modality-board-row-${booking.id}`);
        await expect(row).toBeVisible();
        await row.getByRole("button", { name: /More actions/i }).click();
      } else {
        await page.goto(`/registrations?appointmentId=${booking.id}&dateMode=all`);
        await expect(page.getByRole("dialog", { name: "Manage" })).toBeVisible();
        await page.getByRole("button", { name: /More actions/i }).click();
      }
      await page.getByRole("menuitem", { name: "Reopen for scanning" }).click();
      await expect(page.getByRole("heading", { name: "Reopen for scanning" })).toBeVisible();
      const submit = page.getByRole("button", { name: "Reopen for scanning", exact: true });
      await expect(submit).toBeDisabled();
      await page.getByLabel("Reason", { exact: true }).fill("Resume the original authorized examination");
      await page.screenshot({ path: testInfo.outputPath(`reactivation-dialog-${width}.png`), fullPage: true });
      const response = page.waitForResponse((response) => response.url().endsWith(`/appointments/${booking.id}/reopen-for-scanning`) && response.request().method() === "POST");
      await submit.click();
      expect((await response).status()).toBe(200);
      await expect(page.getByRole("heading", { name: "Reopen for scanning" })).toHaveCount(0);
      const restored = await pool.query(
        `select id, consumed_at, consumed_by_user_id, released_at from appointments_v2.special_quota_consumptions where booking_id = $1`, [booking.id]
      );
      expect(restored.rows).toEqual([{ ...consumption, released_at: null }]);
      const state = (await pool.query("select status, patient_id, uses_special_quota from appointments_v2.bookings where id = $1", [booking.id])).rows[0];
      expect(state).toEqual({ status: "waiting", patient_id: patient.id, uses_special_quota: true });
      await page.screenshot({ path: testInfo.outputPath(`reactivation-success-${width}.png`), fullPage: true });
    } finally {
      await pool.end();
    }
  });
}
