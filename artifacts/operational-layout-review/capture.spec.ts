import { test, expect, type Page } from '@playwright/test';
import { signInWithSession } from '../../e2e/helpers/auth';
import { e2eTodayInTripoli } from '../../e2e/helpers/fixtures';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

const root = resolve('artifacts/operational-layout-review');
async function capture(page: Page, path: string, selector: string) {
  await expect(page.locator(selector).first()).toBeVisible();
  await page.screenshot({ path: resolve(root, path) });
  const metrics = await page.evaluate((s) => {
    const rect = (e: Element) => { const r=e.getBoundingClientRect(); return { x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height) }; };
    const top = document.querySelector(s)!;
    return { viewport:[innerWidth,innerHeight], target:rect(top), overflowX:document.documentElement.scrollWidth>innerWidth,
      regions:[...top.querySelectorAll('header,[data-testid],iframe,canvas')].filter(e=>{const r=e.getBoundingClientRect();return r.width>80&&r.height>30}).map(e=>({tag:e.tagName,id:e.getAttribute('data-testid'),...rect(e)})).slice(0,35) };
  }, selector);
  writeFileSync(resolve(root, path.replace('.png','.json')), JSON.stringify(metrics,null,2));
}
test('registration seeded empty', async ({page}) => {
  await page.setViewportSize({width:1440,height:900}); await signInWithSession(page,'e2e_reception');
  await page.goto('/registrations?dateMode=all');
  await page.locator('[role="button"][aria-label*="E2E Queue Patient"]').last().click();
  await expect(page.getByRole('dialog',{name:'Manage'})).toBeVisible();
  await expect(page.getByText(/No protocol is assigned/i)).toBeVisible();
  await capture(page,'registration/registration-seeded-empty-1440.png','[role="dialog"]');
  await page.setViewportSize({width:1366,height:768}); await capture(page,'registration/registration-seeded-empty-1366.png','[role="dialog"]');
  await page.setViewportSize({width:390,height:844}); await capture(page,'registration/registration-seeded-empty-mobile.png','[role="dialog"]');
});
test('synthetic multi-page PDFs in registration', async ({page,browser}) => {
  test.setTimeout(90000);
  const pdfPage=await browser.newPage();
  const docs=[{name:'synthetic-referral.pdf',pages:1},{name:'synthetic-clinical-history-with-a-deliberately-long-filename-to-assess-identification.pdf',pages:4},{name:'synthetic-imaging-request.pdf',pages:10}];
  for (const doc of docs) {
    await pdfPage.setContent(`<style>body{font:14px Arial;color:#172339}article{height:940px;page-break-after:always}h1{font-size:23px}p{line-height:1.5}</style>${Array.from({length:doc.pages},(_,i)=>`<article><h1>SYNTHETIC RADIOLOGY REFERRAL</h1><p>Example patient: TEST PATIENT ONLY &nbsp; | &nbsp; Page ${i+1} of ${doc.pages}</p><hr><h2>Clinical history and examination request</h2><p>Persistent abdominal discomfort. Please assess liver and upper abdomen. Prior ultrasound described an indeterminate finding. No real patient information is included.</p><h3>Relevant information</h3><p>Contrast and preparation requirements must be confirmed by the treating team. Clinical question: characterize the reported finding and assess surrounding structures.</p><p>Referring clinician: Synthetic Example &nbsp; | &nbsp; Request date: 01 November 2026</p></article>`).join('')}`);
    await pdfPage.pdf({path:resolve(root,'report',doc.name),format:'A4',printBackground:true});
  }
  await pdfPage.close();
  const db=new pg.Pool({connectionString:'postgresql://rispro_e2e:rispro_e2e_password@127.0.0.1:5444/rispro_e2e'});
  try {
    const q=await db.query("select b.id, b.patient_id from appointments_v2.bookings b join patients p on p.id=b.patient_id where p.english_full_name='E2E Queue Patient' limit 1");
    await db.query('delete from documents where v2_booking_id=$1 and original_filename=any($2::text[])',[q.rows[0].id,docs.map(d=>d.name)]);
    for(const doc of docs) await db.query("insert into documents (patient_id,v2_booking_id,document_type,original_filename,stored_path,mime_type,file_size,source) values ($1,$2,'appointment_request',$3,$4,'application/pdf',4096,'manual_upload')",[q.rows[0].patient_id,q.rows[0].id,doc.name,`artifacts/operational-layout-review/report/${doc.name}`]);
  } finally {await db.end();}
  await page.setViewportSize({width:1440,height:900}); await signInWithSession(page,'e2e_reception'); await page.goto('/registrations?dateMode=all');
  await page.locator('[role="button"][aria-label*="E2E Queue Patient"]').last().click(); await expect(page.getByRole('dialog',{name:'Manage'})).toBeVisible();
  await expect(page.locator('canvas').first()).toBeVisible();
  await capture(page,'registration/registration-synthetic-multiple-1440.png','[role="dialog"]');
  console.log('CONTROLS',await page.getByRole('dialog',{name:'Manage'}).getByRole('button').allTextContents());
  console.log('TITLES',await page.locator('[title]').evaluateAll(es=>es.map(e=>e.getAttribute('title')).filter(Boolean)));
});
test('document controls and selection', async ({page}) => {
  test.setTimeout(60000); await page.setViewportSize({width:1440,height:900}); await signInWithSession(page,'e2e_reception');
  await page.goto('/registrations?dateMode=all'); await page.locator('[role="button"][aria-label*="E2E Queue Patient"]').last().click();
  const d=page.getByRole('dialog',{name:'Manage'}); await expect(d.locator('canvas').first()).toBeVisible();
  await expect(d.locator('.react-pdf__Page')).toHaveCount(10);
  await d.locator('canvas').first().screenshot({path:resolve(root,'report/synthetic-pdf-page.png')});
  await d.getByRole('button',{name:'Zoom in'}).click(); await expect(d.getByRole('group',{name:'Zoom'})).toContainText('110%');
  await d.getByRole('button',{name:'Fit page',exact:true}).click(); await expect(d.getByRole('button',{name:'Fit page',exact:true})).toHaveAttribute('aria-pressed','true');
  await d.getByRole('button',{name:'Fit width',exact:true}).click();
  const scroll= d.locator('.react-pdf__Page').first().locator('xpath=../../..');
  const moved=await scroll.evaluate(e=>{const node=e as HTMLElement;node.scrollTop=1100;return {top:node.scrollTop,height:node.scrollHeight,client:node.clientHeight}}); console.log('PDF_SCROLL',moved); expect(moved.top).toBeGreaterThan(0);
  await d.getByRole('button',{name:'Expand review'}).click(); await expect(d.getByRole('button',{name:'Exit expanded review'})).toBeVisible();
  await d.getByRole('button',{name:'Exit expanded review'}).click();
  await d.getByRole('button',{name:/synthetic-referral.pdf/}).click(); await expect(d.locator('.react-pdf__Page')).toHaveCount(1);
  await d.getByRole('button',{name:/synthetic-imaging-request.pdf/}).click(); await expect(d.locator('.react-pdf__Page')).toHaveCount(10);
  const popup=page.waitForEvent('popup'); await d.getByRole('toolbar',{name:'Document utilities'}).getByRole('link',{name:'Open in new tab'}).click(); const p=await popup; await expect.poll(()=>p.url()).toContain('/api/documents/'); console.log('PDF_TAB',new URL(p.url()).pathname); await p.close();
  await capture(page,'registration/registration-pdf-controls-1440.png','[role="dialog"]');
});
test('capture synthetic single-page referral for mockup', async ({page}) => {
  await page.setViewportSize({width:1440,height:900}); await signInWithSession(page,'e2e_reception');
  await page.goto('/registrations?dateMode=all'); await page.locator('[role="button"][aria-label*="E2E Queue Patient"]').last().click();
  const d=page.getByRole('dialog',{name:'Manage'}); await d.getByRole('button',{name:/synthetic-referral.pdf/}).click(); await expect(d.locator('.react-pdf__Page')).toHaveCount(1); await expect(d.locator('canvas').first()).toBeVisible();
  await d.locator('canvas').first().screenshot({path:resolve(root,'report/synthetic-single-page.png')});
});
test('modality seeded completed', async ({page}) => {
  await page.setViewportSize({width:1440,height:900}); await signInWithSession(page,'e2e_supervisor');
  const response=await page.request.get('http://127.0.0.1:3100/api/v2/lookups/modalities'); const json=await response.json(); const id=json.items.find((x:{code:string})=>x.code==='E2E_CT').id;
  await page.goto(`/modality?modalityId=${id}&date=${e2eTodayInTripoli()}&view=completed`);
  await page.getByTestId(/modality-board-row-/).filter({hasText:'E2E Acquisition Patient'}).click();
  await expect(page.getByTestId('selected-appointment-drawer')).toBeVisible();
  await capture(page,'modality/modality-seeded-completed-1440.png','[data-testid="selected-appointment-drawer"]');
  await page.setViewportSize({width:1366,height:768}); await capture(page,'modality/modality-seeded-completed-1366.png','[data-testid="selected-appointment-drawer"]');
  await page.setViewportSize({width:390,height:844}); await capture(page,'modality/modality-seeded-completed-mobile.png','[data-testid="selected-appointment-drawer"]');
});
test('fresh modality responsive capture and protocol response', async ({page}) => {
  test.setTimeout(60000); await page.setViewportSize({width:390,height:844}); await signInWithSession(page,'e2e_supervisor');
  page.on('response', r => { if (/protocol-assignment|protocol.*assignment/i.test(r.url())) console.log('PROTOCOL_RESPONSE',r.status(),new URL(r.url()).pathname); });
  const response=await page.request.get('http://127.0.0.1:3100/api/v2/lookups/modalities'); const json=await response.json(); const id=json.items.find((x:{code:string})=>x.code==='E2E_CT').id;
  await page.goto(`/modality?modalityId=${id}&date=${e2eTodayInTripoli()}&view=completed`);
  await page.getByTestId(/modality-mobile-card-/).filter({hasText:'E2E Acquisition Patient'}).click(); await expect(page.getByTestId('selected-appointment-drawer')).toBeVisible();
  await expect(page.getByTestId('clinical-patient-banner')).toContainText('E2E Acquisition Patient');
  await capture(page,'modality/modality-fresh-mobile.png','[data-testid="selected-appointment-drawer"]');
  for(const [width,height] of [[768,1024],[1920,1080]]) {await page.setViewportSize({width,height}); await capture(page,`modality/modality-seeded-completed-${width}.png`,'[data-testid="selected-appointment-drawer"]');}
});
test('real CT modality structured protocol fixture', async ({page}) => {
  test.setTimeout(60000);
  const db=new pg.Pool({connectionString:'postgresql://rispro_e2e:rispro_e2e_password@127.0.0.1:5444/rispro_e2e'});
  let id:string;
  try { const ct=await db.query("select id from modalities where code='CT'"); id=ct.rows[0].id; await db.query("update appointments_v2.bookings set modality_id=$1 where patient_id=(select id from patients where english_full_name='E2E Acquisition Patient')",[id]); } finally {await db.end();}
  await page.setViewportSize({width:1440,height:900}); await signInWithSession(page,'e2e_supervisor');
  page.on('response',r=>{if(/protocol-assignment|protocol.*assignment/i.test(r.url()))console.log('PROTOCOL_RESPONSE',r.status(),new URL(r.url()).pathname)});
  await page.goto(`/modality?modalityId=${id}&date=${e2eTodayInTripoli()}&view=completed`);
  await page.getByTestId(/modality-board-row-/).filter({hasText:'E2E Acquisition Patient'}).click();
  await expect(page.getByTestId('clinical-protocol-content')).toBeVisible();
  await capture(page,'modality/modality-real-ct-protocol-1440.png','[data-testid="selected-appointment-drawer"]');
  await page.setViewportSize({width:1366,height:768}); await capture(page,'modality/modality-real-ct-protocol-1366.png','[data-testid="selected-appointment-drawer"]');
});
test('real CT modality mobile identity', async ({page}) => {
  await page.setViewportSize({width:390,height:844}); await signInWithSession(page,'e2e_supervisor');
  await page.goto(`/modality?modalityId=2&date=${e2eTodayInTripoli()}&view=completed`);
  await page.getByTestId(/modality-mobile-card-/).filter({hasText:'E2E Acquisition Patient'}).click();
  await expect(page.getByTestId('clinical-protocol-content')).toBeVisible();
  await capture(page,'modality/modality-real-ct-mobile.png','[data-testid="selected-appointment-drawer"]');
});
test('doctor protocoling seeded appointment', async ({page}) => {
  await page.setViewportSize({width:1440,height:900}); await signInWithSession(page,'e2e_doctor');
  await page.goto('/doctor/protocols'); await page.getByRole('button',{name:'Tomorrow'}).click();
  await page.getByLabel('Protocol status').selectOption('ALL'); await page.getByLabel('Search protocoling appointments').fill('E2E Protocoling Exam Patient');
  await page.getByRole('row',{name:/E2E Protocoling Exam Patient/}).getByRole('button',{name:'Assign'}).click();
  const d=page.getByRole('dialog',{name:/assign protocol|change assigned protocol/i}); await expect(d).toBeVisible();
  await expect(d.getByRole('radio',{name:'Free-text protocol'})).toBeVisible();
  await capture(page,'doctor/doctor-seeded-pending-1440.png','[data-testid="protocol-assignment-modal-backdrop"] [role="dialog"]');
  await d.getByRole('radio',{name:'Free-text protocol'}).click();
  await d.getByLabel('Free-text protocol').fill('CT brain without IV contrast.\nReview the posterior fossa and bone windows.\nSynthetic example only.');
  await capture(page,'doctor/doctor-unsaved-free-text-1440.png','[data-testid="protocol-assignment-modal-backdrop"] [role="dialog"]');
  await page.setViewportSize({width:1366,height:768}); await capture(page,'doctor/doctor-unsaved-free-text-1366.png','[data-testid="protocol-assignment-modal-backdrop"] [role="dialog"]');
  await page.setViewportSize({width:390,height:844}); await capture(page,'doctor/doctor-unsaved-free-text-mobile.png','[data-testid="protocol-assignment-modal-backdrop"] [role="dialog"]');
});
