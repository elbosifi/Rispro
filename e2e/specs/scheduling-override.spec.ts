import { expect, test } from "@playwright/test";
import { E2E_PASSWORD, signInWithSession } from "../helpers/auth";

test("a reception capacity block requires supervisor approval and persists the approved booking", async ({ browser }) => {
  const receptionContext = await browser.newContext();
  const reception = await receptionContext.newPage();
  await signInWithSession(reception, "e2e_reception");
  await reception.goto("/appointments");
  await reception.getByPlaceholder(/search.*patient/i).fill("E2E Similar Two");
  await reception.getByRole("button", { name: /e2e similar two/i }).click();
  await reception.getByLabel(/modality/i).selectOption({ label: /e2e ct/i });
  await reception.getByLabel(/exam type/i).selectOption({ label: /e2e ct head/i });
  await reception.getByLabel(/start date/i).fill("2035-04-15");

  const fullSlot = reception.getByRole("button", { name: "2035-04-15 full" });
  await expect(fullSlot).toBeVisible();
  await fullSlot.click();
  await expect(reception.getByText(/approval|required|full/i).first()).toBeVisible();
  await reception.getByRole("button", { name: /request approval/i }).click();
  await reception.getByLabel(/reason for request/i).fill("Synthetic E2E capacity exception requiring review.");
  await reception.getByRole("button", { name: /submit request/i }).click();
  await expect(reception.getByText(/submitted|pending/i).first()).toBeVisible();

  const supervisorContext = await browser.newContext();
  const supervisor = await supervisorContext.newPage();
  await signInWithSession(supervisor, "e2e_supervisor");
  await supervisor.goto("/dashboard");
  await supervisor.getByRole("button", { name: /override/i }).click();
  await expect(supervisor.getByText("E2E Similar Two")).toBeVisible();
  await supervisor.getByRole("button", { name: /^approve$/i }).click();
  await supervisor.getByPlaceholder(/password/i).fill(E2E_PASSWORD);
  await supervisor.getByRole("button", { name: /verify/i }).click();
  await expect(supervisor.getByText(/approved/i).first()).toBeVisible();

  await reception.reload();
  await reception.getByRole("button", { name: /override/i }).click();
  await expect(reception.getByText(/approved/i).first()).toBeVisible();
  await supervisorContext.close();
  await receptionContext.close();
});
