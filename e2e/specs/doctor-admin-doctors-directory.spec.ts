import { expect, test } from "@playwright/test";
import { signInWithSession } from "../helpers/auth";

test("Doctors Directory keeps creation in an accessible responsive drawer", async ({ page }, testInfo) => {
  await signInWithSession(page, "e2e_supervisor");
  await page.goto("/doctor/doctors-directory");

  await expect(page.getByRole("heading", { name: "Doctors", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Doctor directory" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create doctor" })).toBeVisible();
  await expect(page.getByLabel("Username", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Temporary password", { exact: true })).toHaveCount(0);

  const viewports = [
    { width: 1440, height: 960 },
    { width: 1024, height: 900 },
    { width: 768, height: 900 },
    { width: 390, height: 844 },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.getByRole("button", { name: "Create doctor" }).click();
    const drawer = page.getByRole("dialog", { name: "Create doctor" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByLabel("Username", { exact: true })).toBeVisible();
    await expect(drawer.getByLabel("Temporary password", { exact: true })).toBeVisible();
    await expect(drawer.getByRole("combobox", { name: "Core role" })).toBeVisible();
    await expect(drawer.getByRole("combobox", { name: "Doctor role" })).toBeVisible();
    await expect(drawer.getByRole("checkbox", { name: "Profile active" })).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Cancel" })).toBeInViewport();
    await expect(drawer.getByRole("button", { name: "Create doctor" })).toBeInViewport();

    const drawerBody = drawer.getByTestId("create-doctor-drawer-body");
    expect(await drawerBody.evaluate((element) => getComputedStyle(element).overflowY)).toBe("auto");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    if (viewport.width === 390) {
      const matrixScroller = drawer.locator('[aria-labelledby="create-modality-section-title"] .overflow-x-auto');
      await expect(matrixScroller.locator("table")).toBeVisible();
      expect(await matrixScroller.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
      await drawer.getByRole("heading", { name: "Modality permissions" }).scrollIntoViewIfNeeded();
      await expect(matrixScroller.locator('input[type="checkbox"]').first()).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("doctors-directory-390-modalities.png") });
      const superviseHeader = matrixScroller.getByRole("columnheader", { name: "Supervise" });
      const firstModalityName = matrixScroller.getByRole("row").nth(1).getByRole("rowheader");
      await matrixScroller.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
      await expect(superviseHeader).toBeInViewport();
      await expect(firstModalityName).toBeInViewport();
      await page.screenshot({ path: testInfo.outputPath("doctors-directory-390-modalities-scroll-right.png") });
    }

    await page.screenshot({ path: testInfo.outputPath(`doctors-directory-${viewport.width}.png`) });
    await drawer.getByRole("button", { name: "Cancel" }).click();
    await expect(drawer).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});
