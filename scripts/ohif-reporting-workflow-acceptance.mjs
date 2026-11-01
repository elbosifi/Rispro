// Runs inside the existing synthetic-only, disposable-DB/Orthanc/OHIF harness.
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {expect} from '@playwright/test';
async function state(page) {
  return page.evaluate(()=>{const s=window.services,v=s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());return {index:v.getCurrentImageIdIndex(),zoom:v.getZoom(),pan:v.getPan(),voi:v.getProperties().voiRange};});
}
async function drag(page,button,dx,dy) {
  const b=await page.locator('.cornerstone-viewport-element').first().boundingBox(),x=b.x+b.width/2,y=b.y+b.height/2;
  await page.mouse.move(x,y);await page.mouse.down({button});await page.mouse.move(x+dx,y+dy,{steps:12});await page.mouse.up({button});
}
export async function runReportingWorkflow({page,panel,context,origin,c,temp,fixture,pool,primary,second,signerUserId}) {
  const field=label=>panel.getByLabel(label,{exact:true}),viewport=page.locator('.cornerstone-viewport-element').first();
  const select=async label=>{await field(label).focus();await field(label).evaluate(el=>el.setSelectionRange(el.value.length,el.value.length));};
  const read=async()=>{const r=await context.request.get(origin+'/api/native-reporting/reports/'+primary.id);assert.equal(r.status(),200);return r.json();};
  const hold=async label=>{
    const previous=await field(label).inputValue(),focus=await page.evaluate(()=>document.activeElement?.tagName);
    await page.keyboard.down('ShiftRight');await panel.getByRole('button',{name:'Stop Dictation',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>document.activeElement?.tagName),focus,'Recording start must not steal viewport focus');
    await page.waitForTimeout(650);const response=page.waitForResponse('**/api/medical-dictation/transcribe');await page.keyboard.up('ShiftRight');assert.equal((await response).status(),200);
    await page.waitForFunction(({label,previous})=>document.querySelector(`textarea[aria-label="${label}"]`)?.value!==previous,{label,previous});
    assert.ok((await field(label).inputValue()).includes('OHIF dictated finding'));
  };
  const saved=(await read()).sections.findings;
  await select('Findings');await hold('Findings'); // A
  await viewport.click();await hold('Findings'); // B, no text-field click
  let before=await state(page);await viewport.hover();await page.mouse.wheel(0,250);
  await page.waitForFunction(index=>{const s=window.services;return s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId()).getCurrentImageIdIndex()!==index;},before.index);
  await hold('Findings'); // C
  before=await state(page);await drag(page,'right',15,35);assert.notEqual((await state(page)).zoom,before.zoom);await hold('Findings');
  await page.locator('[data-cy="Pan"] button').first().click();before=await state(page);await drag(page,'left',35,20);assert.notDeepEqual((await state(page)).pan,before.pan);await hold('Findings');
  before=await state(page);await drag(page,'middle',20,35);assert.notDeepEqual((await state(page)).voi,before.voi);await hold('Findings'); // D
  assert.equal((await read()).sections.findings,saved,'Dictated text must not autosave');
  for(const label of ['Impression','Technique','Comparison','Clinical history']){await select(label);await viewport.click();await hold(label);} // E and optional fields
  await panel.getByRole('button',{name:'Save',exact:true}).click();await panel.getByRole('status').filter({hasText:/^Saved$/}).waitFor();
  // I: exact existing browser preference key, plus a test using the same recorder without upload.
  await panel.getByText('Microphone / shortcuts',{exact:true}).click();
  const mic=panel.getByLabel('Selected microphone'),specific=await mic.locator('option').evaluateAll(options=>options.find(o=>o.value)?.value);
  assert.ok(specific);await mic.selectOption(specific);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('rispro.workstation.dictation.v1')).deviceId),specific);
  let transcriptions=0;const count=request=>{if(request.url().includes('/medical-dictation/transcribe'))transcriptions++;};page.on('request',count);
  await panel.getByRole('button',{name:'Test microphone',exact:true}).click();await panel.getByRole('status').filter({hasText:/Testing microphone/}).waitFor();
  await page.waitForTimeout(650);await panel.getByRole('button',{name:'Stop test',exact:true}).click();await page.waitForTimeout(300);await panel.getByRole('button',{name:'End test',exact:true}).click();assert.equal(transcriptions,0);page.off('request',count);
  // K: browser-computed colors on native selects and options, including disabled controls.
  const colors=await panel.locator('select,select option,input,textarea').evaluateAll(elements=>elements.map(el=>({text:getComputedStyle(el).color,bg:getComputedStyle(el).backgroundColor})));
  for(const color of colors){assert.notEqual(color.text,color.bg);assert.ok(/rgb\((7, 19, 34|23, 35, 50|36, 70, 107)\)/.test(color.bg),JSON.stringify(color));}
  await panel.evaluate(el=>{el.scrollTop=0;});await page.screenshot({path:join(temp,c.modality+'-reporting-desktop.png')});
  // J: actual backend permission changes, restored immediately; no synthetic eligibility response.
  const picker=panel.getByLabel('Report selection');
  try {
    await pool.query('update doctor_portal.doctor_profiles set can_finalize_reports=false where user_id=$1',[signerUserId]);
    await picker.selectOption(String(second.id));await picker.selectOption(String(primary.id));
    assert.equal(await panel.getByRole('button',{name:'Finalize',exact:true}).isDisabled(),true);await panel.getByText(/Signing permission is required under/).waitFor();
  } finally {await pool.query('update doctor_portal.doctor_profiles set can_finalize_reports=true where user_id=$1',[signerUserId]);}
  await picker.selectOption(String(second.id));await picker.selectOption(String(primary.id));
  await expect(panel.getByRole('button',{name:'Finalize',exact:true})).toBeEnabled();
  await panel.getByText('Microphone / shortcuts',{exact:true}).click();
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Report',exact:true}).first().click();await panel.waitFor({state:'visible'});
  assert.ok(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'No horizontal panel overflow on phone');
  await page.screenshot({path:join(temp,c.modality+'-reporting-phone.png')});await page.setViewportSize({width:1600,height:1000});
  await panel.getByRole('button',{name:'Finalize',exact:true}).click();await page.getByRole('button',{name:'Confirm and sign',exact:true}).click();await panel.getByText('Final — signed',{exact:true}).waitFor();
  const finalText=await field('Findings').inputValue();assert.equal(await field('Findings').getAttribute('readonly'),'');
  await viewport.click();await page.keyboard.down('ShiftRight');await page.waitForTimeout(300);await page.keyboard.up('ShiftRight');assert.equal(await field('Findings').inputValue(),finalText); // H
  await page.reload();await page.getByRole('button',{name:'Report',exact:true}).first().click();await panel.getByText('Final — signed',{exact:true}).waitFor();
  await panel.getByText('Microphone / shortcuts',{exact:true}).click();assert.equal(await panel.getByLabel('Selected microphone').inputValue(),specific);
  console.log(JSON.stringify({modality:c.modality,reportingWorkflow:'PASS',rightShift:true,viewport:true,slices:true,zoom:true,pan:true,windowLevel:true,allFiveFields:true,manualSave:true,microphonePreference:true,localMicTest:true,signerPermission:true,darkControls:true,phone:true,readOnly:true,staleReport:'verified by parent journey',patientInvalidation:'component regression'}));
}

export async function runPatientSwitch({pages,context,origin,fixture}) {
  const page=pages[0],panel=page.getByRole('region',{name:'RISpro report'}),contextId=new URL(page.url()).searchParams.get('risproContext');
  const authorized=await (await context.request.get(origin+'/api/native-reporting/contexts/'+contextId)).json(),draft=authorized.reports.find(r=>r.status==='draft');assert.ok(draft);
  await panel.getByLabel('Report selection').selectOption(String(draft.id));
  const findings=panel.getByLabel('Findings',{exact:true});await expect(findings).toBeEditable();
  await findings.fill('Patient one retained text');await panel.getByRole('button',{name:'Save',exact:true}).click();await panel.getByRole('status').filter({hasText:/^Saved$/}).waitFor();
  await findings.focus();fixture.delayNextTranscription();await page.keyboard.down('ShiftRight');await panel.getByRole('button',{name:'Stop Dictation',exact:true}).waitFor();await page.waitForTimeout(650);
  const request=page.waitForRequest('**/api/medical-dictation/transcribe');await page.keyboard.up('ShiftRight');await request;
  page.once('dialog',dialog=>dialog.accept());await page.goto(pages[1].url(),{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Report',exact:true}).first().click();await panel.getByText('Final — signed',{exact:true}).waitFor();
  await panel.getByText(/SYNTHETIC MR/,{exact:false}).first().waitFor();await panel.getByText(/Target: None/).waitFor();
  const retained=await panel.getByLabel('Findings',{exact:true}).inputValue();await page.waitForTimeout(1600);assert.equal(await panel.getByLabel('Findings',{exact:true}).inputValue(),retained);
  assert.equal((await (await context.request.get(origin+'/api/native-reporting/reports/'+draft.id)).json()).sections.findings,'Patient one retained text');
  console.log('PASS: changing patients in the same viewer tab while transcription is pending invalidates the old target.');
}
