import { expect, test } from "@playwright/test";
import { signInWithSession } from "../helpers/auth.js";

test("protocol library prioritizes clinical finding and safe secondary actions", async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  const screenshot = (name: string) => page.screenshot({ path: testInfo.outputPath(name) });
  const viewportHasNoPageOverflow = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();

  await signInWithSession(page, "e2e_super_admin");
  await page.goto("/doctor/protocols");
  await expect(page).not.toHaveURL(/login/);
  const outerLibraryTab = page.getByRole("button", { name: "Protocol Library", exact: true });
  if (await outerLibraryTab.count()) await outerLibraryTab.click();

  await expect(page.getByRole("heading", { name: "Protocols", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "New protocol", exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Contrast", exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Status", exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Active version", exact: true })).toHaveCount(0);
  await expect(page.getByText("ACTIVE · v1.0", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("DRAFT CHANGES PENDING", { exact: true })).toBeVisible();
  await expect(page.getByText("Needs activation", { exact: true })).toBeVisible();
  await expect(page.getByText("Import protocols XLSX", { exact: true })).toHaveCount(0);
  await screenshot("protocol-library-desktop.png");

  const newProtocol = page.getByRole("button", { name: "New protocol", exact: true });
  await newProtocol.click();
  const newProtocolDialog = page.getByRole("dialog", { name: "New protocol" });
  await expect(newProtocolDialog).toBeVisible();
  await expect(newProtocolDialog.getByRole("button", { name: /CT protocol/ })).toBeVisible();
  await expect(newProtocolDialog.getByRole("button", { name: /MRI protocol/ })).toBeVisible();
  await screenshot("protocol-library-new-protocol.png");
  await newProtocolDialog.getByRole("button", { name: /CT protocol/ }).focus();
  await expect(newProtocolDialog.getByRole("button", { name: /CT protocol/ })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(newProtocolDialog).toHaveCount(0);
  await expect(newProtocol).toBeFocused();

  await newProtocol.click();
  await page.getByRole("dialog", { name: "New protocol" }).getByRole("button", { name: /CT protocol/ }).click();
  await expect(page.getByRole("textbox", { name: "Protocol name" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await newProtocol.click();
  await page.getByRole("dialog", { name: "New protocol" }).getByRole("button", { name: /MRI protocol/ }).click();
  await expect(page.getByRole("combobox", { name: "Anatomy region" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Library setup", exact: true }).click();
  await page.getByRole("button", { name: "Import / Export", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Protocol import / export" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download XLSX template" })).toBeVisible();
  await expect(page.getByText("Import protocols XLSX", { exact: true })).toBeVisible();
  await screenshot("protocol-library-import-export.png");

  await page.getByRole("button", { name: "Protocols", exact: true }).click();
  const acuteRow = page.getByRole("row", { name: /CT Brain - Acute/ });
  const moreActions = acuteRow.getByRole("button", { name: "More actions for CT Brain - Acute" });
  await moreActions.click();
  await expect(moreActions).toHaveAttribute("aria-expanded", "true");
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Duplicate" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Deactivate protocol" })).toBeVisible();
  const menuBounds = await menu.boundingBox();
  expect(menuBounds).not.toBeNull();
  expect(menuBounds!.x).toBeGreaterThanOrEqual(0);
  expect(menuBounds!.y).toBeGreaterThanOrEqual(0);
  expect(menuBounds!.x + menuBounds!.width).toBeLessThanOrEqual(1440);
  expect(menuBounds!.y + menuBounds!.height).toBeLessThanOrEqual(960);
  await screenshot("protocol-library-actions-menu.png");
  await menu.getByRole("menuitem", { name: "Deactivate protocol" }).click();
  await expect(page.getByRole("heading", { name: "Deactivate protocol?" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

  await acuteRow.getByRole("button", { name: "Open CT Brain - Acute" }).click();
  await expect(page.getByTestId("protocol-builder")).toBeVisible();
  await expect(page.getByRole("button", { name: "← Back to protocols" })).toBeVisible();
  await page.getByRole("button", { name: "← Back to protocols" }).click();
  await expect(page.getByRole("columnheader", { name: "Protocol", exact: true })).toBeVisible();

  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.getByRole("heading", { name: "Protocols", exact: true })).toBeVisible();
  await viewportHasNoPageOverflow();
  await screenshot("protocol-library-1024.png");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Protocols", exact: true })).toBeVisible();
  await viewportHasNoPageOverflow();
  await screenshot("protocol-library-mobile.png");
  await page.getByRole("button", { name: "New protocol", exact: true }).click();
  const mobileDialog = page.getByRole("dialog", { name: "New protocol" });
  await expect(mobileDialog).toBeVisible();
  const mobileDialogBounds = await mobileDialog.boundingBox();
  expect(mobileDialogBounds).not.toBeNull();
  expect(mobileDialogBounds!.x).toBeGreaterThanOrEqual(0);
  expect(mobileDialogBounds!.x + mobileDialogBounds!.width).toBeLessThanOrEqual(390);
  expect(mobileDialogBounds!.y).toBeGreaterThanOrEqual(0);
  expect(mobileDialogBounds!.y + mobileDialogBounds!.height).toBeLessThanOrEqual(844);
  await screenshot("protocol-library-mobile-new-protocol.png");
  await page.keyboard.press("Escape");
  await expect(mobileDialog).toHaveCount(0);

  expect(pageErrors, `Unexpected page errors: ${pageErrors.join(" | ")}`).toEqual([]);
  expect(consoleErrors, `Unexpected console errors: ${consoleErrors.join(" | ")}`).toEqual([]);
});
