import assert from 'node:assert/strict';
import {test,mock} from 'node:test';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import {pool} from '../../db/pool.js';
import {env} from '../../config/env.js';
import {nativeReportingRouter} from './reporting-routes.js';
import {DEFAULT_REPORTING_POLICY} from './reporting-policy.js';
import {DEFAULT_SONICDICOM_REPORT_SETTINGS} from '../../services/sonicdicom-report-settings.js';
import {listWorkspaceStudies} from './workspace-study-service.js';
import {authoritativeOrthancArchiveKey,__setAuthoritativeOrthancSettingsForTests,__setAuthoritativeOrthancFetchForTests,__resetAuthoritativeOrthancForTests} from '../../services/authoritative-orthanc-service.js';

// Real PostgreSQL + authenticated HTTP, synthetic rows only. Roll back the whole
// fixture, including settings; never relax the report retention triggers.
test('large cached catalogue: counts, pagination, query plans and HTTP benchmark',async t=>{
  const target=new URL(env.databaseUrl);
  assert.equal(target.hostname,'localhost');assert.equal(target.port,'5433');assert.equal(target.pathname,'/rispro_test');
  const db=await pool.connect();
  const settings={enabled:true,baseUrl:'http://127.0.0.1:19482',username:'synthetic',password:'synthetic',timeoutSeconds:2,verifyTls:true,displayName:'Synthetic',autoExportClinicalDocuments:false,autoRouteEnabled:false,autoRouteDestinationKey:'',autoRouteDestinationKeys:[]};
  const archiveKey=authoritativeOrthancArchiveKey(settings),prefix='wv2round1_',size=2000;
  const captured:{sql:string;values:unknown[];ms?:number}[]=[];
  const spy=mock.method(pool,'query',(sql:string,values:unknown[]=[])=>{const entry={sql,values:[...values],ms:0},started=performance.now();captured.push(entry);return db.query(sql,values).then(result=>{entry.ms=performance.now()-started;return result;});});
  const app=express();app.use(cookieParser());app.use('/api/native-reporting',nativeReportingRouter);
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
  const origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
  try {
    await db.query('begin');
    if(process.env.WORKSPACE_BENCHMARK_BASELINE==='1') {
      // Reproduce the committed query's original index set in this rollback-only
      // transaction when benchmarking the pre-change source.
      for(const index of ['bookings_reporting_study_uid_idx','source_resolutions_reporting_uid_idx','historical_pacs_reporting_date_page_idx'])await db.query('drop index if exists '+index);
    }
    __setAuthoritativeOrthancSettingsForTests(settings);
    __setAuthoritativeOrthancFetchForTests(async()=>{throw new Error('Catalogue must use PostgreSQL without remote retrieval');});
    await db.query("update system_settings set setting_value=$1 where category='doctor_workspace' and setting_key='reporting_policy'",[JSON.stringify({...DEFAULT_REPORTING_POLICY,enabled:true})]);
    await db.query(`insert into system_settings(category,setting_key,setting_value) values('sonicdicom_reports','sonicdicom_reports_enabled','{"value":"enabled"}') on conflict(category,setting_key) do update set setting_value=excluded.setting_value`);
    await db.query("update system_settings set setting_value=$1 where category='sonicdicom_reports' and setting_key='config'",[JSON.stringify({...DEFAULT_SONICDICOM_REPORT_SETTINGS,sonicDicomReportsEnabled:true,sonicDicomSqlEnabled:true,sonicDicomSqlServer:'synthetic-only'})]);
    await db.query('update historical_pacs_sync_state set source_archive_key=$1,last_success_at=now(),last_error=null',[archiveKey]);
    const uid=(await db.query("insert into users(username,password_hash,full_name,role,is_active) values($1,'synthetic-only',$1,'doctor',true) returning id",[prefix+'doctor'])).rows[0].id;
    const doctor=(await db.query("insert into doctor_portal.doctor_profiles(user_id,display_name,doctor_role,active,can_finalize_reports) values($1,$2,'consultant',true,true) returning id",[uid,prefix+'doctor'])).rows[0].id;
    await db.query("insert into doctor_portal.doctor_modality_permissions(doctor_id,modality_id,can_report,active) select $1,id,true,true from modalities where code in ('CT','MR')",[doctor]);
    await db.query(`insert into historical_pacs_studies(orthanc_study_id,study_instance_uid,patient_id,patient_name_raw,accession_number,study_description,study_date,modalities_in_study,series_count)
      select $1||i,'1.2.826.0.1.3680043.10.999.9.'||i,$1||'P'||i,'Synthetic Patient '||lpad(i::text,5,'0'),$1||'A'||i,'Synthetic exam '||i,
        case when i%2=0 then '20261029' else '20261028' end,case when i%2=0 then array['CT'] else array['MR'] end,2 from generate_series(0,$2-1) i`,[prefix,size]);
    const policy=(await db.query('insert into appointments_v2.policy_sets(key,name) values($1,$1) returning id',[prefix])).rows[0].id;
    const version=(await db.query("insert into appointments_v2.policy_versions(policy_set_id,version_no,status,config_hash) values($1,1,'draft','synthetic') returning id",[policy])).rows[0].id;
    const patient=(await db.query("insert into patients(arabic_full_name,english_full_name,normalized_arabic_name,identifier_type,identifier_value,age_years,sex) values('Synthetic','Synthetic','synthetic','other',$1,40,'O') returning id",[prefix])).rows[0].id;
    await db.query(`insert into appointments_v2.bookings(patient_id,modality_id,booking_date,case_category,status,requires_report,policy_version_id,study_instance_uid)
      select $1,(select id from modalities where code='CT'),current_date,'non_oncology','completed',true,$2,study_instance_uid from historical_pacs_studies
      where orthanc_study_id like $3||'%' and split_part(study_instance_uid,'.',10)::int%10>=5`,[patient,version,prefix]);
    await db.query(`insert into doctor_portal.reporting_board_sonicdicom_cache(appointment_id,report_status,last_attempt_at,last_success_at)
      select id,case split_part(study_instance_uid,'.',10)::int%10 when 5 then 'draft' when 6 then 'final' when 8 then 'no_report' else 'unavailable' end,now(),now()
      from appointments_v2.bookings where policy_version_id=$1`,[version]);
    await db.query(`insert into doctor_portal.case_team_assignments(appointment_id,assigned_doctor_id,modality_id,assignment_type,status)
      select id,$1,modality_id,'reporting','active' from appointments_v2.bookings where policy_version_id=$2`,[doctor,version]);
    await db.query(`insert into native_reporting_studies(source_archive_key,study_instance_uid,orthanc_study_id,identity,modalities)
      select $1,study_instance_uid,orthanc_study_id,jsonb_build_object('patientIdentifier',patient_id),modalities_in_study from historical_pacs_studies where orthanc_study_id like $2||'%'`,[archiveKey,prefix]);
    await db.query(`insert into native_reports(primary_study_uid,imaging_source,identity,sections,author_user_id,author_name,status,report_type,is_primary,review_requested_at,finalized_by_user_id,finalized_at,signed_snapshot)
      select s.study_instance_uid,jsonb_build_object('accessStrategy','authoritative_orthanc','archiveKey',$1::text),s.identity,'{}',$2::bigint,'Synthetic doctor',
        case when i%10 in (3,4) or j=3 then 'final' else 'draft' end,case when i%10=4 or j=3 then 'second_opinion' else 'primary' end,
        i%10=3,case when i%10=2 then now() end,case when i%10 in (3,4) or j=3 then $2::bigint end,
        case when i%10 in (3,4) or j=3 then now() end,case when i%10 in (3,4) or j=3 then '{}'::jsonb end
      from native_reporting_studies s cross join lateral(select split_part(s.study_instance_uid,'.',10)::int i) x
      cross join lateral generate_series(1,case when i%10=9 then 3 else 1 end) j
      where s.source_archive_key=$1 and i%10 in (1,2,3,4,9)`,[archiveKey,uid]);
    await db.query(`insert into native_report_study_links(report_id,study_id) select n.id,s.id from native_reports n join native_reporting_studies s on s.study_instance_uid=n.primary_study_uid where s.source_archive_key=$1`,[archiveKey]);
    await db.query(`update native_reporting_studies s set primary_report_id=n.id from native_reports n where n.primary_study_uid=s.study_instance_uid and n.is_primary and n.status='final' and s.source_archive_key=$1`,[archiveKey]);
    assert.equal((await db.query('select count(*)::int n from appointments_v2.bookings where policy_version_id=$1',[version])).rows[0].n,1000);
    assert.equal((await db.query('select count(*)::int n from native_reports where author_user_id=$1',[uid])).rows[0].n,1400);
    for(const table of ['historical_pacs_studies','native_reports','native_reporting_studies','native_report_study_links','appointments_v2.bookings','doctor_portal.case_team_assignments','doctor_portal.reporting_board_sonicdicom_cache'])await db.query('analyze '+table);
    const cookie=env.cookieName+'='+jwt.sign({sub:Number(uid),role:'doctor'},env.jwtSecret,{expiresIn:'5m'});
    async function request(query:Record<string,string>) {
      const res=await fetch(origin+'/api/native-reporting/workspace/studies?'+new URLSearchParams(query),{headers:{cookie}});
      assert.equal(res.status,200,await res.clone().text());return res.json();
    }
    const scenarios:Record<string,Record<string,string>>={all:{},deep:{offset:'1900'},search:{q:'Synthetic Patient 01999'},date_modality:{modality:'CT',from:'2026-10-29',to:'2026-10-29'},draft:{status:'draft'},my_reports:{status:'my_reports'},patient_sort:{sort:'patient',direction:'asc'}};
    const pageSize=Number(process.env.WORKSPACE_BENCHMARK_PAGE_SIZE)||50;
    const measurements:Record<string,unknown>={};
    for(const [name,params] of Object.entries(scenarios)) {
      const query={q:prefix,limit:String(pageSize),...params};await request(query);const apiMs:number[]=[];
      for(let run=0;run<3;run++){const start=performance.now();await request(query);apiMs.push(performance.now()-start);}
      captured.length=0;const result=await request(query);
      if(name==='all'||name==='deep'){assert.equal(result.total,size);assert.equal(result.studies.length,pageSize);assert.equal(result.limit,pageSize);}
      if(name==='search'){assert.equal(result.total,1);assert.equal(result.studies[0].orthanc_study_id,prefix+'1999');}
      const plans=[];
      for(const q of captured.filter(q=>q.sql.includes('catalogue')||q.sql.includes('historical_pacs_studies s'))) {
        const plan=(await db.query('explain (analyze,buffers,format json) '+q.sql,q.values)).rows[0]['QUERY PLAN'][0];
        plans.push({sql:q.sql,values:q.values,plan});
      }
      measurements[name]={apiMs,medianApiMs:[...apiMs].sort((a,b)=>a-b)[1],total:result.total,queries:captured.map(q=>({sql:q.sql,ms:q.ms})),plans};
    }
    if(process.env.WORKSPACE_BENCHMARK_BASELINE!=='1'&&process.env.WORKSPACE_BENCHMARK_MEASURE_ONLY!=='1') {
      // Exact filter semantics, independent native/external state, and complete
      // pagination with no duplicates or loss of PACS-only rows.
      for(const [status,total] of Object.entries({no_report:1000,draft:400,in_review:200,final:200,additional_reports:200,my_reports:1000,my_drafts:600,external_draft:200,external_final:200,not_checked:1000,external_unavailable:400})) {
        const result=await request({q:prefix,status,limit:'100'});assert.equal(result.total,total,status);
      }
      const seen=new Set<string>();
      for(let offset=0;offset<size;offset+=100)for(const s of (await request({q:prefix,limit:'100',offset:String(offset)})).studies){assert.ok(!seen.has(s.orthanc_study_id));seen.add(s.orthanc_study_id);}
      assert.equal(seen.size,size);
      for(const [i,native,external] of [[0,'no_report','not_checked'],[1,'draft','not_checked'],[2,'in_review','not_checked'],[3,'final','not_checked'],[4,'additional_reports','not_checked'],[5,'no_report','external_draft'],[6,'no_report','external_final'],[7,'no_report','external_unavailable'],[8,'no_report','external_no_report']] as const) {
        const row=(await request({q:prefix+'A'+i,sort:'patient',direction:'asc'})).studies[0];
        assert.equal(row.reporting_status,native);assert.equal(row.external_reporting_status,external);assert.equal(row.orthanc_study_id,prefix+i);
      }
      // Exercise resolution-only and duplicate direct/resolved identity paths.
      await db.query(`insert into study_source_resolutions(appointment_id,accession_number,study_instance_uid,source_kind,resolution_method)
        select id,$2||id,study_instance_uid,'authoritative_orthanc','persisted_uid_verified' from appointments_v2.bookings where policy_version_id=$1`,[version,prefix]);
      await db.query(`update appointments_v2.bookings set study_instance_uid=null where policy_version_id=$1 and split_part(study_instance_uid,'.',10)::int%10=8`,[version]);
      const matched=await request({q:prefix,status:'external_draft'});assert.equal(matched.total,200);assert.equal(matched.studies.length,50);
      assert.equal((await request({q:'Synthetic Patient 00008'})).studies[0].external_reporting_status,'external_no_report');
      const actor={userId:Number(uid),appRole:'doctor' as const};
      assert.equal((await listWorkspaceStudies(actor,{q:prefix},true)).total,1000);
      assert.equal((await listWorkspaceStudies(actor,{q:prefix,status:'my_reports'},true)).total,200);
      assert.equal((await listWorkspaceStudies(actor,{q:prefix,status:'external_draft'},true)).total,200);
    }
    const output=process.env.WORKSPACE_BENCHMARK_OUTPUT;
    if(output){const path=resolve(output);assert.ok(path.startsWith(resolve('test-results')+'/')||path.startsWith(resolve('test-results')+'\\'));await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify({size,appointments:1000,reports:1400,measurements},null,2));}
    t.diagnostic(JSON.stringify(Object.fromEntries(Object.entries(measurements).map(([k,v])=>[k,(v as {medianApiMs:number}).medianApiMs]))));
  } finally {
    await new Promise<void>(r=>server.close(()=>r()));spy.mock.restore();__resetAuthoritativeOrthancForTests();await db.query('rollback');db.release();await pool.end();
  }
});

