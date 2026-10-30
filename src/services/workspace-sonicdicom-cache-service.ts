import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import {pool} from '../db/pool.js';
import {readSonicDicomReportSettings,type SonicDicomReportSettings} from './sonicdicom-report-settings.js';
import {checkSonicDicomStudyStatusesBatch} from './sonicdicom-report-service.js';
import {readAuthoritativeOrthancSettings,authoritativeOrthancArchiveKey} from './authoritative-orthanc-service.js';

type Db=Pick<PoolClient,'query'>;
export function workspaceSonicSourceKey(s:SonicDicomReportSettings) {
  return createHash('sha256').update(JSON.stringify([s.sonicDicomSqlServer.trim().toLowerCase(),s.sonicDicomDicomDatabaseName,s.sonicDicomReportDatabaseName,s.sonicDicomReadinessMode,s.sonicDicomSqlFinalStatusCodes,s.sonicDicomSqlDraftStatusCodes,s.sonicDicomSqlNoReportStatusCodes])).digest('hex');
}
// Synchronization timestamps change on every inventory. Only relevant metadata
// changes invalidate an observation; unchanged historical rows keep their TTL.
export const workspaceSonicMetadata=(alias:string)=>`md5(jsonb_build_array(${alias}.study_instance_uid,${alias}.patient_id,${alias}.accession_number,${alias}.study_date,${alias}.modalities_in_study,${alias}.series_count,${alias}.instance_count)::text)`;
export async function enqueueWorkspaceSonicStudies(archiveKey:string,sourceKey:string,keys:string[],db:Db=pool) {
  if(!keys.length)return 0;
  const result=await db.query(`insert into doctor_portal.workspace_sonicdicom_cache as cache(archive_key,sonic_source_key,study_instance_uid,orthanc_study_id,patient_id,metadata_key)
    select $1,$2,h.study_instance_uid,h.orthanc_study_id,h.patient_id,${workspaceSonicMetadata('h')}
    from historical_pacs_studies h where h.orthanc_study_id=any($3::text[]) and h.study_instance_uid ~ '^[0-9]+([.][0-9]+)+$' and length(h.study_instance_uid)<=64 and nullif(trim(h.patient_id),'') is not null
      and not exists(select 1 from historical_pacs_studies duplicate where duplicate.study_instance_uid=h.study_instance_uid and duplicate.orthanc_study_id<>h.orthanc_study_id)
    on conflict(archive_key,sonic_source_key,study_instance_uid) do update set orthanc_study_id=excluded.orthanc_study_id,patient_id=excluded.patient_id,metadata_key=excluded.metadata_key,
      last_error='Study metadata changed. Retained external status requires reverification.',failure_count=0,next_check_at=now()
    where cache.metadata_key<>excluded.metadata_key or cache.orthanc_study_id<>excluded.orthanc_study_id or cache.patient_id<>excluded.patient_id`,[archiveKey,sourceKey,keys.slice(0,200)]);
  return result.rowCount||0;
}

/** Called by the existing SonicDICOM worker under its existing advisory lock.
 * Only demand-enqueued/backfill rows are scanned; deployment seeds no archive. */
export async function refreshWorkspaceSonicStudies(limit=50,db:Db=pool,lookup=checkSonicDicomStudyStatusesBatch) {
  const settings=await readSonicDicomReportSettings(),archive=await readAuthoritativeOrthancSettings();
  if(!archive.enabled||!settings.sonicDicomReportsEnabled||!settings.sonicDicomSqlEnabled||settings.sonicDicomReadinessMode!=='sql_server')return {candidates:0,successful:0,failed:0};
  const archiveKey=authoritativeOrthancArchiveKey(archive),sourceKey=workspaceSonicSourceKey(settings);
  const rows=(await db.query(`select c.*,${workspaceSonicMetadata('h')} current_metadata,h.patient_id current_patient,h.study_date
    from doctor_portal.workspace_sonicdicom_cache c join historical_pacs_studies h on h.orthanc_study_id=c.orthanc_study_id and h.study_instance_uid=c.study_instance_uid
    where c.archive_key=$1 and c.sonic_source_key=$2 and c.next_check_at<=now()
      and exists(select 1 from historical_pacs_sync_state where singleton_key=true and source_archive_key=$1)
      and not exists(select 1 from historical_pacs_studies duplicate where duplicate.study_instance_uid=h.study_instance_uid and duplicate.orthanc_study_id<>h.orthanc_study_id)
    order by c.next_check_at,c.study_instance_uid limit $3`,[archiveKey,sourceKey,Math.max(1,Math.min(200,limit))])).rows;
  if(!rows.length)return {candidates:0,successful:0,failed:0};
  let results:Awaited<ReturnType<typeof lookup>>;
  try{results=await lookup(rows.map(r=>r.study_instance_uid));}catch{results=new Map();}
  const currentSettings=await readSonicDicomReportSettings(),currentArchive=await readAuthoritativeOrthancSettings();
  if(!currentArchive.enabled||!currentSettings.sonicDicomReportsEnabled||!currentSettings.sonicDicomSqlEnabled||workspaceSonicSourceKey(currentSettings)!==sourceKey||authoritativeOrthancArchiveKey(currentArchive)!==archiveKey)return {candidates:rows.length,successful:0,failed:rows.length};
  let successful=0,failed=0;
  for(const row of rows) {
    const result=results.get(row.study_instance_uid),ok=Boolean(result&&['final','draft','no_report','study_not_found'].includes(result.state));
    if(ok)successful++;else failed++;
    await db.query(`update doctor_portal.workspace_sonicdicom_cache c set last_attempt_at=now(),
      report_status=case when $4 then $5 when c.metadata_key<>$8 then null else c.report_status end,report_final_at=case when $4 then $6::timestamptz when c.metadata_key<>$8 then null else c.report_final_at end,
      document_id=case when $4 then $7 when c.metadata_key<>$8 then null else c.document_id end,last_success_at=case when $4 then now() when c.metadata_key<>$8 then null else c.last_success_at end,
      last_error=case when $4 then null else 'SonicDICOM status unavailable; retained observations are not current verification.' end,
      failure_count=case when $4 then 0 else c.failure_count+1 end,metadata_key=$8,patient_id=$9,
      next_check_at=now()+case when not $4 then make_interval(secs=>least(3600,60*power(2,least(c.failure_count,6)))::int)
        when workspace_study_date($10)<(now() at time zone 'Africa/Tripoli')::date-30 then interval '7 days'
        when $5='final' then interval '1 hour' else interval '5 minutes' end
      where c.archive_key=$1 and c.sonic_source_key=$2 and c.study_instance_uid=$3
        and exists(select 1 from historical_pacs_studies h where h.orthanc_study_id=c.orthanc_study_id and h.study_instance_uid=c.study_instance_uid and ${workspaceSonicMetadata('h')}=$8)
        and exists(select 1 from historical_pacs_sync_state where singleton_key=true and source_archive_key=$1)`,[archiveKey,sourceKey,row.study_instance_uid,ok,ok?result!.state:null,result?.reportFinalAt??null,result?.latestDocumentId??null,row.current_metadata,row.current_patient,row.study_date]);
  }
  return {candidates:rows.length,successful,failed};
}
