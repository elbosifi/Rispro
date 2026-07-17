import { expect, test } from "@playwright/test";

test("real frontend, backend readiness, and seeded login are available", async ({ page, request }) => {
  const failures: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(message.text());
  });
  page.on("requestfailed", (request) => {
    if (new URL(request.url()).origin === "http://127.0.0.1:5173") failures.push(`failed request: ${request.url()}`);
  });

  const ready = await request.get("http://127.0.0.1:3100/api/ready");
  expect(ready.ok()).toBeTruthy();
  await page.goto("/");
  await expect(page.getByRole("heading")).toBeVisible();
  await page.getByLabel(/username/i).fill("e2e_reception");
  await page.getByLabel(/password/i).fill("E2ePassword!2026");
  await page.getByRole("button", { name: /sign in|login/i }).click();
  await expect(page).not.toHaveURL(/login/);
  expect(failures, failures.join("\n")).toEqual([]);
});
