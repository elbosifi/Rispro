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
let db:pg.Pool,archive:Server,archiveOrigin='',transcript='dictated finding',delayTranscription=false,archiveUnavailable=false;
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
    if(archiveUnavailable){res.statusCode=503;res.end('{}');return;}
    if(url.pathname==='/changes'){res.end(JSON.stringify({Changes:[],Last:0,Done:true}));return;}
    if(url.pathname==='/statistics'){res.end(JSON.stringify({CountStudies:215}));return;}
    if(url.pathname==='/dicom-web/studies'){
      const matches=studies.filter(s=>(!url.searchParams.get('AccessionNumber')||s.accession===url.searchParams.get('AccessionNumber'))&&(!url.searchParams.get('PatientID')||s.patient===url.searchParams.get('PatientID'))).slice(Number(url.searchParams.get('offset')||0),Number(url.searchParams.get('offset')||0)+100);
      res.end(JSON.stringify(matches.map(s=>({'0020000D':{vr:'UI',Value:[s.uid]},'00100020':{vr:'LO',Value:[s.patient]},'00100010':{vr:'PN',Value:[{Alphabetic:s.name}]},'00080050':{vr:'SH',Value:[s.accession]},'00080061':{vr:'CS',Value:['CT']},'00080020':{vr:'DA',Value:[e2eTodayInTripoli().replaceAll('-','')]},'00081030':{vr:'LO',Value:['Synthetic CT']}}))));return;
    }
    const s=studies.find(s=>url.pathname==='/studies/'+s.id);
    if(s){if(archiveUnavailable){res.statusCode=503;res.end('{}');return;}res.end(JSON.stringify({ID:s.id,MainDicomTags:{StudyInstanceUID:s.uid,AccessionNumber:s.accession,StudyDate:e2eTodayInTripoli().replaceAll('-',''),StudyDescription:'Synthetic CT',ModalitiesInStudy:'CT'},PatientMainDicomTags:{PatientID:s.patient,PatientName:s.name},Series:['synthetic-series']}));return;}
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
  const pixels:string[]=[];page.on('request',r=>{if(!r.url().endsWith('/api/ohif/availability')&&/\/frames\/|\/wado|\/ohif\/|\/ohif-dicomweb\//i.test(r.url()))pixels.push(r.url());});
  await page.goto('/doctor/reporting?q='+prefix+'&offset=200');
  await expect(page.getByRole('heading',{name:'Reporting',exact:true})).toBeVisible();await expect(page.getByText('201–215 of 215')).toBeVisible();
  await expect(page.getByRole('cell').filter({hasText:'No RISpro'})).toHaveCount(15);
  await expect(page.getByRole('cell').filter({hasText:'Sonic: Off'})).toHaveCount(15);
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
  transcript='dictation retained before navigation';delayTranscription=true;
  await findings.focus();const pendingTranscript=page.waitForRequest('**/api/medical-dictation/transcribe');
  await page.keyboard.down('F9');await expect(page.getByRole('button',{name:'Stop dictation',exact:true})).toBeVisible();await page.waitForTimeout(650);await page.keyboard.up('F9');await pendingTranscript;
  await page.getByRole('link',{name:'Back to Reporting Worklist'}).click();await expect(page).toHaveURL(new RegExp('offset=200'));await expect(page.getByText('201–215 of 215')).toBeVisible();
  await page.goto(reportUrl);
  await expect(page.getByLabel('Findings',{exact:true})).toHaveValue(/Dictation retained before navigation/);delayTranscription=false;
  const second=await browser.newContext({baseURL:'http://127.0.0.1:5173'}),other=await second.newPage();await signInWithSession(other,'e2e_doctor_other');await other.goto(reportUrl);
  await other.getByLabel('Findings',{exact:true}).fill('Second doctor findings');await other.getByRole('button',{name:'Save',exact:true}).click();await expect(other.getByRole('status').filter({hasText:/^Saved$/})).toBeVisible();
  await page.getByLabel('Findings',{exact:true}).fill('Retained conflicting local text');await page.getByRole('button',{name:'Save',exact:true}).click();await expect(page.getByText('Your unsaved text is retained.',{exact:false}).first()).toBeVisible();await expect(page.getByLabel('Findings',{exact:true})).toHaveValue('Retained conflicting local text');
  await page.getByRole('button',{name:'Compare saved report'}).click();await expect(page.getByText('Second doctor findings',{exact:true}).first()).toBeVisible();await page.getByRole('button',{name:'Use this revision after manual reconciliation; keep my text'}).click();await page.getByRole('button',{name:'Save',exact:true}).click();await expect(page.getByRole('status').filter({hasText:/^Saved$/})).toBeVisible();
  await page.getByRole('button',{name:'Submit for Review'}).click();await expect(page.getByText(/Primary Interpretation · in review/)).toBeVisible();await page.getByRole('button',{name:'Withdraw Review'}).click();await expect(page.getByText(/Primary Interpretation · draft/)).toBeVisible();
  await page.getByRole('button',{name:'History / Compare'}).click();await expect(page.getByRole('heading',{name:'Revision history and attribution'})).toBeVisible();await page.screenshot({path:info.outputPath('history.png'),fullPage:true});
  await page.getByRole('button',{name:'Finalize',exact:true}).click();await page.getByRole('button',{name:'Confirm and Sign'}).click();await expect(page.getByLabel('Findings',{exact:true})).toHaveAttribute('readonly','');await expect(page.getByText(/Signed by: Dr E2E Non-Supervisor/)).toBeVisible();
  const signedUid=(await db.query("select primary_study_uid from native_reports where status='final' limit 1")).rows[0].primary_study_uid;
  const catalogueResponse=await page.request.get('/api/native-reporting/workspace/studies?'+new URLSearchParams({q:signedUid,status:'final'}));expect(catalogueResponse.ok()).toBeTruthy();
  const catalogue=await catalogueResponse.json();expect(catalogue.total).toBe(1);expect(catalogue.studies[0].reporting_status).toBe('final');expect(catalogue.studies[0].external_reporting_status).toBe('external_disabled');
  const print=await page.request.get(new URL(await page.getByRole('link',{name:'Print',exact:true}).getAttribute('href')||'',page.url()).href);expect(print.ok()).toBeTruthy();expect(await print.text()).toContain('Retained conflicting local text');
  // A late transcription is cancelled when navigating to another report.
  await other.reload();await other.getByRole('link',{name:'All study reports'}).click();await other.getByLabel('Report type',{exact:true}).selectOption('second_opinion');await other.getByRole('button',{name:'Create Report',exact:true}).click();await expect(other.getByLabel('Findings',{exact:true})).toBeEditable();
  await db.query(`update system_settings set setting_value=setting_value || '{"allowedTypes":["peer_review"]}'::jsonb where category='doctor_workspace' and setting_key='reporting_policy'`);
  await other.getByRole('link',{name:'All study reports'}).click();await expect(other.getByLabel('Report type',{exact:true})).toHaveValue('peer_review');await other.getByRole('button',{name:'Create Report',exact:true}).click();await expect(other.getByLabel('Findings',{exact:true})).toBeEditable();
  await db.query(`update system_settings set setting_value=setting_value || '{"additional":"addenda"}'::jsonb where category='doctor_workspace' and setting_key='reporting_policy'`);
  await other.getByRole('link',{name:'All study reports'}).click();await expect(other.getByRole('button',{name:'Create Report',exact:true})).toBeDisabled();await expect(other.getByText('Current policy allows signed addenda only.',{exact:false})).toBeVisible();
  await db.query(`update system_settings set setting_value=setting_value || '{"additional":"typed","allowedTypes":["primary","second_opinion","additional_interpretation","peer_review"]}'::jsonb where category='doctor_workspace' and setting_key='reporting_policy'`);
  await page.setViewportSize({width:390,height:844});await page.goto('/doctor/reporting?q='+prefix+'&offset=200');await expect(page.getByRole('link',{name:'Open Reports'}).first()).toBeVisible();await page.screenshot({path:info.outputPath('mobile-catalogue.png'),fullPage:true});
  await page.getByRole('cell').filter({hasText:'No RISpro'}).first().scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('mobile-reporting-status.png')});
  await page.goto('/doctor/home');await expect(page.getByText('My active drafts',{exact:true})).toBeVisible();await page.screenshot({path:info.outputPath('mobile-home.png'),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();
  expect(pixels).toEqual([]);await second.close();
  await db.query(`update system_settings set setting_value=setting_value || '{"enabled":false}'::jsonb where category='doctor_workspace' and setting_key='reporting_policy'`);
  await page.goto(reportUrl);await expect(page.getByLabel('Findings',{exact:true})).toHaveValue('Retained conflicting local text');await expect(page.getByLabel('Findings',{exact:true})).toHaveAttribute('readonly','');
});

test('Round 2: report-free viewer launch, appointments, cached return, save failure, responsive worklist and editor return',async({page,context},info)=>{
  test.setTimeout(150_000);page.setDefaultTimeout(15_000);
  await page.setViewportSize({width:1600,height:1000});
  await db.query(`update system_settings set setting_value=setting_value || '{"enabled":true}'::jsonb where category='doctor_workspace' and setting_key='reporting_policy'`);
  await db.query("update ohif_viewer_settings set enabled=true,access_strategy='authoritative_orthanc',allow_prior_studies=false,open_mode='new_tab' where singleton_key=true");
  await signInWithSession(page,'e2e_doctor_non_supervisor');
  // Exercise the real launch endpoint and token exchange. The diagnostic viewer
  // document is synthetic; this test does not claim diagnostic-frame validation.
  await context.route('**/api/ohif/launch/**',async route=>{
    const response=await route.fetch({maxRedirects:0});expect(response.status()).toBe(302);expect(response.headers().location).toContain('/ohif/viewer?');
    await route.fulfill({status:200,contentType:'text/html',body:'<h1>Synthetic diagnostic viewer</h1>'});
  });
  const before=Number((await db.query('select count(*) n from native_reports')).rows[0].n);
  const url='/doctor/reporting?'+new URLSearchParams({q:prefix,offset:'200',modality:'CT',status:'all',sort:'patient',direction:'asc',from:e2eTodayInTripoli(),to:e2eTodayInTripoli()});
  let catalogueRequests=0;page.on('request',r=>{if(r.url().includes('/api/native-reporting/workspace/studies?'))catalogueRequests++;});
  await page.goto(url);await expect(page.getByRole('button',{name:'PACS Studies',exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.getByText('201–215 of 215')).toBeVisible();
  const height=await page.locator('tbody tr').first().evaluate(e=>e.getBoundingClientRect().height);expect(height).toBeLessThanOrEqual(48);
  await page.screenshot({path:info.outputPath('round2-desktop-pacs.png'),fullPage:true});
  const requestsBefore=catalogueRequests;
  await page.locator('main').evaluate(e=>{e.scrollTop=100;});
  const top=await page.locator('main').evaluate(e=>e.scrollTop);
  await page.getByRole('link',{name:'Open Reports',exact:true}).first().click();await expect(page.getByRole('heading',{name:'Study reports'})).toBeVisible();
  await page.getByRole('link',{name:'Back to Reporting Worklist'}).click();await expect(page.getByText('201–215 of 215')).toBeVisible();expect(catalogueRequests).toBe(requestsBefore);
  const returnRequests=catalogueRequests-requestsBefore;
  expect(await page.locator('main').evaluate(e=>e.scrollTop)).toBe(top);
  // Delaying authorization proves that Chromium receives a synchronous blank tab.
  await page.route('**/workspace/studies/*/images-launch',async route=>{await new Promise(r=>setTimeout(r,500));await route.continue();});
  const popupPromise=page.waitForEvent('popup');await page.getByRole('button',{name:'View Images',exact:true}).first().click();const popup=await popupPromise;
  await expect(popup.getByRole('heading',{name:'Synthetic diagnostic viewer'})).toBeVisible();await popup.close();
  expect(Number((await db.query('select count(*) n from native_reports')).rows[0].n)).toBe(before);
  // A blocked popup must not issue a launch request or retain a token in the UI.
  await page.evaluate(()=>{window.open=()=>null;});await page.getByRole('button',{name:'View Images',exact:true}).first().click();await expect(page.getByText('The browser blocked the OHIF tab.',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:'Open images in this tab'})).toBeVisible();
  await page.getByRole('button',{name:'Open images in this tab'}).click();await expect(page.getByRole('heading',{name:'Synthetic diagnostic viewer'})).toBeVisible();
  await page.goto(url);await expect(page.getByText('201–215 of 215')).toBeVisible();
  const sample=studies[214],patient=(await db.query("insert into patients(arabic_full_name,english_full_name,normalized_arabic_name,identifier_type,identifier_value,age_years,sex) values($1,$1,$1,'other',$2,40,'O') returning id",[prefix+' appointment',sample.patient])).rows[0].id;
  const version=(await db.query('select id from appointments_v2.policy_versions order by id limit 1')).rows[0].id;
  const ct=(await db.query("select id from modalities where code='CT'")).rows[0].id;
  const doctor=(await db.query("select d.id from doctor_portal.doctor_profiles d join users u on u.id=d.user_id where u.username='e2e_doctor_non_supervisor'")).rows[0].id;
  const bookings=(await db.query("insert into appointments_v2.bookings(patient_id,modality_id,booking_date,case_category,status,requires_report,policy_version_id,study_instance_uid) values($1,$2,$3,'non_oncology','completed',true,$4,$5),($1,$2,$3,'non_oncology','scheduled',true,$4,null) returning id",[patient,ct,e2eTodayInTripoli(),version,sample.uid])).rows;
  // The synthetic Board reader reflects seeded states. Explicit verified absence
  // keeps its periodic worker from turning this native-report fixture unavailable.
  await db.query(`insert into doctor_portal.reporting_board_sonicdicom_cache(appointment_id,report_status,last_success_at,next_check_at,study_instance_uid_snapshot,accession_number_snapshot)
    select id,'no_report',now(),now()+interval '1 day',study_instance_uid,'V2-'||lpad(id::text,6,'0') from appointments_v2.bookings where id=any($1::bigint[])
    on conflict(appointment_id) do update set report_status='no_report',last_success_at=now(),next_check_at=now()+interval '1 day',last_error=null,failure_count=0`,[bookings.map(b=>b.id)]);
  for(const b of bookings)await db.query("insert into doctor_portal.case_team_assignments(appointment_id,assigned_doctor_id,modality_id,assignment_type,status) values($1,$2,$3,'reporting','active')",[b.id,doctor,ct]);
  sample.accession='V2-'+String(bookings[0].id).padStart(6,'0');await db.query('update historical_pacs_studies set accession_number=$2 where orthanc_study_id=$1',[sample.id,sample.accession]);
  await db.query(`update system_settings set setting_value=jsonb_set(setting_value,'{value,enabledModalityCodes}','["E2E_CT","CT"]'::jsonb) where category='doctor_portal_reporting_board' and setting_key='config'`);
  await page.goto('/doctor/my-work');await expect(page.getByRole('button',{name:'View Images',exact:true}).first()).toBeEnabled();
  const assignedPopupPromise=page.waitForEvent('popup');await page.getByRole('button',{name:'View Images',exact:true}).first().click();const assignedPopup=await assignedPopupPromise;await expect(assignedPopup.getByRole('heading',{name:'Synthetic diagnostic viewer'})).toBeVisible();await assignedPopup.close();
  await page.goto(url);await expect(page.getByRole('button',{name:'PACS Studies',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'RISpro Appointments',exact:true}).click();await expect(page.getByText('Not in PACS / Study Not Linked',{exact:true})).toBeVisible();await expect(page.getByText('Linked PACS Study',{exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'Open Reports',exact:true})).toHaveCount(1);await page.screenshot({path:info.outputPath('round2-desktop-appointments.png'),fullPage:true});
  await page.getByRole('button',{name:'View Appointment',exact:true}).first().click();await expect(page.getByRole('complementary',{name:'Appointment and patient details'})).toBeVisible();await page.getByRole('button',{name:'Close appointment and patient details',exact:true}).last().click();
  await page.getByRole('link',{name:'Open Reports',exact:true}).click();await expect(page.getByRole('heading',{name:'Study reports'})).toBeVisible();await page.getByRole('button',{name:'Create Report',exact:true}).click();await expect(page.getByLabel('Findings',{exact:true})).toBeEditable();
  await page.getByLabel('Findings',{exact:true}).fill('Save before opening images');
  const editorPopupPromise=page.waitForEvent('popup');await page.getByRole('button',{name:'Open Images in OHIF'}).click();const editorPopup=await editorPopupPromise;await expect(editorPopup.getByRole('heading',{name:'Synthetic diagnostic viewer'})).toBeVisible();await editorPopup.close();await expect(page.getByRole('status').filter({hasText:/^Saved$/})).toBeVisible();
  await page.route('**/reports/*/draft',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Synthetic save failure'})}));
  await page.getByLabel('Findings',{exact:true}).fill('Round 2 retained clinical text');await page.getByRole('button',{name:'Save',exact:true}).click();await expect(page.getByRole('status').filter({hasText:/^Save Failed$/})).toBeVisible();await page.getByRole('link',{name:'Back to Reporting Worklist'}).click();await expect(page.getByLabel('Findings',{exact:true})).toHaveValue('Round 2 retained clinical text');
  await page.unroute('**/reports/*/draft');await page.getByRole('link',{name:'Back to Reporting Worklist'}).click();await expect(page.getByText('Draft',{exact:true}).last()).toBeVisible();expect(new URL(page.url()).searchParams.get('view')).toBe('appointments');
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{window.scrollTo(0,0);document.querySelector('[aria-label="RISpro appointments table"]')?.scrollTo(0,0);});await page.screenshot({path:info.outputPath('round2-mobile-appointments.png'),fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.getByRole('button',{name:'PACS Studies',exact:true}).click();await expect(page.getByRole('button',{name:'PACS Studies',exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.locator('[aria-label="PACS studies table"] tbody tr').first()).toBeVisible();await page.evaluate(()=>{window.scrollTo(0,0);document.querySelector('[aria-label="PACS studies table"]')?.scrollTo(0,0);});await page.screenshot({path:info.outputPath('round2-mobile-pacs.png'),fullPage:true});
  await page.getByRole('button',{name:'View Images',exact:true}).first().scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('round2-mobile-image-actions.png')});
  await page.setViewportSize({width:820,height:1180});await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>{window.scrollTo(0,0);document.querySelector('[aria-label="PACS studies table"]')?.scrollTo(0,0);requestAnimationFrame(()=>resolve());})));await page.screenshot({path:info.outputPath('round2-tablet-pacs.png'),fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  // The configured same-tab mode reuses the current browser tab.
  await db.query("update ohif_viewer_settings set open_mode='same_tab' where singleton_key=true");await page.reload();const tabs=context.pages().length;
  await page.getByRole('button',{name:'View Images',exact:true}).first().click();await expect(page.getByRole('heading',{name:'Synthetic diagnostic viewer'})).toBeVisible();expect(context.pages().length).toBe(tabs);
  writeFileSync(info.outputPath('round2-evidence.json'),JSON.stringify({rowHeight:height,cachedReturnRequests:returnRequests,reportFreeLaunch:true,appointmentRows:2,popup:true,sameTab:true}));
});

test('Round 3: personal review labels, recovery conflicts and read/print during an Orthanc outage',async({page,browser},info)=>{
  test.setTimeout(90_000);
  await db.query(`update system_settings set setting_value=setting_value || '{"enabled":true}'::jsonb where category='doctor_workspace' and setting_key='reporting_policy'`);
  await db.query('update historical_pacs_sync_state set last_success_at=now(),last_error=null');
  await signInWithSession(page,'e2e_doctor_non_supervisor');
  const second=await browser.newContext({baseURL:'http://127.0.0.1:5173'}),other=await second.newPage();await signInWithSession(other,'e2e_doctor_other');
  const reviewer=(await db.query("select d.id,d.user_id from doctor_portal.doctor_profiles d join users u on u.id=d.user_id where u.username='e2e_doctor_other'")).rows[0];
  const signer=(await db.query("select id from users where username='e2e_doctor_non_supervisor'")).rows[0].id;
  const base='/api/native-reporting',sections={clinicalHistory:'Synthetic',comparison:'None',technique:'CT',findings:'Round 3 preserved findings',impression:'Round 3 preserved impression'};
  async function create(i:number) {const response=await page.request.post(base+'/workspace/studies/'+studies[i].id+'/reports',{data:{mode:'shared',requestId:randomUUID()}});expect(response.status(),await response.text()).toBe(201);return response.json();}
  // The integration suite exercises real failure/recovery cycles. Keep this
  // browser fixture's controlled sync state stable across periodic worker ticks.
  const syncGuard=await db.connect();await syncGuard.query('select pg_advisory_lock(712364092)');
  try {
    const baseline=await (await other.request.get(base+'/workspace/dashboard?days=1')).json();
    let draft=await create(50);
    draft=await (await page.request.put(base+'/reports/'+draft.id+'/draft',{data:{expectedRevision:draft.revision,sections}})).json();
    const submit=await page.request.post(base+'/reports/'+draft.id+'/review',{data:{expectedRevision:draft.revision,action:'submit',preferredReviewerId:Number(reviewer.id)}});expect(submit.status()).toBe(200);
    await other.goto('/doctor/home');await expect(other.getByText('Review requests designated to me')).toBeVisible();
    const designated=other.getByText('Review requests designated to me').locator('..');await expect(designated.locator('dd')).toHaveText(String(baseline.workload.awaiting_review+1));
    await expect(other.getByText('RISpro reports signed by me')).toBeVisible();await expect(other.getByText('Open review requests available to me:',{exact:false})).toBeVisible();
    await other.screenshot({path:info.outputPath('round3-desktop-dashboard.png'),fullPage:true});
    await other.setViewportSize({width:390,height:844});await other.screenshot({path:info.outputPath('round3-mobile-dashboard.png'),fullPage:true});expect(await other.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    let signed=await create(51);signed=await (await page.request.put(base+'/reports/'+signed.id+'/draft',{data:{expectedRevision:signed.revision,sections}})).json();
    const signature=await page.request.post(base+'/reports/'+signed.id+'/finalize',{data:{expectedRevision:signed.revision,confirmed:true,signerUserId:Number(signer),requestId:randomUUID()}});expect(signature.status(),await signature.text()).toBe(200);signed=await signature.json();
    let removed=await create(52);const deletion=await page.request.post(base+'/reports/'+removed.id+'/delete',{data:{expectedRevision:removed.revision,confirmed:true,reason:'Synthetic deletion'}});expect(deletion.status()).toBe(200);removed=await deletion.json();
    const replacement=await create(52);expect(replacement.id).not.toBe(removed.id);
    const supervisor=await browser.newContext({baseURL:'http://127.0.0.1:5173'}),manager=await supervisor.newPage();await signInWithSession(manager,'e2e_supervisor');
    try{const recovery=await manager.request.post(base+'/reports/'+removed.id+'/recover',{data:{expectedRevision:removed.revision,confirmed:true,reason:'Synthetic recovery'}});expect(recovery.status()).toBe(409);expect(await recovery.text()).toContain('replacement report');}finally{await supervisor.close();}
    await db.query("update historical_pacs_sync_state set last_error='Synthetic Orthanc outage',last_success_at=now()-interval '1 hour'");archiveUnavailable=true;
    await page.goto('/doctor/reporting?q='+prefix);await expect(page.getByText('Cached metadata may be outdated.',{exact:false})).toBeVisible();await expect(page.locator('tbody tr').first()).toBeVisible();await page.screenshot({path:info.outputPath('round3-stale-catalogue.png'),fullPage:true});
    await page.goto('/doctor/reporting/reports/'+signed.id);await expect(page.getByLabel('Findings',{exact:true})).toHaveValue(sections.findings);await expect(page.getByText('Read Only / Finalized',{exact:true})).toBeVisible();
    const print=await page.request.get(base+'/reports/'+signed.id+'/print');expect(print.status()).toBe(200);expect(await print.text()).toContain(sections.impression);await page.screenshot({path:info.outputPath('round3-outage-signed-report.png'),fullPage:true});
    await page.goto('/doctor/reporting/reports/'+replacement.id);await expect(page.getByLabel('Findings',{exact:true})).toHaveAttribute('readonly','');await expect(page.getByRole('button',{name:'Finalize',exact:true})).toBeDisabled();
    expect((await page.request.post(base+'/reports/'+replacement.id+'/finalize',{data:{expectedRevision:replacement.revision,confirmed:true,signerUserId:Number(signer),requestId:randomUUID()}})).status()).toBe(409);
    await db.query('update historical_pacs_sync_state set last_success_at=now(),last_error=null');
    // A fresh timestamp cannot replace live identity verification while Orthanc is still down.
    const unverified=await page.request.post(base+'/reports/'+replacement.id+'/finalize',{data:{expectedRevision:replacement.revision,confirmed:true,signerUserId:Number(signer),requestId:randomUUID()}});
    // Empty content is rejected before live verification; provide saved clinical text first.
    expect(unverified.status()).toBe(400);
    await page.request.put(base+'/reports/'+replacement.id+'/draft',{data:{expectedRevision:replacement.revision,sections}});
    const saved=await (await page.request.get(base+'/reports/'+replacement.id)).json();
    const unavailable=await page.request.post(base+'/reports/'+replacement.id+'/finalize',{data:{expectedRevision:saved.revision,confirmed:true,signerUserId:Number(signer),requestId:randomUUID()}});expect(unavailable.status()).toBe(503);expect(await unavailable.text()).toContain('Live archive verification is unavailable');
    archiveUnavailable=false;await page.reload();await expect(page.getByLabel('Findings',{exact:true})).toBeEditable();await expect(page.getByLabel('Findings',{exact:true})).toHaveValue(sections.findings);
    writeFileSync(info.outputPath('round3-evidence.json'),JSON.stringify({designatedReviews:true,recoveryConflict:true,staleBrowsing:true,signedPrint:true,staleSigningRejected:409,unverifiedSigningRejected:503,recoveredWithoutRestart:true}));
  }finally{archiveUnavailable=false;await db.query('update historical_pacs_sync_state set last_success_at=now(),last_error=null');await syncGuard.query('select pg_advisory_unlock(712364092)');syncGuard.release();await second.close();}
});

test('Round 3 PACS: 50 studies, historical search, compact SonicDICOM states and preserved filters',async({page},info)=>{
  await signInWithSession(page,'e2e_doctor_non_supervisor');
  const original=(await db.query("select setting_value from system_settings where category='sonicdicom_reports' and setting_key='config'")).rows[0].setting_value;
  try {
    await db.query("update system_settings set setting_value=$1 where category='sonicdicom_reports' and setting_key='config'",[JSON.stringify({sonicDicomReportsEnabled:true,sonicDicomSqlEnabled:true,sonicDicomSqlServer:'synthetic-offline-only.invalid',sonicDicomSqlTimeoutMs:200})]);
    await db.query('update historical_pacs_studies set study_date=$2 where orthanc_study_id=$1',[studies[100].id,'20991231']);
    await db.query('update historical_pacs_studies set study_date=$2 where orthanc_study_id=$1',[studies[101].id,'19900101']);
    await db.query('update historical_pacs_studies set study_date=$2 where orthanc_study_id=$1',[studies[102].id,'20260230']);
    const response=await page.request.get('/api/native-reporting/workspace/studies');expect(response.status()).toBe(200);const first=await response.json();expect(first.total).toBe(215);expect(first.limit).toBe(50);expect(first.studies).toHaveLength(50);expect(first.studies[0].orthanc_study_id).toBe(studies[100].id);
    for(const [i,status] of ['final','draft','no_report','final'].entries())await db.query(`update doctor_portal.workspace_sonicdicom_cache set report_status=$2,last_success_at=now(),last_attempt_at=now(),next_check_at=now()+interval '1 day',last_error=$3 where orthanc_study_id=$1`,[first.studies[i].orthanc_study_id,status,i===3?'Synthetic unavailable; last final retained':null]);
    const userId=(await db.query("select id from users where username='e2e_doctor_non_supervisor'")).rows[0].id;await page.addInitScript(id=>localStorage.setItem('rispro.reporting.preferences.'+id,JSON.stringify({status:'unknown'})),userId);
    await page.goto('/doctor/reporting');
    await expect(page.getByText('1–50 of 215')).toBeVisible();await expect(page.getByRole('cell',{name:'Sonic: Final',exact:false}).first()).toBeVisible();
    for(const text of ['Sonic: Draft','Sonic: None','Sonic: Unavailable','No RISpro'])await expect(page.getByText(text,{exact:true}).first()).toBeVisible();
    const height=await page.locator('tbody tr').first().evaluate(e=>e.getBoundingClientRect().height);expect(height).toBeLessThanOrEqual(48);
    await page.screenshot({path:info.outputPath('round3-pacs-50-desktop.png'),fullPage:true});
    await page.getByRole('button',{name:'Next',exact:true}).click();await expect(page.getByText('51–100 of 215')).toBeVisible();
    await page.getByRole('button',{name:'Previous',exact:true}).click();await expect(page.getByText('1–50 of 215')).toBeVisible();
    const old=await page.request.get('/api/native-reporting/workspace/studies?q='+studies[101].uid);expect((await old.json()).total).toBe(1);
    const lastResponse=await page.request.get('/api/native-reporting/workspace/studies?offset=200');expect(lastResponse.status()).toBe(200);const last=await lastResponse.json();expect(last.studies.at(-1).study_date).toBe('20260230');
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:info.outputPath('round3-pacs-50-mobile.png'),fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    writeFileSync(info.outputPath('round3-pacs-evidence.json'),JSON.stringify({defaultLimit:50,total:215,rowHeight:height,newestFirst:true,historicalSearch:true,invalidDatesLast:true,sonicStatuses:true}));
  }finally{await db.query("update system_settings set setting_value=$1 where category='sonicdicom_reports' and setting_key='config'",[JSON.stringify(original)]);}
});
