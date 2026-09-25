import { expect, test, type Page } from "@playwright/test";
import { E2E_PASSWORD, signInWithSession } from "../helpers/auth";

const api = "http://127.0.0.1:3100";
async function noOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

test("mobile widget lifecycle, shared re-auth, privacy and responsive English/Arabic Settings", async ({page},testInfo)=>{
  test.setTimeout(120_000);
  await signInWithSession(page,"e2e_super_admin");
  await page.goto("/settings?source=widget-test");
  await page.getByRole("button",{name:/Mobile Widget Access/}).click();
  await expect(page).toHaveURL(/section=mobile_widget/);
  await expect(page.getByRole("heading",{name:"Today's operations"})).toBeVisible();
  const preview=await page.request.get(`${api}/api/settings/mobile-widget/preview`); expect(preview.status()).toBe(200);
  const aggregate=await preview.json();
  expect(aggregate.schemaVersion).toBe(1); expect(aggregate.totals.inQueue).toBe(aggregate.totals.arrived+aggregate.totals.waiting+aggregate.totals.inProgress);
  await page.screenshot({path:testInfo.outputPath("01-desktop-settings.png"),fullPage:true});
  await page.getByRole("button",{name:"Add device",exact:true}).click();
  const name="Synthetic iPhone — Operations Team Long Device Name";
  await page.getByLabel("Device name",{exact:true}).fill(name);
  await page.getByRole("button",{name:"Continue",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Supervisor Re-Authentication",exact:true})).toBeVisible();
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.getByRole("button",{name:"Verify",exact:true}).click();
  const secret=page.getByTestId("mobile-widget-secret"); await expect(secret).toBeVisible(); const first=(await secret.textContent())!;
  await expect(page).toHaveURL(/section=mobile_widget/);
  expect(first).toMatch(/^rwm_[\w-]{43}$/);
  await page.setViewportSize({width:390,height:844}); await noOverflow(page);
  await page.screenshot({path:testInfo.outputPath("02-mobile-secret-synthetic.png"),fullPage:true});
  await page.getByRole("button",{name:"Done",exact:true}).click(); await expect(secret).toHaveCount(0);
  await page.reload(); await expect(page.getByRole("heading",{name,exact:true})).toBeVisible(); await expect(secret).toHaveCount(0);
  expect(await page.evaluate(value=>JSON.stringify(localStorage).includes(value)||JSON.stringify(sessionStorage).includes(value),first)).toBe(false);
  for(const width of [1440,768,430,390,360]) {
    await page.setViewportSize({width,height:900}); await noOverflow(page);
    await page.screenshot({path:testInfo.outputPath(`03-active-${width}.png`),fullPage:true});
  }
  const device=page.getByRole("heading",{name,exact:true}).locator("..").locator("..");
  await device.getByRole("button",{name:"Rotate token",exact:true}).click();
  await expect(page.getByText(/current widget will stop updating/)).toBeVisible();
  await page.getByRole("button",{name:"Continue",exact:true}).click(); await expect(secret).toBeVisible(); const replacement=(await secret.textContent())!;
  expect(replacement).not.toBe(first);
  const mobile=async(token?:string)=>page.request.get(`${api}/api/mobile/operations-summary`,{headers:token?{Authorization:`Bearer ${token}`}:{}});
  expect((await mobile(first)).status()).toBe(401); expect((await mobile()).status()).toBe(401); expect((await mobile("invalid")).status()).toBe(401);
  const good=await mobile(replacement); expect(good.status()).toBe(200); expect(good.headers()["cache-control"]).toBe("no-store, private");
  const payload=await good.json(); const forbidden=/^(patient.*|national.?id|mrn|phone.*|email|accession.*|appointment.?id|booking.?id|studyinstanceuid|notes|dob|address|report.*)$/i;
  function inspect(value:unknown){if(value&&typeof value==="object")for(const [key,child]of Object.entries(value)){expect(key).not.toMatch(forbidden);inspect(child);}}
  inspect(payload); expect(JSON.stringify(payload)).not.toContain(replacement);
  await page.getByRole("button",{name:"Done",exact:true}).click();
  await page.getByRole("button",{name:"Revoke access",exact:true}).click(); await expect(page.getByText(/takes effect immediately/)).toBeVisible();
  await page.getByRole("button",{name:"Continue",exact:true}).click(); await expect(page.getByRole("dialog")).toHaveCount(0); expect((await mobile(replacement)).status()).toBe(401);
  await page.setViewportSize({width:1440,height:960});
  await page.getByRole("button",{name:"Switch language to Arabic",exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator("html")).toHaveAttribute("dir","rtl"); await expect(page.getByRole("heading",{name:"الوصول إلى أداة الهاتف",exact:true})).toBeVisible(); await noOverflow(page);
  await page.screenshot({path:testInfo.outputPath("04-mobile-arabic.png"),fullPage:true});
  await page.getByRole("button",{name:"إضافة جهاز",exact:true}).click(); await page.getByLabel("اسم الجهاز",{exact:true}).fill("هاتف الاختبار");
  await page.getByRole("button",{name:"متابعة",exact:true}).click(); await expect(secret).toBeVisible();
  await noOverflow(page); await page.screenshot({path:testInfo.outputPath("05-arabic-secret-synthetic.png"),fullPage:true});
  await page.getByRole("button",{name:"تم",exact:true}).click();
});
