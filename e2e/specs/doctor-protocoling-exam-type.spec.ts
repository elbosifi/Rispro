import { expect, test } from "@playwright/test";
import { signInWithSession } from "../helpers/auth";

test("a protocol-authorized doctor changes a same-modality examination without re-authentication", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const screenshot = (name: string) => page.screenshot({ path: testInfo.outputPath(name), fullPage: true });

  await signInWithSession(page, "e2e_doctor");
  await page.goto("/doctor/protocols");
  await expect(page.getByRole("heading", { name: "Protocoling Worklist" })).toBeVisible();
  await page.getByRole("button", { name: "Tomorrow" }).click();
  await page.getByLabel("Search protocoling appointments").fill("E2E Protocoling Exam Patient");
  const row = page.getByRole("row", { name: /E2E Protocoling Exam Patient/ });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Assign" }).click();
  const workspace = page.getByRole("dialog", { name: /assign protocol/i });
  await expect(workspace).toBeVisible();
  await workspace.getByRole("radio", { name: "Free-text protocol" }).click();
  await workspace.getByLabel("Free-text protocol").fill("Preserve this entered clinical protocol content during examination change.");
  await expect(workspace.getByRole("button", { name: "Edit examination type" })).toBeVisible();
  await screenshot("doctor-protocoling-exam-before.png");

  await workspace.getByRole("button", { name: "Edit examination type" }).click();
  const editor = page.getByRole("dialog", { name: "Edit examination type" });
  const examinationSelect = editor.getByLabel("Examination type", { exact: true });
  await expect(examinationSelect.locator("option")).toContainText(["E2E CT Chest", "E2E CT Head"]);
  const update = page.waitForRequest((request) => request.method() === "PATCH" && /\/api\/doctor\/protocoling\/appointments\/\d+\/exam-type$/.test(new URL(request.url()).pathname));
  await examinationSelect.selectOption({ label: "E2E CT Chest" });
  await editor.getByRole("button", { name: "Update exam" }).click();
  await update;
  await expect(workspace.getByText("E2E CT Chest", { exact: true })).toBeVisible();
  await expect(workspace.getByLabel("Free-text protocol")).toHaveValue("Preserve this entered clinical protocol content during examination change.");
  await expect(page.locator('input[autocomplete="current-password"]')).toHaveCount(0);
  await expect(page.getByText(/supervisor/i)).toHaveCount(0);
  await screenshot("doctor-protocoling-exam-after.png");
});
