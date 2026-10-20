import { test, expect, type Page } from "@playwright/test";
import pg from "pg";
import { signInWithSession } from "../helpers/auth";
import { assertSafeE2eEnvironment } from "../../scripts/e2e-db-safety.mjs";
import {
  nextRosterRange,
  addRosterDays,
} from "../../frontend/src/pages/doctor/roster/roster-board-utils";

process.loadEnvFile("e2e/.env");
const target = assertSafeE2eEnvironment();
const api = "http://127.0.0.1:3100/api/doctor/roster";
const range = nextRosterRange();
let sourceId: number;
let consultantId: number;
let juniorId: number;
let sourceStart: string;
let sourceSnapshot: unknown;

test.beforeAll(async () => {
  const pool = new pg.Pool({ connectionString: target.url });
  try {
    const manager = (
      await pool.query(
        "select dp.id, dp.user_id from doctor_portal.doctor_profiles dp join users u on u.id = dp.user_id where u.username = 'e2e_supervisor'",
      )
    ).rows[0];
    consultantId = Number(
      (
        await pool.query(
          "select dp.id from doctor_portal.doctor_profiles dp join users u on u.id = dp.user_id where u.username = 'e2e_doctor'",
        )
      ).rows[0].id,
    );
    await pool.query(
      "update doctor_portal.doctor_profiles set doctor_role = 'specialist' where user_id = (select id from users where username = 'e2e_doctor_other')",
    );
    await pool.query(
      "update doctor_portal.doctor_profiles set doctor_role = 'senior_house_officer' where user_id = (select id from users where username = 'e2e_doctor_non_supervisor')",
    );
    const junior = (
      await pool.query(
        "insert into users (username, password_hash, full_name, role, is_active) select 'e2e_roster_junior', password_hash, 'Synthetic Junior SHO', 'doctor', true from users where username = 'e2e_doctor' on conflict (username) do update set full_name = excluded.full_name returning id",
      )
    ).rows[0];
    juniorId = Number(
      (
        await pool.query(
          "insert into doctor_portal.doctor_profiles (user_id, display_name, doctor_role, active) values ($1, 'Dr Synthetic Junior SHO', 'resident', true) on conflict (user_id) do update set active = true returning id",
          [junior.id],
        )
      ).rows[0].id,
    );
    let modality = (
      await pool.query("select id from modalities where code = 'CT' limit 1")
    ).rows[0];
    if (!modality)
      modality = (
        await pool.query(
          "insert into modalities (code, name_en, name_ar, is_active) values ('CT', 'CT', 'الأشعة المقطعية', true) returning id",
        )
      ).rows[0];
    for (const id of [consultantId, juniorId])
      await pool.query(
        "insert into doctor_portal.doctor_modality_permissions (doctor_id, modality_id, can_report, active) values ($1, $2, true, true) on conflict (doctor_id, modality_id) do update set active = true",
        [id, modality.id],
      );
    for (const [code, label] of [
      ["ct_protocol_day", "CT protocol day"],
      ["general_reporting", "General reporting"],
      ["mri_supervision_reporting", "MRI supervision and reporting"],
    ])
      await pool.query(
        "insert into doctor_portal.roster_duty_types (code, label, active, requires_specialist) values ($1, $2, true, true) on conflict (code) do update set active = true",
        [code, label],
      );
    // Historical published fixtures are seeded directly; user actions below use the real UI/API.
    sourceStart = addRosterDays(range.start, -21);
    const source = (
      await pool.query(
        "insert into doctor_portal.doctor_roster_weeks (week_start_date, week_end_date, status, created_by, published_by, published_at) values ($1, $2, 'published', $3, $3, now()) returning id",
        [sourceStart, addRosterDays(sourceStart, 6), manager.user_id],
      )
    ).rows[0];
    sourceId = Number(source.id);
    for (const [offset, name] of [
      [0, "CT"],
      [1, "MRI"],
      [5, "Friday excluded"],
    ] as const) {
      const section = (
        await pool.query(
          "insert into doctor_portal.doctor_roster_assignments (roster_week_id, date, modality_id, duty_type, team_name, session_name, start_time, end_time) values ($1, $2, $3, 'ct_protocol_day', $4, 'AM', '08:00', '14:00') returning id",
          [sourceId, addRosterDays(sourceStart, offset), modality.id, name],
        )
      ).rows[0];
      await pool.query(
        "insert into doctor_portal.doctor_roster_members (roster_assignment_id, doctor_id, team_role) values ($1, $2, 'lead'), ($1, $3, 'observer')",
        [section.id, consultantId, juniorId],
      );
    }
    await pool.query(
      "insert into doctor_portal.doctor_roster_weeks (week_start_date, week_end_date, status, created_by) values ($1, $2, 'draft', $3)",
      [
        addRosterDays(sourceStart, 7),
        addRosterDays(sourceStart, 11),
        manager.user_id,
      ],
    );
  } finally {
    await pool.end();
  }
});

async function noOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    )
    .toBe(true);
}
async function settled(page: Page) {
  await expect(page.getByText("Saving…", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Loading roster…", { exact: true })).toHaveCount(
    0,
  );
}

test("supervisor creates, copies, arranges and publishes a daily roster across desktop/mobile, themes and RTL", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !/status of (409|403)/.test(message.text())
    )
      consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await signInWithSession(page, "e2e_supervisor");
  sourceSnapshot = await (
    await page.request.get(`${api}/weeks?weekStart=${sourceStart}`)
  ).json();
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/doctor/roster-planner");
  await page
    .getByRole("button", { name: "Create Roster", exact: true })
    .click();
  await expect(page.getByLabel("Start date", { exact: true })).toHaveValue(
    range.start,
  );
  await expect(page.getByLabel("End date", { exact: true })).toHaveValue(
    range.end,
  );
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelector("main")?.scrollTo(0, 0);
  });
  await page.screenshot({
    path: testInfo.outputPath("01-create-roster-1440-light.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Choose a saved roster", { exact: true }).check();
  await expect(page.getByLabel("Source roster", { exact: true })).toHaveValue(
    String(sourceId),
  );
  await expect(page.getByText("2 sections to copy · 1 excluded")).toBeVisible();
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelector("main")?.scrollTo(0, 0);
  });
  await page.screenshot({
    path: testInfo.outputPath("02-source-selection.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByLabel("Start blank", { exact: true }).check();
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "+ Add Roster", exact: true }),
  ).toHaveCount(5);
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelector("main")?.scrollTo(0, 0);
  });
  await page.screenshot({
    path: testInfo.outputPath("03-empty-board.png"),
    fullPage: true,
    animations: "disabled",
  });
  const board = page.getByTestId("doctor-roster-board");
  const sunday = board.getByRole("region", {
    name: `Sunday ${range.start}`,
    exact: true,
  });
  await sunday
    .getByRole("button", { name: "+ Add Roster", exact: true })
    .click();
  await sunday.getByRole("button", { name: "CT", exact: true }).click();
  const section = sunday.getByRole("article", { name: "CT", exact: true });
  await expect(section).toBeVisible();
  const doctor = board.getByRole("button", { name: "Dr E2E", exact: true });
  await doctor.scrollIntoViewIfNeeded();
  const from = (await doctor.boundingBox())!;
  const to = (await section.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    from.x + from.width / 2 + 10,
    from.y + from.height / 2,
    { steps: 3 },
  );
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 15,
  });
  await page.screenshot({
    path: testInfo.outputPath("04-doctor-drag.png"),
    fullPage: false,
    animations: "disabled",
  });
  const drop = (await section.boundingBox())!;
  await page.mouse.move(drop.x + drop.width / 2, drop.y + drop.height / 2, {
    steps: 5,
  });
  await page.mouse.up();
  await expect(section.getByText("Dr E2E", { exact: true })).toBeVisible();
  await expect(section.getByLabel("Responsibility for Dr E2E")).toHaveValue(
    "lead",
  );
  await section
    .getByRole("button", { name: "+ Add doctor", exact: true })
    .click();
  const picker = page.getByRole("dialog");
  await picker
    .getByRole("button", { name: "Dr Synthetic Junior SHO", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    section.getByLabel("Responsibility for Dr Synthetic Junior SHO"),
  ).toHaveValue("sho");
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelector("main")?.scrollTo(0, 0);
  });
  await page.screenshot({
    path: testInfo.outputPath("05-populated-board-1440-light.png"),
    fullPage: true,
    animations: "disabled",
  });
  // Same-day overlap stays visible and blocks the real publish endpoint.
  await sunday
    .getByRole("button", { name: "+ Add Roster", exact: true })
    .click();
  await sunday.getByRole("button", { name: "Reporting", exact: true }).click();
  const reporting = sunday.getByRole("article", {
    name: "Reporting",
    exact: true,
  });
  await reporting
    .getByRole("button", { name: "+ Add doctor", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Dr E2E", exact: true })
    .click();
  await expect(reporting.getByText(/overlapping sections/)).toBeVisible();
  await page
    .getByRole("button", { name: "Publish roster", exact: true })
    .click();
  await expect(board.getByRole("alert")).toBeVisible();
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelector("main")?.scrollTo(0, 0);
  });
  await page.screenshot({
    path: testInfo.outputPath("06-conflict-state.png"),
    fullPage: true,
    animations: "disabled",
  });
  await reporting
    .getByRole("button", { name: "Remove doctor", exact: true })
    .click();
  await settled(page);
  await reporting.locator("summary").click();
  await reporting
    .getByRole("button", { name: "Remove section", exact: true })
    .click();
  await expect(reporting).toHaveCount(0);
  // Cross-day copy and move use explicit choices and preserve responsibility.
  const mondayDate = addRosterDays(range.start, 1);
  const monday = board.getByRole("region", {
    name: `Monday ${mondayDate}`,
    exact: true,
  });
  await monday
    .getByRole("button", { name: "+ Add Roster", exact: true })
    .click();
  await monday.getByRole("button", { name: "Reporting", exact: true }).click();
  await section
    .getByRole("button", { name: "Move / copy", exact: true })
    .first()
    .click();
  const transfer = page.getByRole("dialog");
  await transfer.getByLabel("Destination section").selectOption({
    label: (
      await transfer
        .getByLabel("Destination section")
        .locator("option")
        .allTextContents()
    ).find((value) => value.includes("Monday"))!,
  });
  await transfer
    .getByRole("button", { name: "Copy doctor", exact: true })
    .click();
  await expect(transfer).toHaveCount(0);
  await expect(
    monday.getByRole("article").getByText("Dr E2E", { exact: true }),
  ).toBeVisible();
  const assignedJunior = section.getByRole("button", {
    name: "Dr Synthetic Junior SHO",
    exact: true,
  });
  await assignedJunior.scrollIntoViewIfNeeded();
  const juniorFrom = (await assignedJunior.boundingBox())!;
  const mondayTarget = (await monday.getByRole("article").boundingBox())!;
  await page.mouse.move(
    juniorFrom.x + juniorFrom.width / 2,
    juniorFrom.y + juniorFrom.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    juniorFrom.x + juniorFrom.width / 2 + 10,
    juniorFrom.y + juniorFrom.height / 2,
    { steps: 3 },
  );
  await page.mouse.move(
    mondayTarget.x + mondayTarget.width / 2,
    mondayTarget.y + mondayTarget.height / 2,
    { steps: 15 },
  );
  await page.mouse.up();
  const moveDialog = page.getByRole("dialog");
  await expect(moveDialog.getByLabel("Destination section")).not.toHaveValue(
    "",
  );
  // Let the pointer reach the newly opened dialog after dnd-kit's trailing-click suppression.
  await moveDialog.getByRole("button", { name: "Move doctor", exact: true }).hover();
  await moveDialog
    .getByRole("button", { name: "Move doctor", exact: true })
    .click();
  await expect(moveDialog).toHaveCount(0);
  await expect(
    section.getByText("Dr Synthetic Junior SHO", { exact: true }),
  ).toHaveCount(0);
  await expect(
    monday.getByLabel("Responsibility for Dr Synthetic Junior SHO"),
  ).toHaveValue("sho");
  await settled(page);
  for (const width of [1440, 1280, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 960 });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await noOverflow(page);
      await page.evaluate(() => {
        window.scrollTo(0, 0);
        document.querySelector("main")?.scrollTo(0, 0);
      });
      await page.screenshot({
        path: testInfo.outputPath(`07-board-${width}-${colorScheme}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
  }
  await page
    .getByLabel("Selected day", { exact: true })
    .selectOption(mondayDate);
  await expect(
    monday.getByRole("article").getByText("Dr E2E", { exact: true }),
  ).toBeVisible();
  await monday
    .getByRole("button", { name: "+ Add doctor", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Search doctors", { exact: true })
    .fill("Other");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Dr E2E Other", exact: true })
    .click();
  await board.getByRole("button", { name: "العربية", exact: true }).click();
  await expect(board).toHaveAttribute("dir", "rtl");
  await expect(
    board.getByRole("button", { name: "نشر الجدول", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelector("main")?.scrollTo(0, 0);
  });
  await page.screenshot({
    path: testInfo.outputPath("08-mobile-rtl-dark.png"),
    fullPage: true,
    animations: "disabled",
  });
  await noOverflow(page);
  await board.getByRole("button", { name: "English", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.emulateMedia({ colorScheme: "light" });
  await page
    .getByRole("button", { name: "Publish roster", exact: true })
    .click();
  await expect(
    board.getByText("Read-only roster", { exact: true }),
  ).toBeVisible();
  await expect(
    board.getByRole("button", { name: "+ Add Roster", exact: true }),
  ).toHaveCount(0);
  await expect(
    board.getByRole("button", { name: "+ Add doctor", exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelector("main")?.scrollTo(0, 0);
  });
  await page.screenshot({
    path: testInfo.outputPath("09-published-read-only.png"),
    fullPage: true,
    animations: "disabled",
  });
  // Create an independent copied draft, then change it and verify the source is untouched.
  await page
    .getByRole("button", { name: "Create Roster", exact: true })
    .click();
  const copyStart = addRosterDays(range.start, 14);
  await page.getByLabel("Start date", { exact: true }).fill(copyStart);
  await page
    .getByLabel("End date", { exact: true })
    .fill(addRosterDays(copyStart, 4));
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Choose a saved roster", { exact: true }).check();
  await page
    .getByLabel("Source roster", { exact: true })
    .selectOption(String(sourceId));
  await expect(page.getByText("2 sections to copy · 1 excluded")).toBeVisible();
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    board
      .getByRole("article", { name: "CT", exact: true })
      .getByText("Dr E2E", { exact: true }),
  ).toBeVisible();
  const copiedCt = board.getByRole("article", { name: "CT", exact: true });
  await copiedCt.locator("summary").click();
  await copiedCt.getByRole("button", { name: "Remove section", exact: true }).click();
  await expect(page.getByRole("dialog").getByText("Remove CT and its 2 assigned doctors?")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(copiedCt.getByText("Dr E2E", { exact: true })).toBeVisible();
  await copiedCt.getByRole("button", { name: "Section settings", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Section name", { exact: true }).fill("CT follow-up");
  await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await board
    .getByRole("article", { name: "CT follow-up", exact: true })
    .getByRole("button", { name: "Remove doctor", exact: true })
    .first()
    .click();
  await settled(page);
  expect(
    await (
      await page.request.get(`${api}/weeks?weekStart=${sourceStart}`)
    ).json(),
  ).toEqual(sourceSnapshot);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("touch and keyboard alternatives work on a phone, and unauthorized users cannot write", async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:5173",
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    timezoneId: "Africa/Tripoli",
  });
  const page = await context.newPage();
  try {
    await signInWithSession(page, "e2e_supervisor");
    await page.goto("/doctor/roster-planner");
    await page
      .getByRole("button", { name: "Create Roster", exact: true })
      .tap();
    const start = addRosterDays(range.start, 28);
    await page.getByLabel("Start date", { exact: true }).fill(start);
    await page
      .getByLabel("End date", { exact: true })
      .fill(addRosterDays(start, 4));
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      document.querySelector("main")?.scrollTo(0, 0);
    });
    await page.screenshot({
      path: testInfo.outputPath("10-mobile-create.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.getByRole("button", { name: "Continue", exact: true }).tap();
    await page.getByLabel("Start blank", { exact: true }).tap();
    await page.getByRole("button", { name: "Create draft", exact: true }).tap();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const board = page.getByTestId("doctor-roster-board");
    await board
      .getByRole("button", { name: "+ Add Roster", exact: true })
      .tap();
    await board.getByRole("button", { name: "Reporting", exact: true }).tap();
    const section = board.getByRole("article", {
      name: "Reporting",
      exact: true,
    });
    await section
      .getByRole("button", { name: "+ Add doctor", exact: true })
      .tap();
    await page
      .getByRole("dialog")
      .getByLabel("Search doctors", { exact: true })
      .fill("Dr E2E");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Dr E2E", exact: true })
      .tap();
    await expect(section.getByLabel("Responsibility for Dr E2E")).toHaveValue(
      "lead",
    );
    await settled(page);
    await section
      .getByRole("button", { name: "Remove doctor", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(section.getByText("Dr E2E", { exact: true })).toHaveCount(0);
    await settled(page);
    await section
      .getByRole("button", { name: "+ Add doctor", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Dr E2E", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(section.getByText("Dr E2E", { exact: true })).toBeVisible();
    await settled(page);
    await noOverflow(page);
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      document.querySelector("main")?.scrollTo(0, 0);
    });
    await page.screenshot({
      path: testInfo.outputPath("11-mobile-touch-keyboard.png"),
      fullPage: true,
      animations: "disabled",
    });
  } finally {
    await context.close();
  }
  const denied = await browser.newContext({ baseURL: "http://127.0.0.1:5173" });
  try {
    const unauthorized = await denied.newPage();
    await signInWithSession(unauthorized, "e2e_doctor_non_supervisor");
    expect((await unauthorized.request.get(`${api}/saved`)).status()).toBe(403);
    expect(
      (
        await unauthorized.request.post(`${api}/weeks`, {
          data: {
            weekStartDate: addRosterDays(range.start, 42),
            weekEndDate: addRosterDays(range.start, 46),
          },
        })
      ).status(),
    ).toBe(403);
    await unauthorized.goto("/doctor/roster-planner");
    await expect(
      unauthorized.getByRole("button", { name: "Create Roster", exact: true }),
    ).toHaveCount(0);
  } finally {
    await denied.close();
  }
});

test.afterAll(async () => {
  const pool = new pg.Pool({ connectionString: target.url });
  try {
    await pool.query(
      "delete from doctor_portal.doctor_roster_weeks where week_start_date = any($1::date[])",
      [
        [
          sourceStart,
          addRosterDays(sourceStart, 7),
          range.start,
          addRosterDays(range.start, 14),
          addRosterDays(range.start, 28),
        ],
      ],
    );
    await pool.query(
      "update doctor_portal.doctor_profiles set doctor_role = 'consultant' where user_id in (select id from users where username in ('e2e_doctor_other', 'e2e_doctor_non_supervisor'))",
    );
    await pool.query(
      "delete from doctor_portal.doctor_profiles where user_id = (select id from users where username = 'e2e_roster_junior')",
    );
    await pool.query("delete from users where username = 'e2e_roster_junior'");
  } finally {
    await pool.end();
  }
});
