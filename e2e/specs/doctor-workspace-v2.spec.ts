import {test,expect} from '@playwright/test';
import {createServer,type Server} from 'node:http';
import {createHash,randomUUID} from 'node:crypto';
import {writeFileSync,rmSync} from 'node:fs';
import {tmpdir,networkInterfaces} from 'node:os';
import {join} from 'node:path';
import pg from 'pg';
import {signInWithSession} from '../helpers/auth';
import {e2eTodayInTripoli} from '../helpers/fixtures';
const audioPath=join(tmpdir(),'rispro-workspace-v2-dictation.wav');
const samples=48000,audio=Buffer.alloc(44+samples*2);audio.write('RIFF');audio.writeUInt32LE(audio.length-8,4);audio.write('WAVEfmt ',8);audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);audio.writeUInt32LE(48000,24);audio.writeUInt32LE(96000,28);audio.writeUInt16LE(2,32);audio.writeUInt16LE(16,34);audio.write('data',36);audio.writeUInt32LE(samples*2,40);for(let i=0;i<samples;i++)audio.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*440/48000)*8000),44+i*2);writeFileSync(audioPath,audio);
test.use({launchOptions:{args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--use-file-for-fake-audio-capture='+audioPath]}});
let db:pg.Pool,archive:Server,archiveOrigin='',transcript='dictated finding',delayTranscription=false;
const prefix='wv2e2e_'+Date.now();
const studies=Array.from({length:215},(_,i)=>({id:prefix+'_'+i,uid:'1.2.826.0.1.3680043.10.999.'+i+'.'+Date.now(),patient:'SYNTHETIC-'+i,accession:prefix+'A'+i,name:'Synthetic Patient '+i}));
test.beforeAll(async()=>{
  db=new pg.Pool({connectionString:'postgresql://rispro_e2e:rispro_e2e_password@127.0.0.1:5444/rispro_e2e'});
  expect((await db.query('select current_database() db')).rows[0].db).toBe('rispro_e2e');
  const ct=(await db.query("insert into modalities(code,name_ar,name_en) values('CT','Synthetic CT','Synthetic CT') on conflict(code) do update set code=excluded.code returning id")).rows[0].id;
  await db.query("insert into doctor_portal.doctor_modality_permissions(doctor_id,modality_id,can_protocol,can_report,can_supervise,active) select d.id,$1,true,true,false,true from doctor_portal.doctor_profiles d join users u on u.id=d.user_id where u.username like 'e2e_%' on conflict(doctor_id,modality_id) do update set can_report=true,active=true",[ct]);
  // MedASR correctly prohibits loopback destinations. Bind the synthetic upstream
  // to this machine's virtual adapter; no external LAN service is contacted.
  const fixtureAddress=Object.entries(networkInterfaces()).flatMap(([name,rows])=>(rows||[]).filter(r=>r.family==='IPv4'&&!r.internal&&(process.platform!=='win32'||/vEthernet|Docker/i.test(name))&&/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(r.address)).map(r=>r.address))[0];
  if(!fixtureAddress)throw new Error('An isolated local virtual-network IPv4 adapter is required for the synthetic MedASR upstream.');
  archive=createServer((req,res)=>{
    const url=new URL(req.url||'/',archiveOrigin||'http://127.0.0.1');res.setHeader('Content-Type','application/json');
    if(url.pathname==='/health'){res.end(JSON.stringify({status:'ready',model:'Synthetic MedASR'}));return;}
    if(url.pathname==='/transcribe'){req.resume();req.on('end',()=>{const text=transcript;setTimeout(()=>res.end(JSON.stringify({text,processing_seconds:0.1})),delayTranscription?1800:0);});return;}
    if(url.pathname==='/changes'){res.end(JSON.stringify({Changes:[],Last:0,Done:true}));return;}
    if(url.pathname==='/statistics'){res.end(JSON.stringify({CountStudies:215}));return;}
    const s=studies.find(s=>url.pathname==='/studies/'+s.id);
    if(s){res.end(JSON.stringify({ID:s.id,MainDicomTags:{StudyInstanceUID:s.uid,AccessionNumber:s.accession,StudyDate:e2eTodayInTripoli().replaceAll('-',''),StudyDescription:'Synthetic CT',ModalitiesInStudy:'CT'},PatientMainDicomTags:{PatientID:s.patient,PatientName:s.name},Series:['synthetic-series']}));return;}
    res.statusCode=404;res.end('{}');
  });await new Promise<void>(resolve=>archive.listen(0,fixtureAddress,resolve));archiveOrigin='http://'+fixtureAddress+':'+(archive.address() as {port:number}).port;
  for(const [key,value] of Object.entries({enabled:'enabled',base_url:archiveOrigin,username:'synthetic',password:'synthetic'}))await db.query('insert into system_settings(category,setting_key,setting_value) values(\'authoritative_orthanc\',$1,$2) on conflict(category,setting_key) do update set setting_value=excluded.setting_value',[key,JSON.stringify({value})]);
  await db.query(`update system_settings set setting_value=setting_value || '{"enabled":true}'::jsonb where category='doctor_workspace' and setting_key='reporting_policy'`);
  await db.query(`update medical_dictation_configuration set enabled=true,base_url=$1,allow_insecure_http=true,timeout_seconds=10,api_key_secret=null where id=1`,[archiveOrigin]);
  await db.query(`insert into historical_pacs_studies(orthanc_study_id,study_instance_uid,accession_number,patient_id,patient_name_raw,study_date,study_description,modalities_in_study,series_count)
    select x.id,x.uid,x.accession,x.patient,x.name,$2,'Synthetic CT',array['CT'],1 from jsonb_to_recordset($1::jsonb) x(id text,uid text,accession text,patient text,name text)`,[JSON.stringify(studies),e2eTodayInTripoli().replaceAll('-','')]);
  await db.query('update historical_pacs_sync_state set source_archive_key=$1,last_success_at=now(),last_full_sync_at=now(),last_change_sequence=0,last_error=null,sync_run_status=\'idle\'',['orthanc:'+createHash('sha256').update(archiveOrigin).digest('hex')]);
});
test.afterAll(async()=>{await db?.query(`update system_settings set setting_value=setting_value || '{"enabled":false}'::jsonb where category='doctor_workspace' and setting_key='reporting_policy'`);await db?.end();await new Promise<void>(resolve=>archive?.close(()=>resolve()));rmSync(audioPath,{force:true});});

test('real reporting catalogue/editor: pagination, unbooked reports, cursor dictation, collaboration, history, signing, mobile and rollback',async({page,browser},info)=>{
  test.setTimeout(150_000);page.setDefaultTimeout(15_000);await page.context().grantPermissions(['microphone']);
  await page.addInitScript(()=>localStorage.setItem('rispro.workstation.dictation.v1',JSON.stringify({keyboardEnabled:true,keyboardShortcut:{code:'F9',ctrl:false,alt:false,shift:false,meta:false},keyboardMode:'hold'})));
  await signInWithSession(page,'e2e_doctor_non_supervisor');
  const pixels:string[]=[];page.on('request',r=>{if(/\/frames\/|\/wado|\/ohif\/|\/ohif-dicomweb\//i.test(r.url()))pixels.push(r.url());});
  await page.goto('/doctor/reporting?q='+prefix+'&offset=200');
  await expect(page.getByRole('heading',{name:'Reporting',exact:true})).toBeVisible();await expect(page.getByText('201–215 of 215')).toBeVisible();
  await expect(page.getByRole('cell').filter({hasText:'No RISpro Report'})).toHaveCount(15);
  await expect(page.getByRole('cell').filter({hasText:'External Status Unknown'})).toHaveCount(15);
  for(const label of ['RISpro Draft','In Review','RISpro Final','External Draft','External Final','Additional Reports'])await expect(page.getByLabel('Reporting status').getByRole('option',{name:label,exact:true})).toHaveCount(1);
  const rowHeight=await page.locator('tbody tr').first().evaluate(e=>e.getBoundingClientRect().height);expect(rowHeight).toBeLessThanOrEqual(72);
  writeFileSync(info.outputPath('catalogue-density.json'),JSON.stringify({rowHeight,visibleRows:await page.locator('tbody tr').evaluateAll(rows=>rows.filter(r=>r.getBoundingClientRect().top>=0&&r.getBoundingClientRect().bottom<=innerHeight).length)}));
  await page.screenshot({path:info.outputPath('desktop-catalogue.png'),fullPage:true});
  await expect(page.locator('aside').getByRole('button',{name:'Reporting Board',exact:true})).toHaveCount(0);
  const denied=await page.request.get('/api/doctor/reporting-board/cases');expect(denied.status()).toBe(403);
  await page.getByRole('link',{name:'Open Reports'}).first().click();await expect(page.getByText('No RISpro report exists.')).toBeVisible();
  expect((await db.query('select count(*)::int n from native_reports')).rows[0].n).toBe(0);
  await page.getByLabel('Collaboration',{exact:true}).selectOption('shared');await page.getByRole('button',{name:'Create Report',exact:true}).click();
  await expect(page.getByLabel('Findings',{exact:true})).toBeEditable();const reportUrl=page.url();
  await page.getByLabel('Findings',{exact:true}).fill('Before after');await page.getByLabel('Impression',{exact:true}).fill('Synthetic impression');
  await expect(page.getByRole('status').filter({hasText:/^Saved$/})).toBeVisible();
  const findings=page.getByLabel('Findings',{exact:true});await findings.focus();await findings.evaluate((e:HTMLTextAreaElement)=>e.setSelectionRange(7,7));
  await page.getByRole('button',{name:'Start dictation',exact:true}).click();await expect(page.getByRole('button',{name:'Stop dictation',exact:true})).toBeVisible();await page.waitForTimeout(1000);const transcriptionResponse=page.waitForResponse('**/api/medical-dictation/transcribe');await page.getByRole('button',{name:'Stop dictation',exact:true}).click();const transcribed=await transcriptionResponse;expect(transcribed.status(),await transcribed.text()).toBe(200);
  await expect(findings).toHaveValue('Before Dictated finding after',{timeout:15000});
  transcript='dictated impression';await page.getByLabel('Impression',{exact:true}).fill('');await page.getByLabel('Impression',{exact:true}).focus();await page.keyboard.down('F9');await expect(page.getByRole('button',{name:'Stop dictation',exact:true})).toBeVisible();await page.waitForTimeout(650);await page.keyboard.up('F9');await expect(page.getByLabel('Impression',{exact:true})).toHaveValue('Dictated impression',{timeout:15000});
  await expect(page.getByRole('status').filter({hasText:/^Saved$/})).toBeVisible();
  await page.screenshot({path:info.outputPath('desktop-editor.png'),fullPage:true});
  expect(pixels).toEqual([]);
  transcript='stale transcription must not arrive';delayTranscription=true;
  await findings.focus();const pendingTranscript=page.waitForRequest('**/api/medical-dictation/transcribe');
  await page.keyboard.down('F9');await expect(page.getByRole('button',{name:'Stop dictation',exact:true})).toBeVisible();await page.waitForTimeout(650);await page.keyboard.up('F9');await pendingTranscript;
  await page.getByRole('link',{name:'Back to Reporting Worklist'}).click();await expect(page).toHaveURL(new RegExp('offset=200'));await expect(page.getByText('201–215 of 215')).toBeVisible();
  await page.goto(reportUrl);
  await page.waitForTimeout(2000);await expect(page.getByLabel('Findings',{exact:true})).toHaveValue('Before Dictated finding after');delayTranscription=false;
  const second=await browser.newContext({baseURL:'http://127.0.0.1:5173'}),other=await second.newPage();await signInWithSession(other,'e2e_doctor_other');await other.goto(reportUrl);
  await other.getByLabel('Findings',{exact:true}).fill('Second doctor findings');await other.getByRole('button',{name:'Save',exact:true}).click();await expect(other.getByRole('status').filter({hasText:/^Saved$/})).toBeVisible();
  await page.getByLabel('Findings',{exact:true}).fill('Retained conflicting local text');await page.getByRole('button',{name:'Save',exact:true}).click();await expect(page.getByText('Your unsaved text is retained.',{exact:false}).first()).toBeVisible();await expect(page.getByLabel('Findings',{exact:true})).toHaveValue('Retained conflicting local text');
  await page.getByRole('button',{name:'Compare saved report'}).click();await expect(page.getByText('Second doctor findings',{exact:true}).first()).toBeVisible();await page.getByRole('button',{name:'Use this revision after manual reconciliation; keep my text'}).click();await page.getByRole('button',{name:'Save',exact:true}).click();await expect(page.getByRole('status').filter({hasText:/^Saved$/})).toBeVisible();
  await page.getByRole('button',{name:'Submit for Review'}).click();await expect(page.getByText(/Primary Interpretation · in review/)).toBeVisible();await page.getByRole('button',{name:'Withdraw Review'}).click();await expect(page.getByText(/Primary Interpretation · draft/)).toBeVisible();
  await page.getByRole('button',{name:'History / Compare'}).click();await expect(page.getByRole('heading',{name:'Revision history and attribution'})).toBeVisible();await page.screenshot({path:info.outputPath('history.png'),fullPage:true});
  await page.getByRole('button',{name:'Finalize',exact:true}).click();await page.getByRole('button',{name:'Confirm and Sign'}).click();await expect(page.getByLabel('Findings',{exact:true})).toHaveAttribute('readonly','');await expect(page.getByText(/Signed by: Dr E2E Non-Supervisor/)).toBeVisible();
  const signedUid=(await db.query("select primary_study_uid from native_reports where status='final' limit 1")).rows[0].primary_study_uid;
  const catalogueResponse=await page.request.get('/api/native-reporting/workspace/studies?'+new URLSearchParams({q:signedUid,status:'final'}));expect(catalogueResponse.ok()).toBeTruthy();
  const catalogue=await catalogueResponse.json();expect(catalogue.total).toBe(1);expect(catalogue.studies[0].reporting_status).toBe('final');expect(catalogue.studies[0].external_reporting_status).toBe('unknown');
  const print=await page.request.get(new URL(await page.getByRole('link',{name:'Print',exact:true}).getAttribute('href')||'',page.url()).href);expect(print.ok()).toBeTruthy();expect(await print.text()).toContain('Retained conflicting local text');
  // A late transcription is cancelled when navigating to another report.
  await other.reload();await other.getByRole('link',{name:'All study reports'}).click();await other.getByLabel('Report type',{exact:true}).selectOption('second_opinion');await other.getByRole('button',{name:'Create Report',exact:true}).click();await expect(other.getByLabel('Findings',{exact:true})).toBeEditable();
  await db.query(`update system_settings set setting_value=setting_value || '{"allowedTypes":["peer_review"]}'::jsonb where category='doctor_workspace' and setting_key='reporting_policy'`);
  await other.getByRole('link',{name:'All study reports'}).click();await expect(other.getByLabel('Report type',{exact:true})).toHaveValue('peer_review');await other.getByRole('button',{name:'Create Report',exact:true}).click();await expect(other.getByLabel('Findings',{exact:true})).toBeEditable();
  await db.query(`update system_settings set setting_value=setting_value || '{"additional":"addenda"}'::jsonb where category='doctor_workspace' and setting_key='reporting_policy'`);
  await other.getByRole('link',{name:'All study reports'}).click();await expect(other.getByRole('button',{name:'Create Report',exact:true})).toBeDisabled();await expect(other.getByText('Current policy allows signed addenda only.',{exact:false})).toBeVisible();
  await db.query(`update system_settings set setting_value=setting_value || '{"additional":"typed","allowedTypes":["primary","second_opinion","additional_interpretation","peer_review"]}'::jsonb where category='doctor_workspace' and setting_key='reporting_policy'`);
  await page.setViewportSize({width:390,height:844});await page.goto('/doctor/reporting?q='+prefix+'&offset=200');await expect(page.getByRole('link',{name:'Open Reports'}).first()).toBeVisible();await page.screenshot({path:info.outputPath('mobile-catalogue.png'),fullPage:true});
  await page.getByRole('cell').filter({hasText:'No RISpro Report'}).first().scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('mobile-reporting-status.png')});
  await page.goto('/doctor/home');await expect(page.getByText('My active drafts',{exact:true})).toBeVisible();await page.screenshot({path:info.outputPath('mobile-home.png'),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();
  expect(pixels).toEqual([]);await second.close();
  await db.query(`update system_settings set setting_value=setting_value || '{"enabled":false}'::jsonb where category='doctor_workspace' and setting_key='reporting_policy'`);
  await page.goto(reportUrl);await expect(page.getByLabel('Findings',{exact:true})).toHaveValue('Retained conflicting local text');await expect(page.getByLabel('Findings',{exact:true})).toHaveAttribute('readonly','');
});
