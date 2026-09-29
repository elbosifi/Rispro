import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import { signInWithSession } from "../helpers/auth.js";

test("management edits, downloads, and resets the visual bilingual SOP JSON example", async ({ page }) => {
  test.setTimeout(180_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await signInWithSession(page, "e2e_supervisor");
  await page.goto("/sops");
  await expect(page.getByRole("button", { name: "Edit JSON Example", exact: true })).toBeVisible();

  try {
    await page.getByRole("button", { name: "Edit JSON Example", exact: true }).click();
    await expect(page.getByRole("heading", { name: "RISpro SOP JSON Example" })).toBeVisible();
    await expect(page.getByText("JSON Example Template — configuration only, not a real SOP.")).toBeVisible();
    await expect(page.getByText(/SOP content may be Arabic, English, or bilingual/)).toBeVisible();
    await expect(page.getByTestId("sop-structured-editor").getByText("Purpose", { exact: true })).toBeVisible();
    await expect(page.getByTestId("sop-structured-editor").getByText("Procedure", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Publish SOP", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Archive SOP", exact: true })).toHaveCount(0);

    const customTitle = `MRI SOP JSON Example ${Date.now()}`;
    await page.getByLabel("Example Title").fill(customTitle);
    await expect(page.getByRole("button", { name: "Download Example", exact: true })).toBeDisabled();
    const saveResponse = page.waitForResponse((response) => response.url().endsWith("/api/sops/import/json/example/config") && response.request().method() === "PUT");
    await page.getByRole("button", { name: "Save Example", exact: true }).click();
    expect((await saveResponse).status()).toBe(200);
    await expect(page.getByText("Active example: Customized")).toBeVisible();
    await expect(page.getByRole("button", { name: "Download Example", exact: true })).toBeEnabled();

    const savedDownload = page.waitForEvent("download");
    const savedResponse = page.waitForResponse((response) => response.url().endsWith("/api/sops/import/json/example"));
    await page.getByRole("button", { name: "Download Example", exact: true }).click();
    const [download, response] = await Promise.all([savedDownload, savedResponse]);
    expect(response.status()).toBe(200);
    expect(download.suggestedFilename()).toBe("RISpro-SOP-JSON-V1-Example.json");
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const savedExample = JSON.parse(await fs.readFile(downloadPath!, "utf8"));
    expect(savedExample).toMatchObject({ format: "rispro-sop", formatVersion: 1, sop: { title: customTitle } });

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("heading", { name: "RISpro SOP JSON Example" })).toBeVisible();
    await expect(page.getByLabel("Example SOP Code")).toBeVisible();
    await expect(page.getByTestId("sop-structured-editor").getByText("Procedure", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Reset to Default", exact: true }).click();
    const confirmation = page.getByRole("dialog");
    await expect(confirmation.getByRole("heading", { name: "Reset JSON Example?" })).toBeVisible();
    await expect(confirmation).toContainText("This does not affect any existing SOPs.");
    const resetResponse = page.waitForResponse((response) => response.url().endsWith("/api/sops/import/json/example/reset") && response.request().method() === "POST");
    await confirmation.getByRole("button", { name: "Reset to Default", exact: true }).click();
    expect((await resetResponse).status()).toBe(200);
    await expect(page.getByText("Active example: Built-in default")).toBeVisible();

    await signInWithSession(page, "e2e_reception");
    await page.goto("/sops/json-example");
    await expect(page).toHaveURL(/\/sops$/);
    await expect(page.getByRole("button", { name: "Edit JSON Example", exact: true })).toHaveCount(0);
    expect((await page.request.get("/api/sops/import/json/example/config")).status()).toBe(403);
    expect((await page.request.put("/api/sops/import/json/example/config", { data: {} })).status()).toBe(403);
    expect((await page.request.post("/api/sops/import/json/example/reset")).status()).toBe(403);
    expect(pageErrors).toEqual([]);
  } finally {
    await page.request.post("/api/sops/import/json/example/reset").catch(() => undefined);
  }
});
