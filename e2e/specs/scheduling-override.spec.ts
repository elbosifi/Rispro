import { expect, test } from "@playwright/test";
import { E2E_PASSWORD, signInWithSession } from "../helpers/auth";
import { e2eTomorrowInTripoli } from "../helpers/fixtures";

test("a reception capacity block requires supervisor approval and persists the approved booking", async ({ browser }) => {
  test.setTimeout(90_000);
  const receptionContext = await browser.newContext();
  const reception = await receptionContext.newPage();
  const fullFixtureDate = e2eTomorrowInTripoli();
  await test.step("reception requests the full-capacity exception", async () => {
    await signInWithSession(reception, "e2e_reception");
    await reception.goto("/appointments");
    await reception.getByPlaceholder("Search patient by name, national ID, or MRN…").fill("E2E Similar Patient Two");
    await reception.getByRole("button", { name: /e2e similar patient two/i }).click();
    await reception.getByPlaceholder("Enter identifier").fill("100000000002");
    await reception.getByRole("button", { name: "Verify and select" }).click();
    await reception.getByLabel(/modality/i).selectOption({ label: "E2E CT — التصوير المقطعي E2E" });
    await reception.getByLabel(/exam type/i).selectOption({ label: "E2E CT Head — رأس E2E" });
    await reception.getByLabel(/start date/i).fill(fullFixtureDate);
    await reception.getByRole("button", { name: "Show full days" }).click();
    const fullSlot = reception.getByRole("button", { name: new RegExp(`${fullFixtureDate} full`, "i") });
    await expect(fullSlot).toBeVisible();
    await fullSlot.click();
    await reception.getByRole("button", { name: "Request override approval" }).click();
    await expect(reception.getByRole("heading", { name: "Request override approval" })).toBeVisible();
    await reception.getByLabel("Requester reason").fill("Synthetic E2E capacity exception requiring review.");
    await reception.getByRole("button", { name: /submit request/i }).click();
    await expect(reception.getByText(/submitted|pending/i).first()).toBeVisible();
  });

  const approverContext = await browser.newContext();
  const approver = await approverContext.newPage();
  await test.step("super administrator approves the total-capacity exception and reception observes it", async () => {
    await signInWithSession(approver, "e2e_super_admin");
    await approver.goto("/dashboard");
    await approver.getByRole("button", { name: /override/i }).click();
    await expect(approver.getByText("E2E Similar Patient Two")).toBeVisible();
    await approver.getByLabel(/approval note for request/i).fill("E2E super-admin approval for the total-capacity exception.");
    await approver.getByRole("button", { name: "Approve" }).click();
    await approver.locator('input[autocomplete="current-password"]').fill(E2E_PASSWORD);
    await approver.getByRole("button", { name: "Verify" }).click();
    await expect(approver.getByText("Override request approved")).toBeVisible();
    await reception.reload();
    await reception.getByRole("button", { name: /override/i }).click();
    await expect(reception.getByText("approved", { exact: true }).last()).toBeVisible();
  });
  await approverContext.close();
  await receptionContext.close();
});
