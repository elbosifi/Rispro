import { expect, test, type Page } from "@playwright/test";
import { E2E_PASSWORD, signInWithSession } from "../helpers/auth";

async function reauthenticate(page: Page) {
  const response = await page.request.post("http://127.0.0.1:3100/api/auth/re-auth", {
    data: { password: E2E_PASSWORD },
  });
  expect(response.ok()).toBeTruthy();
}

async function setProtocolGate(page: Page, value: "enabled" | "disabled") {
  const response = await page.request.put("http://127.0.0.1:3100/api/settings/mwl_policy", {
    data: {
      entries: [{ key: "require_protocol_before_mwl_for_protocoling_modalities", value: { value } }],
    },
  });
  expect(response.ok()).toBeTruthy();
}

test("super admin can manage the protocol MWL gate in English and Arabic", async ({ page }) => {
  await signInWithSession(page, "e2e_super_admin");
  await reauthenticate(page);
  await setProtocolGate(page, "disabled");
  await page.goto("/settings?section=mwl_policy");

  const policySwitch = page.getByRole("checkbox", { name: "Require protocol before modality worklist" });
  await expect(page.getByRole("heading", { name: "Modality Worklist Policy" })).toBeVisible();
  await expect(policySwitch).not.toBeChecked();

  await page.getByText("Require protocol before modality worklist", { exact: true }).click();
  await expect(policySwitch).toBeChecked();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Modality worklist policy saved" })).toContainText("Modality worklist policy saved");
  await page.reload();
  await expect(policySwitch).toBeChecked();

  await page.getByRole("button", { name: "Switch language to Arabic" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: "سياسة قائمة عمل الأجهزة" })).toBeVisible();
  const arabicSwitch = page.getByRole("checkbox", { name: "اشتراط البروتوكول قبل قائمة عمل الأجهزة" });
  await expect(arabicSwitch).toBeChecked();

  await page.getByText("اشتراط البروتوكول قبل قائمة عمل الأجهزة", { exact: true }).click();
  await expect(arabicSwitch).not.toBeChecked();
  await page.getByRole("button", { name: "حفظ" }).click();
  await expect(page.getByRole("status").filter({ hasText: "تم حفظ سياسة قائمة عمل الأجهزة" })).toContainText("تم حفظ سياسة قائمة عمل الأجهزة");
});

test("worklist monitor exposes the waiting-for-protocol status", async ({ page }) => {
  await signInWithSession(page, "e2e_super_admin");
  await reauthenticate(page);
  await page.goto("/worklist-monitor");

  await expect(page.getByRole("option", { name: "Waiting for protocol" })).toBeAttached();

  await page.getByRole("button", { name: "Switch language to Arabic" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("option", { name: "في انتظار البروتوكول" })).toBeAttached();
});
