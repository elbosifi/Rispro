import {test,expect} from '@playwright/test';
import {signInWithSession} from '../helpers/auth';
import type {WorkspaceReport,ReportingTemplate} from '../../frontend/src/lib/reporting-workspace-api';
import {writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const audioPath=join(tmpdir(),'rispro-reporting-stage2-'+process.pid+'.wav'),samples=48000,audio=Buffer.alloc(44+samples*2);
audio.write('RIFF');audio.writeUInt32LE(audio.length-8,4);audio.write('WAVEfmt ',8);audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);audio.writeUInt32LE(samples,24);audio.writeUInt32LE(samples*2,28);audio.writeUInt16LE(2,32);audio.writeUInt16LE(16,34);audio.write('data',36);audio.writeUInt32LE(samples*2,40);for(let i=0;i<samples;i++)audio.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*440/samples)*8000),44+i*2);writeFileSync(audioPath,audio);
test.use({launchOptions:{args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--use-file-for-fake-audio-capture='+audioPath]},permissions:['microphone']});
test.afterAll(()=>rmSync(audioPath,{force:true}));

test('standalone templates, explicit AI acceptance and dictation work at desktop and mobile widths',async({page},info)=>{
  test.setTimeout(90_000);
  page.setDefaultTimeout(15_000);
  let report:WorkspaceReport={id:4242,appointmentId:null,studyKey:'stage2-synthetic',revision:1,status:'draft',sections:{clinicalHistory:'Reusable clinical prompt',comparison:'None',technique:'CT',findings:'Original synthetic findings',impression:'Original synthetic impression'},identity:{patientName:'Synthetic Stage 2 Patient',patientIdentifier:'SYNTHETIC-4242',accession:'SYN-4242',examination:'Synthetic CT',studyDate:'20261106'},author:'Synthetic Doctor',creatorId:7,contributors:[],lastEditor:'Synthetic Doctor',finalizer:null,finalizedAt:null,reportType:'primary',mode:'shared',isPrimary:false,createdAt:'2026-11-06',updatedAt:'2026-11-06',deletedAt:null,canEdit:true,canFinalize:false,finalizeReasons:['Independent senior review is required.'],canReview:false,canDelete:false,canRecover:false,canRestoreRevision:true,reviewEnabled:true,reviewRequestedBy:null,reviewRequestedAt:null,preferredReviewerId:null,keyImages:[{id:'synthetic-image',caption:'Synthetic axial image caption',provenance:{sourceSeriesDescription:'Synthetic CT series',sourceStudyDate:'20261106',prior:false}}],addenda:[]};
  let templates:ReportingTemplate[]=[],draftWrites=0,transcriptions=0,creation:Record<string,unknown>|undefined;
  await page.route('**/api/native-reporting/**',async route=>{
    const path=new URL(route.request().url()).pathname,method=route.request().method(),body=method==='GET'||method==='DELETE'?{}:route.request().postDataJSON();
    if(path.endsWith('/config'))return route.fulfill({json:{enabled:true}});
    if(path.endsWith('/templates')){
      if(method==='POST'){const template={id:11,...body,createdAt:'2026-11-06',updatedAt:'2026-11-06'};templates.push(template);return route.fulfill({status:201,json:template});}
      return route.fulfill({json:{builtins:[{id:'blank',name:'Blank narrative'},{id:'structured',name:'Structured narrative'}],templates}});
    }
    if(/\/templates\/\d+$/.test(path)){const id=Number(path.split('/').at(-1)),template=templates.find(t=>t.id===id)!;if(method==='DELETE'){templates=templates.filter(t=>t.id!==id);return route.fulfill({status:204});}if(method==='PUT')Object.assign(template,body);return route.fulfill({json:template});}
    if(path.endsWith('/history'))return route.fulfill({json:{versions:[{id:'9001',revision:1,kind:'draft',author:'First synthetic editor',createdAt:'2026-11-05',snapshot:{sections:{...report.sections,findings:'Historical synthetic findings'}}},{id:'9002',revision:2,kind:'draft',author:'Second synthetic editor',createdAt:'2026-11-06',snapshot:{sections:report.sections}}],reviews:[]}});
    if(path.endsWith('/reviewers'))return route.fulfill({json:{reviewers:[{id:88,name:'Eligible Synthetic Consultant'}]}});
    if(path.endsWith('/synthetic-image'))return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=','base64')});
    if(path.endsWith('/draft')){draftWrites++;report={...report,revision:report.revision+1,sections:body.sections};return route.fulfill({json:report});}
    if(path.endsWith('/review')){report={...report,revision:report.revision+1,status:'in_review',canEdit:false,reviewRequestedAt:'2026-11-06',preferredReviewerId:body.preferredReviewerId};return route.fulfill({json:report});}
    if(path.endsWith('/studies/stage2-synthetic/reports')){creation=body;report={...report,id:4243,revision:1,sections:{...templates.find(t=>t.id===body.templateId)!.sections}};return route.fulfill({status:201,json:report});}
    if(path.endsWith('/studies/stage2-synthetic'))return route.fulfill({json:{studyKey:report.studyKey,identity:report.identity,studyUid:'1.2.3.4242',reports:[report],policy:{allowedTypes:['primary'],additional:'typed',collaboration:'both'},freshness:{status:'ready'},canCreate:true,blockedReason:null,primaryReportId:null}});
    return route.fulfill({json:report});
  });
  await page.route('**/api/medgemma/**',route=>route.fulfill({json:route.request().url().endsWith('/health')?{status:'connected',model:'Synthetic MedGemma'}:{text:'Proposed synthetic findings',processing_seconds:1}}));
  await page.route('**/api/medical-dictation/transcribe',route=>{transcriptions++;return route.fulfill({json:{text:'dictated finding period',processing_seconds:1}});});
  await signInWithSession(page,'e2e_doctor');
  await page.goto('/doctor/reporting/reports/4242');
  const findings=page.getByLabel('Findings',{exact:true});await expect(findings).toHaveValue('Original synthetic findings');
  await expect(page.getByText(/Synthetic axial image caption/)).toBeVisible();
  await page.getByRole('button',{name:'History / Compare'}).click();await page.getByRole('combobox',{name:/^Revision/}).selectOption('9001');await expect(page.getByText(/Editor: First synthetic editor/)).toBeVisible();await page.getByRole('button',{name:'History / Compare'}).click();
  await findings.focus();await findings.evaluate((field:HTMLTextAreaElement)=>field.setSelectionRange(field.value.length,field.value.length));
  await page.getByRole('button',{name:'Start dictation',exact:true}).click();await expect(page.getByRole('button',{name:'Stop dictation',exact:true})).toHaveAttribute('aria-pressed','true');await page.waitForTimeout(1250);await page.getByRole('button',{name:'Stop dictation',exact:true}).click();
  await expect.poll(()=>transcriptions).toBe(1);await expect(findings).toHaveValue(/dictated finding\./i);await expect.poll(()=>draftWrites).toBe(1);

  await page.getByRole('button',{name:'Personal reporting templates'}).click();await page.getByRole('button',{name:'Copy Current Report Sections'}).click();await page.getByLabel('Template name',{exact:true}).fill('Synthetic reusable CT');
  await expect(page.getByRole('button',{name:'Save Personal Template'})).toBeDisabled();await page.getByLabel(/I reviewed every section/).check();await page.getByRole('button',{name:'Save Personal Template'}).click();await expect(page.getByText(/Personal template saved/)).toBeVisible();
  expect(Object.keys(templates[0]).sort()).toEqual(['createdAt','id','name','sections','updatedAt']);
  await page.getByRole('button',{name:'MedGemma assistance'}).click();await page.getByRole('button',{name:'Preview AI Output'}).click();await expect(page.getByLabel('AI proposed text')).toHaveValue('Proposed synthetic findings');
  await page.screenshot({path:info.outputPath('standalone-ai-desktop.png'),fullPage:true});
  await page.getByRole('button',{name:'Accept AI Change'}).click();await expect(findings).toHaveValue('Proposed synthetic findings');const before=draftWrites;await page.waitForTimeout(1400);expect(draftWrites).toBe(before);
  await page.getByRole('button',{name:'Save',exact:true}).click();await expect.poll(()=>draftWrites).toBe(before+1);await page.getByRole('button',{name:'Dismiss Comparison'}).click();
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Preview AI Output'}).click();await expect(page.getByLabel('AI proposed text')).toHaveValue('Proposed synthetic findings');await page.getByRole('button',{name:'Reject / Dismiss AI Output'}).scrollIntoViewIfNeeded();
  await page.screenshot({path:info.outputPath('standalone-ai-mobile.png'),fullPage:true});await page.getByRole('button',{name:'Accept AI Change'}).click();const mobileBefore=draftWrites;await page.getByRole('button',{name:'Save',exact:true}).click();await expect.poll(()=>draftWrites).toBe(mobileBefore+1);await page.getByRole('button',{name:'Dismiss Comparison'}).click();
  await page.getByRole('link',{name:'All study reports'}).click();await page.getByLabel('Template',{exact:true}).selectOption('personal:11');await page.getByRole('button',{name:'Create Report',exact:true}).click();
  await expect(page).toHaveURL(/reports\/4243/);expect(creation?.templateId).toBe(11);expect(creation?.sections).toBeUndefined();await expect(findings).toHaveValue(/dictated finding\./i);
  await page.getByLabel('Preferred senior reviewer').selectOption('88');await page.getByRole('button',{name:'Submit for Review'}).click();await expect(page.getByText('Submitted for senior review',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Finalize',exact:true})).toBeDisabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('standalone-submitted-mobile.png'),fullPage:true});
});
