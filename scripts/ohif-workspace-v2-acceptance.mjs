import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {networkInterfaces} from 'node:os';
import {randomBytes,randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';

// Called only by the existing disposable-DB/real-Orthanc browser harness.
export async function prepareWorkspaceV2({pool,temp}) {
  assert.equal((await pool.query('select current_database() db')).rows[0].db,'rispro_test');
  const policy=(await pool.query("select setting_value from system_settings where category='doctor_workspace' and setting_key='reporting_policy'")).rows[0].setting_value;
  const dictation=(await pool.query('select * from medical_dictation_configuration where id=1')).rows[0];
  const previousKey=process.env.RISPRO_SECRET_ENCRYPTION_KEY;process.env.RISPRO_SECRET_ENCRYPTION_KEY=randomBytes(32).toString('base64');
  const address=Object.entries(networkInterfaces()).flatMap(([name,rows])=>(rows||[]).filter(r=>r.family==='IPv4'&&!r.internal&&(process.platform!=='win32'||/vEthernet|Docker/i.test(name))&&/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(r.address)).map(r=>r.address))[0];
  assert.ok(address,'An isolated local virtual adapter is required for synthetic MedASR.');
  let transcriptionDelay=0;
  const upstream=createServer((req,res)=>{req.resume();req.on('end',()=>{const delay=req.url==='/health'?0:transcriptionDelay;transcriptionDelay=0;setTimeout(()=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url==='/health'?{status:'ready',model:'Synthetic OHIF MedASR'}:{text:'OHIF dictated finding',processing_seconds:0.1}));},delay);});});
  await new Promise(r=>upstream.listen(0,address,r));
  const cleanup=async()=>{
    await pool.query("update system_settings set setting_value=$1 where category='doctor_workspace' and setting_key='reporting_policy'",[JSON.stringify(policy)]);
    await pool.query('update medical_dictation_configuration set enabled=$1,base_url=$2,timeout_seconds=$3,allow_insecure_http=$4,api_key_secret=$5 where id=1',[dictation.enabled,dictation.base_url,dictation.timeout_seconds,dictation.allow_insecure_http,dictation.api_key_secret]);
    await pool.query('update historical_pacs_sync_state set source_archive_key=null,last_success_at=null');
    await new Promise(r=>{upstream.closeAllConnections();upstream.close(r);});
    if(previousKey===undefined)delete process.env.RISPRO_SECRET_ENCRYPTION_KEY;else process.env.RISPRO_SECRET_ENCRYPTION_KEY=previousKey;
  };
  try {
  await pool.query('update medical_dictation_configuration set enabled=true,base_url=$1,allow_insecure_http=true,timeout_seconds=10,api_key_secret=null where id=1',['http://'+address+':'+upstream.address().port]);
  await pool.query("update system_settings set setting_value=setting_value || '{\"enabled\":true}'::jsonb where category='doctor_workspace' and setting_key='reporting_policy'");
  const {runHistoricalPacsSyncCycle}=await import('../src/services/historical-pacs-index-service.ts');
  const sync=await runHistoricalPacsSyncCycle(undefined,{forceFull:true});assert.equal(sync.mode,'full');
  const samples=48000,audio=Buffer.alloc(44+samples*2),audioPath=join(temp,'synthetic-dictation.wav');
  audio.write('RIFF');audio.writeUInt32LE(audio.length-8,4);audio.write('WAVEfmt ',8);audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);audio.writeUInt32LE(48000,24);audio.writeUInt32LE(96000,28);audio.writeUInt16LE(2,32);audio.writeUInt16LE(16,34);audio.write('data',36);audio.writeUInt32LE(samples*2,40);for(let i=0;i<samples;i++)audio.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*440/48000)*8000),44+i*2);writeFileSync(audioPath,audio);
  return {audioPath,cleanup,delayNextTranscription:()=>{transcriptionDelay=1200;}};
  }catch(error){await cleanup();throw error;}
}
export async function runWorkspaceV2Panel({page,panel,context,origin,c,temp,fixture}) {
  const contextId=new URL(page.url()).searchParams.get('risproContext');
  const readContext=async()=>{const response=await context.request.get(origin+'/api/native-reporting/contexts/'+contextId);assert.equal(response.status(),200);return response.json();};
  let authorized=await readContext();assert.equal(authorized.v2,true);const primary=authorized.report;assert.ok(primary?.id);
  const created=await context.request.post(origin+'/api/native-reporting/workspace/studies/'+authorized.studyKey+'/reports',{data:{mode:'independent',reportType:'second_opinion',requestId:randomUUID()}});assert.equal(created.status(),201);const second=await created.json();assert.notEqual(second.id,primary.id);
  await page.reload();await page.getByRole('button',{name:'Report',exact:true}).first().click();
  const picker=panel.getByLabel('Report selection');await picker.selectOption(String(second.id));
  await page.waitForFunction(id=>document.querySelector('.rispro-report')?.getAttribute('data-dictation-context')===`native-report:${id}:draft`,second.id);
  await panel.getByLabel('Findings',{exact:true}).fill('SYNTHETIC independent second interpretation.');await panel.getByLabel('Impression',{exact:true}).fill('SYNTHETIC independent impression.');await panel.getByRole('button',{name:'Save',exact:true}).click();await panel.getByRole('status').filter({hasText:/^Saved$/}).waitFor();
  await picker.selectOption(String(primary.id));
  await page.waitForFunction(id=>document.querySelector('.rispro-report')?.getAttribute('data-dictation-context')===`native-report:${id}:draft`,primary.id);
  await panel.getByLabel('Findings',{exact:true}).fill('Before after');await panel.getByRole('button',{name:'Save',exact:true}).click();await panel.getByRole('status').filter({hasText:/^Saved$/}).waitFor();
  const findings=panel.getByLabel('Findings',{exact:true});await findings.focus();await findings.evaluate(el=>el.setSelectionRange(7,7));
  await panel.getByRole('button',{name:'Dictate into Field',exact:true}).click();await panel.getByRole('button',{name:'Stop Dictation',exact:true}).waitFor();await page.waitForTimeout(1000);
  const response=page.waitForResponse('**/api/medical-dictation/transcribe');await panel.getByRole('button',{name:'Stop Dictation',exact:true}).click();assert.equal((await response).status(),200);
  await page.waitForFunction(()=>document.querySelector('textarea[aria-label="Findings"]')?.value==='Before OHIF dictated finding after');
  await panel.getByRole('button',{name:'Save',exact:true}).click();await panel.getByRole('status').filter({hasText:/^Saved$/}).waitFor();
  fixture.delayNextTranscription();await findings.focus();await findings.evaluate(el=>el.setSelectionRange(0,0));
  await panel.getByRole('button',{name:'Dictate into Field',exact:true}).click();await panel.getByRole('button',{name:'Stop Dictation',exact:true}).waitFor();await page.waitForTimeout(600);
  const staleRequest=page.waitForRequest('**/api/medical-dictation/transcribe');await panel.getByRole('button',{name:'Stop Dictation',exact:true}).click();await staleRequest;
  await picker.selectOption(String(second.id));await page.waitForFunction(id=>document.querySelector('.rispro-report')?.getAttribute('data-dictation-context')===`native-report:${id}:draft`,second.id);
  await page.waitForTimeout(1500);assert.equal(await panel.getByLabel('Findings',{exact:true}).inputValue(),'SYNTHETIC independent second interpretation.');
  await picker.selectOption(String(primary.id));await page.waitForFunction(id=>document.querySelector('.rispro-report')?.getAttribute('data-dictation-context')===`native-report:${id}:draft`,primary.id);
  assert.equal(await findings.inputValue(),'Before OHIF dictated finding after');
  await panel.getByRole('button',{name:/^Key Images/}).click();await panel.getByRole('button',{name:'Add Key Image',exact:true}).click();
  await panel.locator('figure img').waitFor();
  const firstReport=await (await context.request.get(origin+'/api/native-reporting/reports/'+primary.id)).json();const independent=await (await context.request.get(origin+'/api/native-reporting/reports/'+second.id)).json();
  assert.equal(firstReport.sections.findings,'Before OHIF dictated finding after');assert.equal(firstReport.keyImages.length,1);assert.equal(independent.keyImages.length,0);assert.equal(independent.sections.findings,'SYNTHETIC independent second interpretation.');
  await page.screenshot({path:join(temp,c.modality+'-v2-selection-key-image.png')});
  await panel.getByRole('button',{name:'Report',exact:true}).click();await panel.getByRole('button',{name:'Finalize',exact:true}).click();await page.getByRole('button',{name:'Confirm and sign',exact:true}).click();await panel.getByText('Final — signed',{exact:true}).waitFor();
  console.log(JSON.stringify({modality:c.modality,workspaceV2:true,reports:2,directDictation:true,cursorInsertion:true,staleTranscriptionCancelled:true,selectedReportKeyImage:true,primarySigned:true}));
}
