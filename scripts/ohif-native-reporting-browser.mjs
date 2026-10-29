// Synthetic-only real OHIF/Cornerstone/Orthanc browser acceptance.
// Run serially after db:test:up/check/migrations. Never accepts patient/archive URLs.
import {execFileSync,spawnSync} from 'node:child_process';
import {existsSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {createServer,request as httpRequest} from 'node:http';
import {createServer as createHttpsServer} from 'node:https';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {runRenderingStress} from './ohif-rendering-stress.mjs';
import {runResponsiveAcceptance} from './ohif-responsive-browser.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(join(root,'package.json'));
const {chromium}=require('@playwright/test'),sharp=require('sharp'),dcmjs=require('dcmjs'),jwt=require('jsonwebtoken');
const dbUrl=new URL(process.env.DATABASE_URL||'http://invalid');
if(!['localhost','127.0.0.1'].includes(dbUrl.hostname)||dbUrl.port!=='5433'||dbUrl.pathname!=='/rispro_test'||dbUrl.username!=='rispro_test')throw Error('Disposable rispro_test database only');
process.env.RISPRO_E2E='1';process.env.JWT_SECRET='synthetic-native-browser-secret';process.env.OHIF_ENABLED='true';process.env.COOKIE_SECURE='false';
const temp=mkdtempSync(join(tmpdir(),'rispro-native-reporting-'));
console.log(JSON.stringify({artifacts:temp}));
const prefix='rispro-native-'+process.pid;
const networkName=prefix+'-network';let networkCreated=false;
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const dockerLogs=name=>{const result=spawnSync('docker',['logs',name],{encoding:'utf8'});return (result.stdout||'')+(result.stderr||'');};
const containers=[],createdModalityIds=[];
function start(name,image,port,mounts=[],command=[]){
  docker('run','-d','--name',name,'-p',`127.0.0.1::${port}`,...mounts,image,...command);containers.push(name);
  try{return Number(docker('port',name,`${port}/tcp`).split(':').at(-1));}
  catch{throw Error('Synthetic container startup failed: '+dockerLogs(name));}
}
const module=name=>import(pathToFileURL(join(root,name)));
const {pool}=await module('src/db/pool.ts');const {env}=await module('src/config/env.ts');
if(new URL(env.databaseUrl).href!==dbUrl.href)throw Error('Runtime database safety guard failed');
const viewerImage=process.env.OHIF_TEST_IMAGE||'rispro-ohif:native-v1';
const nativeDelivery=env.ohifNativeDeliveryEnabled;
const nativeBenchmark=process.env.OHIF_NATIVE_BENCHMARK==='1';
const transportCounts={proxyFrames:0,authorizations:0};
let benchmarkPort,dbNetworkConnected=false;
const renderingStress=process.env.OHIF_RENDER_STRESS==='1';
const responsive=process.env.OHIF_RESPONSIVE==='1';
const workspaceV2=process.env.OHIF_WORKSPACE_V2==='1';let workspaceFixture;
// Keep native responsive discovery/callbacks on the same Docker network too;
// Windows published-port hairpins can stall a prior QIDO and leave the panel empty.
const dockerBackend=nativeDelivery;
const reliability=responsive && process.env.OHIF_RELIABILITY==='1';
const originalOhif=(await pool.query('select * from ohif_viewer_settings where singleton_key=true')).rows[0];
const originalSettings=(await pool.query("select * from system_settings where category in ('authoritative_orthanc','sonicdicom_reports','documents_and_uploads')")).rows;
const oldUploads=env.uploadsDir;const cases=[];let userId,doctorId,policySetId,appServer,tlsServer,browser,activePage,viewerPort;
async function setting(category,key,value){await pool.query('insert into system_settings(category,setting_key,setting_value) values($1,$2,$3) on conflict(category,setting_key) do update set setting_value=excluded.setting_value',[category,key,JSON.stringify({value})]);}
try{
  docker('image','inspect',viewerImage,'orthancteam/orthanc:26.4.0','nginx:1.27.5-alpine');
  docker('network','create',networkName);networkCreated=true;
  if(nativeDelivery && dockerBackend){
    docker('network','connect','--alias','rispro-test-postgres',networkName,'rispro-test-postgres');dbNetworkConnected=true;
    const backendDb=new URL(dbUrl);backendDb.hostname='rispro-test-postgres';backendDb.port='5432';
    const vars={RISPRO_E2E:'1',RISPRO_BENCH_DOCKER:'1',DATABASE_URL:backendDb.href,TEST_DATABASE_URL:backendDb.href,PGHOST:'rispro-test-postgres',PGPORT:'5432',PGDATABASE:'rispro_test',PGUSER:'rispro_test',PGPASSWORD:decodeURIComponent(backendDb.password),DATABASE_SSL:'false',JWT_SECRET:env.jwtSecret,OHIF_ENABLED:'true',OHIF_NATIVE_DELIVERY_ENABLED:'true',OHIF_NATIVE_AUTH_SECRET:env.ohifNativeAuthSecret,COOKIE_SECURE:'false',UPLOADS_DIR:'/benchmark-uploads'};
    benchmarkPort=start(prefix+'-backend',process.env.OHIF_BENCH_BACKEND_IMAGE||'rispro-ohif:benchmark-backend',3000,['--network',networkName,'--network-alias','benchmark-backend',...Object.entries(vars).flatMap(([key,value])=>['-e',key+'='+value]),...['src','scripts','shared','assets'].flatMap(dir=>['-v',join(root,dir)+':/app/'+dir+':ro']),'-v',join(temp,'uploads')+':/benchmark-uploads','--entrypoint','node'],['--import','tsx','scripts/ohif-native-benchmark-server.mjs']);
    let ready=false;for(let attempt=0;attempt<40;attempt++){try{if((await fetch(`http://127.0.0.1:${benchmarkPort}/__benchmark/metrics`,{signal:AbortSignal.timeout(1000)})).ok){ready=true;break;}}catch{}if(docker('inspect','--format','{{.State.Running}}',prefix+'-backend')!=='true')break;await new Promise(r=>setTimeout(r,250));}
    if(!ready)throw Error('Synthetic Docker backend did not start: '+dockerLogs(prefix+'-backend'));
  }
  writeFileSync(join(temp,'orthanc.json'),JSON.stringify({Name:'SYNTHETIC NATIVE REPORTING',RemoteAccessAllowed:true,AuthenticationEnabled:true,RegisteredUsers:{synthetic:'synthetic-only'},DicomServerEnabled:false,Plugins:['/usr/share/orthanc/plugins'],DicomWeb:{Enable:true,EnableMetadataCache:true,StudiesMetadata:'Full',SeriesMetadata:'Full'},}));
  const archivePort=start(prefix+'-archive','orthancteam/orthanc:26.4.0',8042,['--network',networkName,'--network-alias','authoritative-archive','-e','DICOM_WEB_PLUGIN_ENABLED=true','-v',join(temp,'orthanc.json')+':/etc/orthanc/orthanc.json:ro']);
  const archive='http://127.0.0.1:'+archivePort;
  const archiveRequest=(path,options={})=>fetch(archive+path,{...options,headers:{Authorization:'Basic '+Buffer.from('synthetic:synthetic-only').toString('base64'),...options.headers}});
  for(let attempt=0;attempt<60;attempt++){try{if((await archiveRequest('/system')).ok)break;}catch{}await new Promise(r=>setTimeout(r,500));}
  assert.equal((await archiveRequest('/system')).status,200);
  for(const [key,value] of Object.entries({enabled:'enabled',base_url:dockerBackend?'http://authoritative-archive:8042':archive,username:'synthetic',password:'synthetic-only',verify_tls:'true',timeout_seconds:'30'}))await setting('authoritative_orthanc',key,value);
  await setting('sonicdicom_reports','config',{sonicDicomReportsEnabled:false});
  await setting('documents_and_uploads','storage_path','');await setting('documents_and_uploads','storage_fallback_enabled','true');
  env.uploadsDir=join(temp,'uploads');
  await pool.query("update ohif_viewer_settings set enabled=true,native_reporting_enabled=true,allow_prior_studies=true,max_prior_studies=5,access_strategy='authoritative_orthanc',selected_pacs_node_id=null where singleton_key=true");
  userId=Number((await pool.query("insert into users(username,full_name,password_hash,role,is_active) values($1,'SYNTHETIC RADIOLOGIST','disabled','doctor',true) returning id",['native.'+randomUUID().slice(0,8)])).rows[0].id);
  doctorId=Number((await pool.query("insert into doctor_portal.doctor_profiles(user_id,display_name,doctor_role,active,can_finalize_reports,can_assign_protocols,can_supervise) values($1,'SYNTHETIC RADIOLOGIST','consultant',true,true,false,true) returning id",[userId])).rows[0].id);
  policySetId=Number((await pool.query("insert into appointments_v2.policy_sets(key,name) values($1,'SYNTHETIC NATIVE REPORTING') returning id",['native.'+randomUUID()])).rows[0].id);
  const policyVersion=Number((await pool.query("insert into appointments_v2.policy_versions(policy_set_id,version_no,status,config_hash) values($1,1,'draft','synthetic') returning id",[policySetId])).rows[0].id);
  for(const modality of renderingStress?['MR']:['CT','MR']){
    let modalityId=Number((await pool.query('select id from modalities where code=$1',[modality])).rows[0]?.id);
    if(!modalityId){modalityId=Number((await pool.query('insert into modalities(code,name_ar,name_en) values($1,$2,$2) returning id',[modality,'SYNTHETIC '+modality])).rows[0].id);createdModalityIds.push(modalityId);}
    await pool.query('insert into doctor_portal.doctor_modality_permissions(doctor_id,modality_id,can_protocol,can_report,can_supervise,active) values($1,$2,false,true,false,true)',[doctorId,modalityId]);
    const identifier='SYNTHETIC-NATIVE-'+modality;
    const patientId=Number((await pool.query("insert into patients(arabic_full_name,english_full_name,normalized_arabic_name,identifier_type,identifier_value,age_years,sex) values($1,$1,$1,'other',$2,40,'O') returning id",['SYNTHETIC '+modality,identifier])).rows[0].id);
    const appointmentId=Number((await pool.query("insert into appointments_v2.bookings(patient_id,modality_id,booking_date,case_category,status,requires_report,policy_version_id,completed_at) values($1,$2,current_date,'non_oncology','completed',true,$3,now()) returning id",[patientId,modalityId,policyVersion])).rows[0].id);
    const c={modality,patientId,appointmentId,identifier,study:'2.25.'+BigInt('0x'+randomUUID().replaceAll('-','')).toString()};cases.push(c);
    await pool.query("insert into doctor_portal.case_team_assignments(appointment_id,assigned_doctor_id,modality_id,assignment_type,status,expected_reporting_date) values($1,$2,$3,'reporting','active',current_date)",[appointmentId,doctorId,modalityId]);
    const stressSize=process.env.OHIF_RENDER_SMOKE==='1'?256:512,stressSlices=process.env.OHIF_RENDER_SMOKE==='1'?40:800;
    if(renderingStress)Object.assign(c,{size:stressSize,slices:stressSlices});
    const template=renderingStress?Uint16Array.from({length:stressSize*stressSize},(_,i)=>{const x=i%stressSize,y=Math.floor(i/stressSize),r=((x-stressSize/2)/(stressSize*.36))**2+((y-stressSize/2)/(stressSize*.3))**2;return r<1?700+Math.round(220*Math.sin(x/19)+180*Math.cos(y/23)):20;}):null;
    for(let seriesNo=renderingStress?0:1;seriesNo<=4;seriesNo++)for(let slice=0;slice<(reliability&&modality==='CT'&&seriesNo===1?512:renderingStress?(seriesNo===0?1:seriesNo<=2?stressSlices:Math.min(96,stressSlices)):16);slice++){
      if(!renderingStress && seriesNo===4 && (modality!=='MR' || slice!==0))continue;
      const size=renderingStress?stressSize:modality==='CT'?256:192;const pixels=renderingStress?template.slice():reliability&&modality==='CT'?new Int16Array(size*size):new Uint16Array(size*size);
      if(renderingStress){for(let i=0;i<pixels.length;i++)if(pixels[i]>20)pixels[i]+=(slice%16)*8+seriesNo*20;}
      else for(let y=0;y<size;y++)for(let x=0;x<size;x++){const radius=((x-size/2)/(size*.36))**2+((y-size/2)/(size*.3))**2;pixels[y*size+x]=radius<1?600+Math.round(400*Math.sin(x/9)+300*Math.cos(y/11)+(reliability?100*Math.sin(slice/8):slice*20)):reliability&&modality==='CT'?-1000:20;}
      const sopClass=renderingStress&&seriesNo===0?'1.2.840.10008.5.1.4.1.1.7':!renderingStress&&seriesNo===4?'1.2.840.10008.5.1.4.1.1.4.1':modality==='CT'?'1.2.840.10008.5.1.4.1.1.2':'1.2.840.10008.5.1.4.1.1.4';
      const sop=c.study+'.'+seriesNo+'.'+(slice+1);
      const ds={_vrMap:{PixelData:'OW'},SOPClassUID:sopClass,SOPInstanceUID:sop,StudyInstanceUID:c.study,SeriesInstanceUID:c.study+'.'+seriesNo,FrameOfReferenceUID:c.study+'.9',PatientName:'SYNTHETIC^'+modality,PatientID:identifier,PatientBirthDate:'19860101',PatientSex:'O',StudyDate:new Date().toISOString().slice(0,10).replaceAll('-',''),StudyTime:'120000',StudyDescription:'SYNTHETIC '+modality,AccessionNumber:'V2-'+String(appointmentId).padStart(6,'0'),Modality:modality,SeriesNumber:seriesNo,SeriesDescription:'SYNTHETIC '+modality+' SERIES '+seriesNo,InstanceNumber:slice+1,ImageType:['ORIGINAL','PRIMARY','AXIAL'],Rows:size,Columns:size,SamplesPerPixel:1,PhotometricInterpretation:'MONOCHROME2',BitsAllocated:16,BitsStored:16,HighBit:15,PixelRepresentation:0,ImageOrientationPatient:[1,0,0,0,1,0],ImagePositionPatient:[0,0,slice*2],PixelSpacing:[1,1],SliceThickness:2,SpacingBetweenSlices:2,WindowCenter:700,WindowWidth:1800,RescaleIntercept:0,RescaleSlope:1,PixelData:pixels.buffer};
      if(reliability&&modality==='CT')ds.PixelRepresentation=1;
      // Distinct stored VOIs expose cross-series window leakage and cached
      // presentation restoration. Keep the established regression fixtures intact.
      if(responsive && seriesNo===2)Object.assign(ds,{WindowCenter:420,WindowWidth:900});
      if(seriesNo===3 || renderingStress&&seriesNo===4)Object.assign(ds,{StudyInstanceUID:c.study+'.'+(seriesNo+5),StudyDate:new Date(Date.now()-86400000*(seriesNo-2)).toISOString().slice(0,10).replaceAll('-',''),StudyDescription:'SYNTHETIC '+modality+' PRIOR '+seriesNo,AccessionNumber:'SYNTHETIC-PRIOR-'+appointmentId+'-'+seriesNo});
      if(renderingStress&&seriesNo===0)Object.assign(ds,{Modality:'OT',SeriesDescription:'Request Documents',ImageType:['DERIVED','SECONDARY']});
      if(modality==='MR')Object.assign(ds,{ScanningSequence:'SE',SequenceVariant:'NONE',ScanOptions:'',MRAcquisitionType:'2D',RepetitionTime:600,EchoTime:15,EchoNumbers:1,MagneticFieldStrength:1.5});
      if(!renderingStress&&seriesNo===4){
        const frames=new Uint16Array(size*size*4);for(let f=0;f<4;f++)for(let pixel=0;pixel<pixels.length;pixel++)frames[f*pixels.length+pixel]=pixels[pixel]+f*50;
        Object.assign(ds,{NumberOfFrames:4,SeriesDescription:'SYNTHETIC ENHANCED MR MULTIFRAME',PixelData:frames.buffer,
          SharedFunctionalGroupsSequence:[{PixelMeasuresSequence:[{PixelSpacing:[1,1],SliceThickness:2,SpacingBetweenSlices:2}],PlaneOrientationSequence:[{ImageOrientationPatient:[1,0,0,0,1,0]}]}],
          PerFrameFunctionalGroupsSequence:Array.from({length:4},(_,f)=>({PlanePositionSequence:[{ImagePositionPatient:[0,0,f*2]}],FrameContentSequence:[{StackID:'1',InStackPositionNumber:f+1,DimensionIndexValues:[f+1]}]}))});
      }
      const dict=new dcmjs.data.DicomDict(dcmjs.data.DicomMetaDictionary.denaturalizeDataset({MediaStorageSOPClassUID:sopClass,MediaStorageSOPInstanceUID:sop,TransferSyntaxUID:'1.2.840.10008.1.2.1',ImplementationClassUID:'2.25.202610260001'}));dict.dict=dcmjs.data.DicomMetaDictionary.denaturalizeDataset(ds);
      assert.equal((await archiveRequest('/instances',{method:'POST',headers:{'Content-Type':'application/dicom'},body:Buffer.from(dict.write())})).status,200);
      if(renderingStress && slice%200===0)console.log(JSON.stringify({syntheticFixture:{series:seriesNo,uploaded:slice+1,dimensions:[size,size]}}));
    }
    if(reliability && modality==='CT'){
      // Explicit SOP classes: a supported scanned image, unsupported encapsulated
      // CDA, and a supported PDF. Labels alone never determine compatibility.
      const {addReliabilityDocuments}=await import('./ohif-responsive-browser.mjs');
      await addReliabilityDocuments({c,dcmjs,archiveRequest});
    }
  }
  const {createApp}=await module('src/app.ts');const app=createApp();const handleRequest=(req,res)=>{
    if(req.url?.startsWith('/ohif-dicomweb/')&&req.url.includes('/frames/'))transportCounts.proxyFrames++;
    if((renderingStress||responsive)&&req.url?.startsWith('/ohif/')){
      // GPU stress uses the real host-run authenticated gateway directly. The
      // Linux edge -> Windows host connection hop reproduces connect-time 504s
      // under this workload; production gateway/app share a Docker network.
      // Static OHIF responses still come from its real nginx without decoding.
      const upstream=httpRequest('http://127.0.0.1:'+viewerPort+req.url,{method:req.method,headers:req.headers},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
      upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});
      res.once('close',()=>{if(!res.writableFinished)upstream.destroy();});req.pipe(upstream);return;
    }
    if(req.url?.startsWith('/api/native-reporting/') && req.method!=='GET'){
      const started=performance.now();console.log(JSON.stringify({reportingRequest:'start',method:req.method,operation:req.url.split('/').at(-1)}));
      res.once('finish',()=>console.log(JSON.stringify({reportingRequest:'finish',method:req.method,status:res.statusCode,durationMs:Math.round(performance.now()-started)})));
    }
    app(req,res);
  };appServer=createServer(handleRequest);await new Promise(r=>appServer.listen(0,'127.0.0.1',r));
  const appPort=benchmarkPort||appServer.address().port;
  // Use the same direct edge -> OHIF route as Compose, avoiding Windows
  // published-port hairpin connection timeouts during bootstrap chunk fan-out.
  viewerPort=start(prefix+'-viewer',viewerImage,80,['--network',networkName,'--network-alias','ohif','-v',join(root,'docker/ohif/app-config.js')+':/usr/share/nginx/html/ohif/app-config.js:ro']);
  let nginx=readFileSync(join(root,'docker/reverse-proxy/nginx.conf'),'utf8').replace('server app:3000 resolve;',dockerBackend?'server benchmark-backend:3000;':`server host.docker.internal:${appPort};`).replace('listen 8080;','listen 80;');

  writeFileSync(join(temp,'edge.conf'),nginx);
  const nativeMounts=nativeDelivery?['--tmpfs','/etc/nginx/ohif-native:mode=0700','-e','OHIF_NATIVE_AUTH_SECRET='+env.ohifNativeAuthSecret,'-e','NGINX_ENVSUBST_FILTER=^OHIF_NATIVE_AUTH_SECRET$','-e','NGINX_ENVSUBST_OUTPUT_DIR=/etc/nginx/ohif-native','-v',join(root,'docker/ohif/native-location.conf')+':/etc/nginx/templates/native.conf.template:ro']:[];
  const edgeOrigin='http://127.0.0.1:'+start(prefix+'-edge','nginx:1.27.5-alpine',80,['--network',networkName,...nativeMounts,'-v',join(temp,'edge.conf')+':/etc/nginx/nginx.conf:ro']);
  let baselineOrigin,quickOrigin;
  if(nativeDelivery)docker('exec',prefix+'-edge','test','-s','/etc/nginx/ohif-native/native.conf');
  docker('exec',prefix+'-edge','nginx','-t');
  if(nativeBenchmark && process.env.OHIF_NATIVE_AUTH_ACCEPTANCE!=='1'){
    for(const [alias,image] of [['baseline',process.env.OHIF_BASELINE_IMAGE||'rispro-ohif:ios-reliability'],['quick',process.env.OHIF_QUICK_TEST_IMAGE||'rispro-ohif:lan-native-quick']]){
      start(prefix+'-'+alias,image,80,['--network',networkName,'--network-alias','ohif-'+alias]);
      const config=join(temp,alias+'-edge.conf');writeFileSync(config,nginx.replace('http://ohif:80','http://ohif-'+alias+':80'));
      const url='http://127.0.0.1:'+start(prefix+'-'+alias+'-edge','nginx:1.27.5-alpine',80,['--network',networkName,...nativeMounts,'-v',config+':/etc/nginx/nginx.conf:ro']);
      if(alias==='baseline')baselineOrigin=url;else quickOrigin=url;
    }
  }
  let origin=(renderingStress||responsive)&&!nativeDelivery?'http://127.0.0.1:'+appPort:edgeOrigin;
  if(renderingStress&&process.env.OHIF_RENDER_HTTPS==='1'){
    const openssl=process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl';
    if(process.platform==='win32'&&!existsSync(openssl))throw Error('Synthetic HTTPS requires existing Git OpenSSL');
    execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(temp,'test.key'),'-out',join(temp,'test.crt'),'-days','1','-subj','/CN=rispro-synthetic.invalid','-addext','subjectAltName=DNS:rispro-synthetic.invalid,IP:127.0.0.1'],{stdio:'pipe'});
    tlsServer=createHttpsServer({key:readFileSync(join(temp,'test.key')),cert:readFileSync(join(temp,'test.crt'))},handleRequest);
    await new Promise(r=>tlsServer.listen(0,'127.0.0.1',r));origin='https://127.0.0.1:'+tlsServer.address().port;
  }
  const login=jwt.sign({sub:userId,role:'doctor'},env.jwtSecret,{expiresIn:'1h'});
  const {launchReportingBoardCaseInOhif}=await module('src/modules/ohif-viewer/service.ts');
  // A non-localhost HTTP origin verifies LAN-compatible capture and UUID creation.
  // Only Chromium resolves this reserved test hostname to the loopback fixture.
  const viewerOrigin=workspaceV2?origin:origin.replace('127.0.0.1','rispro-synthetic.invalid');
  if(workspaceV2)workspaceFixture=await (await import('./ohif-workspace-v2-acceptance.mjs')).prepareWorkspaceV2({pool,temp});
  browser=await chromium.launch({headless:true,channel:renderingStress&&process.env.OHIF_RENDER_BROWSER==='msedge'?'msedge':undefined,args:['--host-resolver-rules=MAP rispro-synthetic.invalid 127.0.0.1','--no-proxy-server',...(workspaceV2?['--unsafely-treat-insecure-origin-as-secure='+viewerOrigin,'--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--use-file-for-fake-audio-capture='+workspaceFixture.audioPath]:[])]});const context=await browser.newContext({viewport:{width:1600,height:1000},ignoreHTTPSErrors:renderingStress});
  if(workspaceV2)await context.grantPermissions(['microphone']);
  await context.addCookies([{name:env.cookieName,value:login,url:origin,httpOnly:true}]);
  await context.addCookies([{name:env.cookieName,value:login,url:viewerOrigin,httpOnly:true}]);
  if(process.env.OHIF_NATIVE_AUTH_ACCEPTANCE==='1'){
    const {runAuthenticatedNativeAcceptance}=await import('./ohif-native-authenticated-acceptance.mjs');
    await runAuthenticatedNativeAcceptance({browser,cases,origin,backendOrigin:'http://127.0.0.1:'+appPort,archive,archiveRequest,pool,env,temp,login,userId,doctorId,
      logs:()=>containers.map(name=>dockerLogs(name)).join('\n'),
      launch:async c=>{const response=await context.request.post(origin+`/api/doctor/reporting-board/cases/${c.appointmentId}/viewer-launch`,{data:{includePriors:true}});assert.equal(response.status(),200);return response.json();}});
  }else if(nativeBenchmark){
    const {runNativeBenchmark}=await import('./ohif-native-benchmark.mjs');
    await runNativeBenchmark({browser,context,cases,origin,baselineOrigin,quickOrigin,backendOrigin:'http://127.0.0.1:'+appPort,archive,archiveRequest,pool,env,temp,root,login,userId,doctorId,transportCounts,viewerImage,
      archiveCpuMs:()=>Number(/usage_usec (\d+)/.exec(docker('exec',prefix+'-archive','cat','/sys/fs/cgroup/cpu.stat'))[1])/1000,
      launch:async c=>{const response=await context.request.post(origin+`/api/doctor/reporting-board/cases/${c.appointmentId}/viewer-launch`,{data:{includePriors:true}});assert.equal(response.status(),200);return response.json();}});
  }else if(responsive){
    await runResponsiveAcceptance({context,cases,origin,temp,launch:async c=>{
      if(!dockerBackend)return launchReportingBoardCaseInOhif({userId,appRole:'doctor'},c.appointmentId,true);
      const response=await context.request.post(origin+`/api/doctor/reporting-board/cases/${c.appointmentId}/viewer-launch`,{data:{includePriors:true}});
      assert.equal(response.status(),200);return response.json();
    }});
  }else if(renderingStress){
    await runRenderingStress({browser,context,c:cases[0],origin:viewerOrigin,apiOrigin:origin,temp,launch:includePriors=>launchReportingBoardCaseInOhif({userId,appRole:'doctor'},cases[0].appointmentId,includePriors)});
  }else{
  const pages=[];
  for(const c of cases){
    const startAt=performance.now();const launch=await launchReportingBoardCaseInOhif({userId,appRole:'doctor'},c.appointmentId,true);assert.equal(launch.status,'ready');assert.equal(launch.priorStudyCount,1);
    const launchMs=performance.now()-startAt;const page=await context.newPage();activePage=page;pages.push(page);let frames=0;const frameCounts=new Map();
    page.on('response',r=>{if(r.url().includes('/frames/') && r.ok()){frames++;frameCounts.set(r.url(),(frameCounts.get(r.url())||0)+1);}});
    page.on('pageerror',error=>console.log(JSON.stringify({browserError:error.message})));
    await page.goto(viewerOrigin+launch.launchUrl,{waitUntil:'domcontentloaded'});
    assert.equal(await page.evaluate(()=>window.isSecureContext),workspaceV2,workspaceV2?'Synthetic loopback microphone validation requires a secure context':'Capture must work on ordinary insecure HTTP, without screen-sharing APIs');
    await page.waitForFunction(()=>{try{const s=window.services;return !!s?.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId())?.getCurrentImageId?.();}catch{return false;}},null,{timeout:120000});
    for(const label of ['Skip all','Confirm and hide']){
      const button=page.getByText(label,{exact:true});let visible=false;
      try{await button.waitFor({state:'visible',timeout:5000});visible=true;}catch(error){if(error.name!=='TimeoutError')throw error;}
      if(visible){await button.click();await button.waitFor({state:'hidden'});}
    }
    await page.locator('.shepherd-modal-is-visible').waitFor({state:'hidden'});
    await page.getByText('SYNTHETIC '+c.modality+' PRIOR 3', { exact: false }).first().waitFor({ state: 'visible', timeout: 30000 });
    assert.ok([...frameCounts.keys()].every(url => !url.includes('/studies/'+c.study+'.8/')), 'Other studies must not load frames before selection');
    await page.waitForFunction(study => { const s=window.services,v=s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId()); return v?.getCurrentImageId?.()?.includes('/studies/'+study+'/'); }, c.study, {timeout:30000});
    // A hanging protocol may initially display a permitted prior. Select the
    // primary series explicitly so the subsequent prior-switch assertion is real.
    await page.evaluate(async study=>{
      await window.commandsManager.runCommand('loadStudy',{StudyInstanceUID:study});
      const s=window.services,set=s.displaySetService.getActiveDisplaySets().find(item=>item.StudyInstanceUID===study && item.SeriesInstanceUID===study+'.1');
      if(!set)throw Error('Synthetic primary series was not loaded');
      window.commandsManager.runCommand('setDisplaySetsForViewports',{viewportsToUpdate:[{viewportId:s.viewportGridService.getActiveViewportId(),displaySetInstanceUIDs:[set.displaySetInstanceUID],viewportOptions:{viewportType:'stack'}}]});
    },c.study);
    await page.waitForFunction(study=>{const s=window.services,v=s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());return v?.getCurrentImageId?.()?.includes('/studies/'+study+'/');},c.study,{timeout:30000});
    const viewport=page.locator('[data-viewport-uid]').filter({has:page.locator('canvas')}).first();
    const screenshot=await viewport.screenshot();const stats=await sharp(screenshot).stats();assert.ok(stats.channels[0].stdev>10);
    const firstPixelsMs=performance.now()-startAt;
    const frameCountsBefore=new Map(frameCounts);
    const engineBefore=await page.evaluate(()=>window.services.cornerstoneViewportService.getRenderingEngine().id);
    await page.getByRole('button',{name:'Report',exact:true}).first().click();
    const panel=page.getByRole('region',{name:'RISpro report'});await panel.getByRole('button',{name:'Create RISpro Report'}).click();
    await panel.getByLabel('Findings',{exact:true}).fill('SYNTHETIC '+c.modality+' findings.\nNo clinical interpretation.');
    await panel.getByLabel('Impression',{exact:true}).fill('SYNTHETIC '+c.modality+' impression.');
    await panel.getByRole('status').filter({hasText:/^Saved$/}).waitFor();
    if(workspaceV2){await (await import('./ohif-workspace-v2-acceptance.mjs')).runWorkspaceV2Panel({page,panel,context,origin,c,temp,fixture:workspaceFixture});continue;}
    await page.locator('[data-cy="side-panel-header-right"]').click();await panel.waitFor({state:'hidden'});
    await page.getByRole('button',{name:'Report',exact:true}).first().click();await panel.waitFor({state:'visible'});
    assert.equal(await panel.getByLabel('Impression',{exact:true}).inputValue(),'SYNTHETIC '+c.modality+' impression.');
    // A failed text request retains the exact input until an explicit retry succeeds.
    let failSave=true;
    await page.route('**/api/native-reporting/appointments/*/draft',async route=>{
      if(failSave){failSave=false;await route.abort();}else await route.continue();
    });
    const retained='SYNTHETIC '+c.modality+' findings.\nNo clinical interpretation.\nRetry retained this text.';
    await panel.getByLabel('Findings',{exact:true}).fill(retained);
    await panel.getByRole('status').filter({hasText:'Save failed'}).waitFor();
    assert.equal(await panel.getByLabel('Findings',{exact:true}).inputValue(),retained);
    await panel.getByRole('button',{name:'Save',exact:true}).click();await panel.getByRole('status').filter({hasText:/^Saved$/}).waitFor();
    if(c.modality==='CT'){
      // Reopen the saved synthetic draft through the real Reporting Worklist UI.
      const board=await context.newPage();activePage=board;
      await board.goto(viewerOrigin+'/doctor/reporting-board');
      await board.getByRole('button',{name:'Open actions for V2-'+String(c.appointmentId).padStart(6,'0'),exact:true}).click();
      const openedPromise=originalOhif.open_mode==='same_tab'?Promise.resolve(board):context.waitForEvent('page');
      await board.getByRole('menuitem',{name:'Open Images',exact:true}).click();
      const reopened=await openedPromise;activePage=reopened;
      await reopened.waitForURL('**/ohif/viewer?**');
      await reopened.waitForFunction(()=>{try{const s=window.services;return !!s?.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId())?.getCurrentImageId?.();}catch{return false;}},null,{timeout:120000});
      await reopened.getByRole('button',{name:'Report',exact:true}).first().click();
      const reopenedPanel=reopened.getByRole('region',{name:'RISpro report'});
      await reopenedPanel.getByLabel('Findings',{exact:true}).waitFor();
      assert.equal(await reopenedPanel.getByLabel('Findings',{exact:true}).inputValue(),retained);
      await reopened.screenshot({path:join(temp,'CT-worklist-reopened.png')});
      await reopened.close();if(reopened!==board)await board.close();activePage=page;
      const other=await context.newPage();activePage=other;await other.goto(page.url());await other.getByRole('button',{name:'Report',exact:true}).first().click();
      const otherPanel=other.getByRole('region',{name:'RISpro report'});
      await otherPanel.getByLabel('Impression',{exact:true}).fill('SYNTHETIC concurrent editor.');await otherPanel.getByRole('status').filter({hasText:/^Saved$/}).waitFor();
      await panel.getByLabel('Impression',{exact:true}).fill('SYNTHETIC unsaved conflicting text.');
      await panel.getByRole('alert').filter({hasText:'another editor'}).waitFor();
      assert.equal(await panel.getByLabel('Impression',{exact:true}).inputValue(),'SYNTHETIC unsaved conflicting text.');
      await page.screenshot({path:join(temp,'CT-visible-conflict.png')});
      page.once('dialog',dialog=>dialog.accept());await panel.getByRole('button',{name:'Reload saved report',exact:true}).click();
      await panel.getByLabel('Impression',{exact:true}).fill('SYNTHETIC CT impression.');await panel.getByRole('button',{name:'Save',exact:true}).click();await panel.getByRole('status').filter({hasText:/^Saved$/}).waitFor();await other.close();activePage=page;
    }
    const framesBefore=frames;
    await panel.getByRole('button',{name:/Key Images/}).click();
    await page.evaluate(()=>{
      const s=window.services,v=s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());
      v.setProperties({voiRange:{lower:100,upper:1600},invert:true});v.setCamera({flipHorizontal:true});v.setRotation(90);v.render();
    });
    // Create a real visible clinical measurement using the pinned annotation tool.
    await page.evaluate(()=>{
      const s=window.services,v=s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());
      const imageId=v.getCurrentImageId(),a=v.canvasToWorld([100,100]),b=v.canvasToWorld([200,150]);
      window.cornerstoneTools.annotation.state.addAnnotation({annotationUID:'synthetic-native-length',highlighted:false,invalidated:true,isLocked:false,isVisible:true,metadata:{toolName:'Length',viewPlaneNormal:v.getCamera().viewPlaneNormal,viewUp:v.getCamera().viewUp,FrameOfReferenceUID:window.cornerstone.metaData.get('imagePlaneModule',imageId).frameOfReferenceUID,referencedImageId:imageId},data:{label:'SYNTHETIC LENGTH',handles:{points:[a,b],activeHandleIndex:null,textBox:{hasMoved:false,worldPosition:[0,0,0],worldBoundingBox:{topLeft:[0,0,0],topRight:[0,0,0],bottomLeft:[0,0,0],bottomRight:[0,0,0]}}}}},v.element);
      window.cornerstoneTools.utilities.triggerAnnotationRenderForViewportIds([v.id]);
    });
    await page.waitForTimeout(200);
    let failUpload=true;
    await page.route('**/api/native-reporting/appointments/*/images',async route=>{
      if(failUpload && route.request().method()==='POST'){failUpload=false;await route.abort();}else await route.continue();
    });
    await panel.getByRole('button',{name:'Add Key Image',exact:true}).click();
    await panel.getByRole('button',{name:'Retry upload',exact:true}).waitFor();
    await panel.getByRole('button',{name:'Retry upload',exact:true}).click();
    await panel.getByAltText('Saved key image 1').waitFor({timeout:30000});
    const url=await panel.getByAltText('Saved key image 1').getAttribute('src');
    const saved=await context.request.get(origin+url);assert.equal(saved.status(),200);const bytes=await saved.body();
    const png=await sharp(bytes).metadata();assert.equal(png.format,'png');assert.ok((await sharp(bytes).stats()).channels[0].stdev>10);
    const persisted=await (await context.request.get(origin+'/api/native-reporting/appointments/'+c.appointmentId)).json();assert.equal(persisted.report.keyImages.length,1,'Retry must not duplicate the captured image');
    assert.equal(persisted.report.keyImages[0].provenance.display.invert,true);assert.equal(persisted.report.keyImages[0].provenance.display.rotation,90);assert.equal(persisted.report.keyImages[0].provenance.camera.flipHorizontal,true);
    assert.equal(persisted.report.keyImages[0].provenance.studyInstanceUid,c.study);assert.equal(persisted.report.keyImages[0].provenance.prior,false);
    const rgb=await sharp(bytes).removeAlpha().raw().toBuffer();let annotationPixels=0;
    for(let pixel=0;pixel<rgb.length;pixel+=3)if(Math.max(rgb[pixel],rgb[pixel+1],rgb[pixel+2])-Math.min(rgb[pixel],rgb[pixel+1],rgb[pixel+2])>40)annotationPixels++;
    assert.ok(annotationPixels>20,'The saved grayscale diagnostic illustration must include the visible colored annotation');
    console.log(JSON.stringify({modality:c.modality,stage:'annotated-stack-capture',pngWidth:png.width,pngHeight:png.height,annotationPixels,retryAttachments:persisted.report.keyImages.length}));
    await panel.getByLabel('Caption 1').fill('SYNTHETIC annotated '+c.modality+' slice');await panel.getByLabel('Caption 1').blur();
    await page.waitForTimeout(200);
    const reportingFrameReloads=[...frameCountsBefore].reduce((total,[url,count])=>total+Math.max(0,(frameCounts.get(url)||0)-count),0);
    assert.equal(reportingFrameReloads,0,'Opening reporting and typing must not refetch diagnostic frames');
    assert.equal(await page.evaluate(()=>window.services.cornerstoneViewportService.getRenderingEngine().id),engineBefore,'Reporting must preserve the imaging engine');
    if(c.modality==='MR'){
      await page.evaluate(()=>{
        const s=window.services,v=s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());
        setTimeout(()=>v.setImageIdIndex(5),0);
        [...document.querySelectorAll('.rispro-report button')].find(button=>button.textContent==='Add Key Image').click();
      });
      await panel.getByRole('alert').filter({hasText:/viewport changed|still rendering|Scrolling/}).waitFor({timeout:10000});
      assert.equal((await (await context.request.get(origin+'/api/native-reporting/appointments/'+c.appointmentId)).json()).report.keyImages.length,1);
    }
    if(c.modality==='CT'){
      await page.evaluate(()=>window.commandsManager.runCommand('setHangingProtocol',{protocolId:'mpr'}));
      await page.waitForFunction(()=>{
        const s=window.services;return [...s.viewportGridService.getState().viewports.keys()].filter(id=>{
          const v=s.cornerstoneViewportService.getCornerstoneViewport(id);
          return v instanceof window.cornerstone.BaseVolumeViewport && window.cornerstone.cache.getVolume(v.getVolumeId())?.loadStatus.loaded;
        }).length===3;
      },null,{timeout:60000});
      for(const [index,view] of ['coronal','sagittal','oblique','mip'].entries()){
        await page.evaluate(view=>{
          const s=window.services,id=[...s.viewportGridService.getState().viewports.keys()][0],v=s.cornerstoneViewportService.getCornerstoneViewport(id),core=window.cornerstone;
          s.viewportGridService.setActiveViewportId(id);
          // Configure a known synthetic patient-space plane after volume loading.
          // These are native camera/slab controls, not an alternative renderer.
          const center=[127.5,127.5,15],normal=view==='sagittal'?[1,0,0]:view==='oblique'?[Math.SQRT1_2,Math.SQRT1_2,0]:[0,1,0];
          v.setCamera({viewPlaneNormal:normal,viewUp:[0,0,1],position:normal.map((x,i)=>center[i]+1000*x),focalPoint:center,parallelScale:150});
          v.setBlendMode(view==='mip'?core.Enums.BlendModes.MAXIMUM_INTENSITY_BLEND:core.Enums.BlendModes.COMPOSITE);
          v.setSlabThickness(view==='mip'?12:1);v.render();
        },view);
        await page.waitForFunction(()=>{
          const s=window.services,v=s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());
          const canvas=document.createElement('canvas');canvas.width=v.canvas.width;canvas.height=v.canvas.height;const ctx=canvas.getContext('2d');ctx.drawImage(v.canvas,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
          let min=255,max=0;for(let i=0;i<pixels.length;i+=16){min=Math.min(min,pixels[i]);max=Math.max(max,pixels[i]);}return max-min>10;
        },null,{timeout:10000});
        await panel.getByRole('button',{name:'Add Key Image',exact:true}).click();
        await panel.getByAltText('Saved key image '+(index+2)).waitFor({timeout:30000});
        const imageUrl=await panel.getByAltText('Saved key image '+(index+2)).getAttribute('src');
        const image=await context.request.get(origin+imageUrl);assert.equal(image.status(),200);
        assert.ok((await sharp(await image.body()).stats()).channels[0].stdev>5,view+' must contain rendered diagnostic pixels');
        const savedReport=await (await context.request.get(origin+'/api/native-reporting/appointments/'+c.appointmentId)).json();
        const source=savedReport.report.keyImages.at(-1).provenance;assert.equal(source.sopInstanceUid,null);assert.equal(source.frameNumber,null);assert.ok(source.camera.focalPoint.length===3);
        assert.equal(source.viewportType,view==='mip'?'mip':'mpr');if(view==='mip')assert.equal(source.slabThickness,12);
        console.log(JSON.stringify({modality:c.modality,stage:view+'-capture',slabThickness:source.slabThickness,sourceSeriesVerified:true}));
        await page.screenshot({path:join(temp,'CT-'+view+'.png')});
      }
      const beforeRace=await (await context.request.get(origin+'/api/native-reporting/appointments/'+c.appointmentId)).json();
      await page.evaluate(()=>{
        const s=window.services,ids=[...s.viewportGridService.getState().viewports.keys()],next=ids.find(id=>id!==s.viewportGridService.getActiveViewportId());
        setTimeout(()=>s.viewportGridService.setActiveViewportId(next),0);
        [...document.querySelectorAll('.rispro-report button')].find(button=>button.textContent==='Add Key Image').click();
      });
      await panel.getByRole('alert').filter({hasText:/viewport changed|still rendering/}).waitFor({timeout:10000});
      const afterRace=await (await context.request.get(origin+'/api/native-reporting/appointments/'+c.appointmentId)).json();
      assert.equal(afterRace.report.keyImages.length,beforeRace.report.keyImages.length,'Changing active viewport during capture must reject the snapshot');
    }
    // Display and capture an authorized same-patient prior without moving report identity.
    const beforePrior=await (await context.request.get(origin+'/api/native-reporting/appointments/'+c.appointmentId)).json();
    await page.evaluate(async study=>{
      await window.commandsManager.runCommand('loadStudy',{StudyInstanceUID:study});
      const s=window.services,set=s.displaySetService.getActiveDisplaySets().find(item=>item.StudyInstanceUID===study);
      if(!set)throw Error('Synthetic prior display set was not loaded');
      window.commandsManager.runCommand('setDisplaySetsForViewports',{viewportsToUpdate:[{viewportId:s.viewportGridService.getActiveViewportId(),displaySetInstanceUIDs:[set.displaySetInstanceUID],viewportOptions:{viewportType:'stack'}}]});
    },c.study+'.8');
    await page.waitForFunction(study=>{
      const s=window.services,v=s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());
      return v instanceof window.cornerstone.StackViewport && v.getCurrentImageId()?.includes('/studies/'+study+'/');
    },c.study+'.8',{timeout:30000});
    await panel.getByRole('button',{name:'Add Key Image',exact:true}).click();
    await panel.getByAltText('Saved key image '+(beforePrior.report.keyImages.length+1)).waitFor({timeout:30000});
    const afterPrior=await (await context.request.get(origin+'/api/native-reporting/appointments/'+c.appointmentId)).json();
    assert.deepEqual(afterPrior.report.identity,beforePrior.report.identity);assert.equal(afterPrior.report.appointmentId,c.appointmentId);
    assert.equal(afterPrior.report.keyImages.at(-1).provenance.prior,true);assert.equal(afterPrior.report.keyImages.at(-1).provenance.studyInstanceUid,c.study+'.8');
    console.log(JSON.stringify({modality:c.modality,stage:'prior-capture',reportIdentityUnchanged:true}));
    if(c.modality==='MR'){
      await page.evaluate(series=>{
        const s=window.services,set=s.displaySetService.getActiveDisplaySets().find(item=>item.SeriesInstanceUID===series);
        if(!set)throw Error('Enhanced MR display set missing');
        window.commandsManager.runCommand('setDisplaySetsForViewports',{viewportsToUpdate:[{viewportId:s.viewportGridService.getActiveViewportId(),displaySetInstanceUIDs:[set.displaySetInstanceUID],viewportOptions:{viewportType:'stack'}}]});
      },c.study+'.4');
      await page.waitForFunction(series=>{
        const s=window.services,v=s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());
        return v instanceof window.cornerstone.StackViewport && v.getCurrentImageId()?.includes('/series/'+series+'/') && v.getImageIds().length===4;
      },c.study+'.4',{timeout:30000});
      await page.evaluate(async()=>{const s=window.services,v=s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());await v.setImageIdIndex(2);v.render();});
      await panel.getByRole('button',{name:'Add Key Image',exact:true}).click();await panel.getByAltText('Saved key image 3').waitFor({timeout:30000});
      const enhanced=await (await context.request.get(origin+'/api/native-reporting/appointments/'+c.appointmentId)).json();
      assert.equal(enhanced.report.keyImages.at(-1).provenance.frameNumber,3);assert.equal(enhanced.report.keyImages.at(-1).provenance.sopInstanceUid,c.study+'.4.1');
      console.log(JSON.stringify({modality:'MR',stage:'enhanced-multiframe-capture',dicomFrameNumber:3}));
    }
    await panel.getByRole('button',{name:'Save',exact:true}).click();
    await page.screenshot({path:join(temp,c.modality+'-key-images.png')});
    await page.setViewportSize({width:1024,height:800});await page.screenshot({path:join(temp,c.modality+'-narrow.png')});await page.setViewportSize({width:1600,height:1000});
    await panel.getByRole('button',{name:'Report',exact:true}).click();await page.screenshot({path:join(temp,c.modality+'-report-panel.png')});
    await panel.getByRole('button',{name:'Finalize',exact:true}).click();await page.getByRole('button',{name:'Confirm and sign',exact:true}).click();await panel.getByText('Final — signed',{exact:true}).waitFor();
    await panel.getByLabel('Addendum text',{exact:true}).fill('SYNTHETIC '+c.modality+' signed addendum.');
    await panel.getByRole('button',{name:'Add Addendum',exact:true}).click();await page.getByRole('button',{name:'Confirm and sign',exact:true}).click();
    await panel.getByText('SYNTHETIC '+c.modality+' signed addendum.',{exact:true}).waitFor();
    const reportPage=await context.newPage();activePage=reportPage;await reportPage.goto(origin+'/reporting/native/'+c.appointmentId);await reportPage.getByText('SYNTHETIC '+c.modality+' impression.',{exact:true}).waitFor();
    await reportPage.getByText('SYNTHETIC '+c.modality+' signed addendum.',{exact:true}).waitFor();await reportPage.screenshot({path:join(temp,c.modality+'-reopened.png')});activePage=page;
    docker('pause',prefix+'-archive');
    try{
      const print=await context.newPage();await print.goto(origin+'/api/native-reporting/appointments/'+c.appointmentId+'/print');await print.locator('img').evaluateAll(images=>Promise.all(images.map(image=>image.decode())));await print.emulateMedia({media:'print'});await print.screenshot({path:join(temp,c.modality+'-print.png'),fullPage:true});await print.pdf({path:join(temp,c.modality+'-report.pdf'),format:'A4',printBackground:true});
    }finally{docker('unpause',prefix+'-archive');}
    console.log(JSON.stringify({modality:c.modality,launchContextMs:Math.round(launchMs),firstVerifiedDiagnosticPixelsMs:Math.round(firstPixelsMs),capturePixelsVerified:true,reportingFrameReloads,environment:'Chromium loopback synthetic, actual modified OHIF Docker image'}));
  }
  // The two live patient tabs retain independent report/context identities.
  for(let index=0;index<pages.length;index++)assert.match(await pages[index].getByRole('region',{name:'RISpro report'}).textContent(),new RegExp('SYNTHETIC '+cases[index].modality));
  await pool.query('update ohif_viewer_settings set native_reporting_enabled=false where singleton_key=true');
  await pages[0].reload();await pages[0].getByRole('button',{name:'Report',exact:true}).first().click();
  await pages[0].getByRole('region',{name:'RISpro report'}).getByText('Final — signed',{exact:true}).waitFor();
  assert.equal(await pages[0].getByRole('button',{name:'Add Key Image',exact:true}).count(),0);
  console.log('PASS: real modified OHIF CT/MRI native reporting browser journey');
  }
}catch(error){
  for(const name of containers){const logs=spawnSync('docker',['logs',name],{encoding:'utf8'});writeFileSync(join(temp,name+'.log'),(logs.stdout||'')+(logs.stderr||''));}
  if(activePage)await activePage.screenshot({path:join(temp,'failure.png'),fullPage:true}).catch(()=>undefined);
  if(activePage){
    const diagnostics=await activePage.evaluate(()=>{
      const s=window.services;
      return [...s.viewportGridService.getState().viewports.keys()].map(id=>{
        const v=s.cornerstoneViewportService.getCornerstoneViewport(id),volume=v?.getVolumeId?.()?window.cornerstone.cache.getVolume(v.getVolumeId()):null;
        return {id,type:v?.type,camera:v?.getCamera(),properties:v?.getProperties(),slab:v?.getSlabThickness?.(),blend:v?.getBlendMode?.(),volume:volume?{dimensions:volume.dimensions,spacing:volume.spacing,origin:volume.origin,loadStatus:volume.loadStatus}:null};
      });
    }).catch(error=>({error:error.message}));
    writeFileSync(join(temp,'viewport-failure.json'),JSON.stringify(diagnostics,null,2));
  }
  throw error;
}finally{
  if(browser)await browser.close();if(tlsServer)await new Promise(r=>{tlsServer.closeAllConnections();tlsServer.close(r);});if(appServer)await new Promise(r=>{appServer.closeAllConnections();appServer.close(r);});
  for(const name of containers.reverse())try{docker('rm','-f',name);}catch{}
  const ids=cases.map(c=>c.appointmentId);const db=await pool.connect();
  try{await db.query('begin');await db.query('set local session_replication_role=replica');
    const studyIds=(await db.query('select distinct study_id from native_report_study_links l join native_reports n on n.id=l.report_id where n.appointment_id=any($1::bigint[])',[ids])).rows.map(r=>r.study_id);
    for(const table of ['native_report_review_events','native_report_contributors','native_report_versions','native_report_key_images','native_report_study_links'])await db.query(`delete from ${table} where report_id in(select id from native_reports where appointment_id=any($1::bigint[]))`,[ids]);
    if(studyIds.length)await db.query('delete from native_reporting_studies where id=any($1::uuid[])',[studyIds]);
    await db.query('delete from historical_pacs_studies where study_instance_uid=any($1::text[])',[cases.flatMap(c=>[c.study,c.study+'.8'])]);
    await db.query('delete from native_reports where appointment_id=any($1::bigint[])',[ids]);await db.query('delete from viewer_launch_sessions where appointment_id=any($1::bigint[])',[ids]);await db.query('delete from study_source_resolutions where appointment_id=any($1::bigint[])',[ids]);await db.query('delete from doctor_portal.case_team_assignments where appointment_id=any($1::bigint[])',[ids]);await db.query('delete from appointments_v2.bookings where id=any($1::bigint[])',[ids]);await db.query('delete from patients where id=any($1::bigint[])',[cases.map(c=>c.patientId)]);if(doctorId){await db.query('delete from doctor_portal.doctor_modality_permissions where doctor_id=$1',[doctorId]);await db.query('delete from doctor_portal.doctor_profiles where id=$1',[doctorId]);}if(policySetId){await db.query('delete from appointments_v2.policy_versions where policy_set_id=$1',[policySetId]);await db.query('delete from appointments_v2.policy_sets where id=$1',[policySetId]);}if(userId){await db.query('delete from audit_log where changed_by_user_id=$1',[userId]);await db.query('delete from users where id=$1',[userId]);}await db.query('commit');
  }catch(error){await db.query('rollback');console.error('Synthetic fixture cleanup failed:',error.message);}finally{db.release();}
  if(workspaceFixture)await workspaceFixture.cleanup();
  if(createdModalityIds.length)await pool.query('delete from modalities where id=any($1::bigint[])',[createdModalityIds]);
  env.uploadsDir=oldUploads;await pool.query("delete from system_settings where category in ('authoritative_orthanc','sonicdicom_reports','documents_and_uploads')");for(const row of originalSettings)await pool.query('insert into system_settings(category,setting_key,setting_value,updated_by_user_id,updated_at) values($1,$2,$3,$4,$5)',[row.category,row.setting_key,row.setting_value,row.updated_by_user_id,row.updated_at]);await pool.query('update ohif_viewer_settings set enabled=$1,native_reporting_enabled=$2,access_strategy=$3,selected_pacs_node_id=$4,allow_prior_studies=$5,max_prior_studies=$6 where singleton_key=true',[originalOhif.enabled,originalOhif.native_reporting_enabled,originalOhif.access_strategy,originalOhif.selected_pacs_node_id,originalOhif.allow_prior_studies,originalOhif.max_prior_studies]);await pool.end();
  const uploads=resolve(temp,'uploads');
  if(dirname(uploads)!==resolve(temp))throw Error('Unsafe synthetic cleanup path');
  await fs.rm(uploads,{recursive:true,force:true});
  if(dbNetworkConnected)docker('network','disconnect',networkName,'rispro-test-postgres');
  if(networkCreated)docker('network','rm',networkName);
}
