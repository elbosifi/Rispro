import { expect, type Page } from "@playwright/test";

export const E2E_PASSWORD = "E2ePassword!2026";

/** API-backed session setup uses the same cookie endpoint as the real login UI. */
export async function signInWithSession(page: Page, username: "e2e_reception" | "e2e_supervisor" | "e2e_super_admin" | "e2e_doctor") {
  await page.addInitScript(() => localStorage.setItem("rispro-language", "en"));
  const response = await page.request.post("http://127.0.0.1:3100/api/auth/login", {
    data: { username, password: E2E_PASSWORD },
    headers: { "x-forwarded-for": `e2e-${username}` },
  });
  expect(response.ok()).toBeTruthy();
}
