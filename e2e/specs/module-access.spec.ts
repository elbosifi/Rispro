import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { mkdir } from 'node:fs/promises';
import { assertSafeE2eEnvironment } from '../../scripts/e2e-db-safety.mjs';
import { E2E_PASSWORD, signInWithSession } from '../helpers/auth';

process.loadEnvFile('e2e/.env');
const target=assertSafeE2eEnvironment();
const api='http://127.0.0.1:3100/api';
let userId:number;
const captureId = Date.now();
test.describe.configure({mode:'serial'});
test.beforeAll(async () => {
  const db=new pg.Pool({connectionString:target.url});
  try {
    await db.query("delete from doctor_portal.reporting_board_saved_views where target_doctor_id in (select id from doctor_portal.doctor_profiles where user_id in (select id from users where username='e2e_module_clinician'))");
    await db.query("delete from doctor_portal.doctor_profiles where user_id in (select id from users where username='e2e_module_clinician')");
    await db.query("delete from audit_log where changed_by_user_id in (select id from users where username='e2e_module_clinician')");
    await db.query("delete from users where username='e2e_module_clinician'");
    userId=Number((await db.query(`insert into users(username,password_hash,full_name,role,gamma_knife_permissions,module_access_mode,default_landing_module)
      values('e2e_module_clinician',$1,'Synthetic Module Clinician','doctor',array['access','referral','clinical']::text[],'restricted','gamma-knife') returning id`,[await bcrypt.hash(E2E_PASSWORD,4)])).rows[0].id);
    await db.query("insert into doctor_portal.doctor_profiles(user_id,display_name,doctor_role,active) values($1,'Synthetic Module Clinician','consultant',true)",[userId]);
    await db.query("insert into user_module_grants(user_id,module_id) values($1,'gamma-knife'),($1,'doctor')",[userId]);
    await mkdir('artifacts/module-access',{recursive:true});
  } finally {await db.end();}
});
test.afterAll(async () => {
  const db=new pg.Pool({connectionString:target.url});
  try {
    await db.query('delete from doctor_portal.reporting_board_saved_views where target_doctor_id in (select id from doctor_portal.doctor_profiles where user_id=$1)',[userId]);
    await db.query('delete from doctor_portal.doctor_profiles where user_id=$1',[userId]);
    await db.query('delete from audit_log where changed_by_user_id=$1',[userId]);
    await db.query('delete from users where id=$1',[userId]);
  } finally {await db.end();}
});

async function openUser(page:Page) {
  await signInWithSession(page,'e2e_super_admin');
  await page.goto('/settings?section=users');
  await page.getByRole('button',{name:'Re-authenticate',exact:true}).click();
  await page.locator('input[type=password]').fill(E2E_PASSWORD);
  await page.getByRole('button',{name:'Verify',exact:true}).click();
  await page.getByRole('row').filter({hasText:'@e2e_module_clinician'}).getByRole('button',{name:'Manage',exact:true}).click();
  const section=page.getByRole('region',{name:'Module Access',exact:true});
  await expect(section).toBeVisible();
  return section;
}

test('administrator saves multiple modules, sees effective permissions and audit; desktop and Arabic mobile render',async ({page}) => {
  let section=await openUser(page);
  await section.scrollIntoViewIfNeeded();
  await expect(section.getByLabel('Access policy')).toHaveValue('restricted');
  await expect(section.getByLabel('Default landing module')).toHaveValue('gamma-knife');
  await expect(section.getByRole('checkbox').nth(1)).toBeChecked();
  await expect(section.getByRole('checkbox').nth(2)).toBeChecked();
  await section.getByRole('checkbox').nth(3).check();
  await section.getByLabel('Default landing module').selectOption('doctor');
  await section.getByRole('button',{name:'Save module access',exact:true}).click();
  section=page.getByRole('region',{name:'Module Access',exact:true});
  await expect(section.getByLabel('Default landing module')).toHaveValue('doctor');
  await expect(page.getByRole('dialog').getByText('Module access changed',{exact:true}).first()).toBeVisible();
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({path:`artifacts/module-access/desktop-en-${captureId}.png`});
  await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:'Switch language to Arabic',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('article').filter({hasText:'@e2e_module_clinician'}).getByRole('button',{name:'إدارة',exact:true}).click();
  const arabic=page.getByRole('region',{name:'الوصول إلى الوحدات',exact:true});
  await arabic.scrollIntoViewIfNeeded();
  await expect(arabic.getByLabel('الوحدة الافتراضية بعد الدخول')).toHaveValue('doctor');
  await expect(page.locator('html')).toHaveAttribute('dir','rtl');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({path:`artifacts/module-access/mobile-ar-${captureId}.png`});
});

test('login uses selected module, unauthorized URLs are denied, switcher shows only grants and revocation retains the mounted screen',async ({page,browser}) => {
  await page.addInitScript(() => localStorage.setItem('rispro-language','en'));
  await page.goto('/login');
  await page.getByLabel('Username',{exact:true}).fill('e2e_module_clinician');
  await page.locator('input[type=password]').fill(E2E_PASSWORD);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page).toHaveURL(/\/doctor\/my-work/);
  await page.goto('/workstation/printing');
  await expect(page).toHaveURL(/\/doctor\/workstation-printing/);
  await expect(page.getByRole('heading',{name:'Workstation printing and scanning',exact:true})).toBeVisible();
  expect((await page.request.get(api+'/scanner-bootstrap/settings')).ok()).toBeTruthy();
  expect((await page.request.get(api+'/integrations/status')).status()).toBe(403);
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/doctor\/my-work/);
  const switcher=page.getByRole('button',{name:'Switch workspace: Doctor Workspace'});
  await switcher.click();
  await expect(page.getByRole('menuitem',{name:'RISpro Core',exact:true})).toHaveCount(0);
  await expect(page.getByRole('menuitem',{name:'Gamma Knife',exact:true})).toBeVisible();
  await page.getByRole('menuitem',{name:'Gamma Knife',exact:true}).click();
  await expect(page).toHaveURL(/\/gamma-knife$/);
  await page.getByRole('button',{name:'Register referral',exact:true}).click();
  const draft=page.getByLabel('Provisional diagnosis',{exact:true});
  await draft.fill('Retain local clinical draft');
  const administrator=await browser.newContext();
  const login=await administrator.request.post(api+'/auth/login',{data:{username:'e2e_super_admin',password:E2E_PASSWORD}});
  expect(login.ok()).toBeTruthy();
  expect((await administrator.request.post(api+'/auth/re-auth',{data:{password:E2E_PASSWORD}})).ok()).toBeTruthy();
  expect((await administrator.request.put(api+`/users/${userId}/module-access`,{data:{mode:'restricted',grants:['teaching'],defaultModule:'teaching'}})).ok()).toBeTruthy();
  // A real rejected API request triggers the frontend's current-session check.
  expect((await page.request.get(api+'/gamma-knife/episodes')).status()).toBe(401);
  await page.evaluate(async () => {
    const {api}=await import('/src/lib/api-client.ts');
    await api('/gamma-knife/episodes').catch(() => {});
  });
  await expect(page.getByRole('dialog').getByText('Session access changed / تغيّر الوصول للجلسة',{exact:true})).toBeVisible();
  await expect(draft).toHaveValue('Retain local clinical draft');
  await expect(page).toHaveURL(/\/gamma-knife$/);
  expect((await page.request.post(api+'/auth/login',{data:{username:'e2e_module_clinician',password:E2E_PASSWORD}})).ok()).toBeTruthy();
  await page.evaluate(() => window.dispatchEvent(new Event('rispro-authorization-changed')));
  await expect(page.getByRole('dialog').getByText('Session access changed / تغيّر الوصول للجلسة',{exact:true})).toBeVisible();
  await expect(draft).toHaveValue('Retain local clinical draft');
  await expect(page).toHaveURL(/\/gamma-knife$/);
  await page.screenshot({path:`artifacts/module-access/revoked-session-${captureId}.png`});
  await administrator.close();
});
