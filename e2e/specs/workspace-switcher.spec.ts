import { expect, test } from "@playwright/test";
import { signInWithSession } from "../helpers/auth";

test("workspace switcher routes and active state across screen sizes", async ({ page }) => {
  await signInWithSession(page, "e2e_super_admin");
  await page.route("**/api/gamma-knife/me", route => route.fulfill({ json: { permissions: ["access"], canManageSettings: false } }));
  await page.goto("/doctor/my-work");
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [current, target, path] of [
      ["Doctor Workspace", "Gamma Knife", /\/gamma-knife$/],
      ["Gamma Knife", "Teaching", /\/teaching\/dashboard$/],
      ["Teaching", "RISpro Core", /\/dashboard$/],
      ["RISpro Core", "Doctor Workspace", /\/doctor\/my-work$/],
    ] as const) {
      const switcher = page.getByRole("button", { name: `Switch workspace: ${current}` });
      await expect(switcher).toBeVisible();
      await switcher.click();
      await expect(page.getByRole("menuitem", { name: new RegExp(current) })).toHaveAttribute("aria-current", "true");
      await page.getByRole("menuitem", { name: target, exact: true }).click();
      await expect(page).toHaveURL(path);
    }
  }
});

