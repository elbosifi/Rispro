import { pool } from "../../db/pool.js";
import type { DbExecutor } from "../../types/db.js";
import type { UserId } from "../../types/http.js";
import { HttpError } from "../../utils/http-error.js";
import { getPacsNode, type PacsNodeRow } from "../../services/pacs-node-service.js";
import type { ImagingStudy, OhifAccessStrategy, OhifViewerConfiguration, OhifViewerSettings, PacsWebEndpoint } from "./types.js";

type Row = Record<string, unknown>;

function nullableText(value: unknown): string | null {
  const clean = String(value ?? "").trim();
  return clean || null;
}

function settingsRow(row: Row): OhifViewerSettings {
  return {
    enabled: row.enabled === true,
    ohifPublicBaseUrl: String(row.ohif_public_base_url || "/ohif"),
    selectedPacsNodeId: row.selected_pacs_node_id == null ? null : Number(row.selected_pacs_node_id),
    accessStrategy: String(row.access_strategy || "native_dicomweb") as OhifViewerSettings["accessStrategy"],
    orthancGatewayEnabled: row.orthanc_gateway_enabled === true,
    orthancModalityKey: nullableText(row.orthanc_modality_key),
    openMode: String(row.open_mode || "new_tab") as OhifViewerSettings["openMode"],
    allowPriorStudies: row.allow_prior_studies !== false,
    maxPriorStudies: Number(row.max_prior_studies || 5),
    launchTokenTtlSeconds: Number(row.launch_token_ttl_seconds || 600),
    cacheRetentionHours: Number(row.cache_retention_hours || 24),
    retrievalTimeoutSeconds: Number(row.retrieval_timeout_seconds || 300),
    updatedAt: String(row.updated_at || new Date(0).toISOString()),
  };
}

function endpointRow(row: Row | undefined): PacsWebEndpoint | null {
  if (!row) return null;
  return {
    id: Number(row.id),
    pacsNodeId: Number(row.pacs_node_id),
    enabled: row.enabled === true,
    dicomwebBaseUrl: String(row.dicomweb_base_url || ""),
    qidoRoot: String(row.qido_root || ""),
    wadoRsRoot: String(row.wado_rs_root || ""),
    wadoUriRoot: nullableText(row.wado_uri_root),
    stowRoot: nullableText(row.stow_root),
    authType: String(row.auth_type || "none") as PacsWebEndpoint["authType"],
    usernameEnvKey: nullableText(row.username_env_key),
    passwordEnvKey: nullableText(row.password_env_key),
    bearerTokenEnvKey: nullableText(row.bearer_token_env_key),
    verifyTls: row.verify_tls !== false,
    timeoutSeconds: Number(row.timeout_seconds || 30),
    osirixVersion: nullableText(row.osirix_version),
    dicomwebServerEnabled: row.dicomweb_server_enabled == null ? null : row.dicomweb_server_enabled === true,
    lastTestedAt: nullableText(row.last_tested_at),
    lastTestStatus: nullableText(row.last_test_status),
    lastTestMessage: nullableText(row.last_test_message),
    qidoLastStatus: nullableText(row.qido_last_status),
    wadoMetadataLastStatus: nullableText(row.wado_metadata_last_status),
    wadoFrameLastStatus: nullableText(row.wado_frame_last_status),
    authenticationLastStatus: nullableText(row.authentication_last_status),
    tlsLastStatus: nullableText(row.tls_last_status),
    corsLastStatus: nullableText(row.cors_last_status),
  };
}

export async function readOhifViewerConfiguration(executor: DbExecutor = pool): Promise<OhifViewerConfiguration> {
  const result = await executor.query<Row>(`select * from ohif_viewer_settings where singleton_key = true limit 1`);
  const settings = settingsRow(result.rows[0] ?? {});
  let selectedPacsNode: PacsNodeRow | null = null;
  let webEndpoint: PacsWebEndpoint | null = null;
  if (settings.selectedPacsNodeId) {
    selectedPacsNode = await getPacsNode(settings.selectedPacsNodeId).catch(() => null);
    const endpoint = await executor.query<Row>(`select * from pacs_web_endpoints where pacs_node_id = $1 limit 1`, [settings.selectedPacsNodeId]);
    webEndpoint = endpointRow(endpoint.rows[0]);
  }
  return { settings, selectedPacsNode, webEndpoint };
}

export async function saveOhifViewerConfiguration(input: {
  settings: Omit<OhifViewerSettings, "updatedAt">;
  endpoint: Omit<PacsWebEndpoint, "id" | "pacsNodeId" | "lastTestedAt" | "lastTestStatus" | "lastTestMessage" | "qidoLastStatus" | "wadoMetadataLastStatus" | "wadoFrameLastStatus" | "authenticationLastStatus" | "tlsLastStatus" | "corsLastStatus"> | null;
  userId: UserId;
}): Promise<OhifViewerConfiguration> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const settings = input.settings;
    await client.query(
      `update ohif_viewer_settings set enabled=$1, ohif_public_base_url=$2, selected_pacs_node_id=$3,
       access_strategy=$4, orthanc_gateway_enabled=$5, orthanc_modality_key=$6, open_mode=$7,
       allow_prior_studies=$8, max_prior_studies=$9, launch_token_ttl_seconds=$10,
       cache_retention_hours=$11, retrieval_timeout_seconds=$12, updated_by_user_id=$13, updated_at=now()
       where singleton_key=true`,
      [settings.enabled, settings.ohifPublicBaseUrl, settings.selectedPacsNodeId, settings.accessStrategy,
       settings.orthancGatewayEnabled, settings.orthancModalityKey, settings.openMode, settings.allowPriorStudies,
       settings.maxPriorStudies, settings.launchTokenTtlSeconds, settings.cacheRetentionHours,
       settings.retrievalTimeoutSeconds, input.userId]
    );
    if (settings.selectedPacsNodeId && input.endpoint) {
      const endpoint = input.endpoint;
      await client.query(
        `insert into pacs_web_endpoints
          (pacs_node_id,enabled,dicomweb_base_url,qido_root,wado_rs_root,wado_uri_root,stow_root,auth_type,
           username_env_key,password_env_key,bearer_token_env_key,verify_tls,timeout_seconds,osirix_version,
           dicomweb_server_enabled,created_by_user_id,updated_by_user_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16)
         on conflict (pacs_node_id) do update set enabled=excluded.enabled,dicomweb_base_url=excluded.dicomweb_base_url,
           qido_root=excluded.qido_root,wado_rs_root=excluded.wado_rs_root,wado_uri_root=excluded.wado_uri_root,
           stow_root=excluded.stow_root,auth_type=excluded.auth_type,username_env_key=excluded.username_env_key,
           password_env_key=excluded.password_env_key,bearer_token_env_key=excluded.bearer_token_env_key,
           verify_tls=excluded.verify_tls,timeout_seconds=excluded.timeout_seconds,osirix_version=excluded.osirix_version,
           dicomweb_server_enabled=excluded.dicomweb_server_enabled,updated_by_user_id=excluded.updated_by_user_id,updated_at=now()`,
        [settings.selectedPacsNodeId, endpoint.enabled, endpoint.dicomwebBaseUrl, endpoint.qidoRoot,
         endpoint.wadoRsRoot, endpoint.wadoUriRoot, endpoint.stowRoot, endpoint.authType,
         endpoint.usernameEnvKey, endpoint.passwordEnvKey, endpoint.bearerTokenEnvKey, endpoint.verifyTls,
         endpoint.timeoutSeconds, endpoint.osirixVersion, endpoint.dicomwebServerEnabled, input.userId]
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  return readOhifViewerConfiguration();
}

export async function updatePacsWebDiagnostic(pacsNodeId: number, patch: Partial<{
  lastTestStatus: string; lastTestMessage: string; qidoLastStatus: string; wadoMetadataLastStatus: string;
  wadoFrameLastStatus: string; authenticationLastStatus: string; tlsLastStatus: string; corsLastStatus: string;
}>): Promise<void> {
  await pool.query(
    `update pacs_web_endpoints set last_tested_at=now(), last_test_status=coalesce($2,last_test_status),
     last_test_message=coalesce($3,last_test_message), qido_last_status=coalesce($4,qido_last_status),
     wado_metadata_last_status=coalesce($5,wado_metadata_last_status), wado_frame_last_status=coalesce($6,wado_frame_last_status),
     authentication_last_status=coalesce($7,authentication_last_status), tls_last_status=coalesce($8,tls_last_status),
     cors_last_status=coalesce($9,cors_last_status), updated_at=now() where pacs_node_id=$1`,
    [pacsNodeId, patch.lastTestStatus ?? null, patch.lastTestMessage ?? null, patch.qidoLastStatus ?? null,
     patch.wadoMetadataLastStatus ?? null, patch.wadoFrameLastStatus ?? null, patch.authenticationLastStatus ?? null,
     patch.tlsLastStatus ?? null, patch.corsLastStatus ?? null]
  );
}

export async function findPacsWebEndpoint(pacsNodeId: number): Promise<PacsWebEndpoint | null> {
  const result = await pool.query<Row>(`select * from pacs_web_endpoints where pacs_node_id=$1 limit 1`, [pacsNodeId]);
  return endpointRow(result.rows[0]);
}

export interface PersistedStudyResolution {
  id: number;
  appointmentId: number;
  accessionNumber: string;
  patientIdValue: string | null;
  studyInstanceUid: string;
  sourcePacsNodeId: number;
  resolutionMethod: string;
  lastVerifiedAt: string;
}

function resolutionRow(row: Row): PersistedStudyResolution {
  return {
    id: Number(row.id), appointmentId: Number(row.appointment_id), accessionNumber: String(row.accession_number),
    patientIdValue: nullableText(row.patient_id_value), studyInstanceUid: String(row.study_instance_uid),
    sourcePacsNodeId: Number(row.source_pacs_node_id), resolutionMethod: String(row.resolution_method),
    lastVerifiedAt: String(row.last_verified_at),
  };
}

export async function findStudyResolution(appointmentId: number, sourcePacsNodeId: number): Promise<PersistedStudyResolution | null> {
  const result = await pool.query<Row>(`select * from study_source_resolutions where appointment_id=$1 and source_pacs_node_id=$2 limit 1`, [appointmentId, sourcePacsNodeId]);
  return result.rows[0] ? resolutionRow(result.rows[0]) : null;
}

export async function upsertStudyResolution(input: {
  appointmentId: number; accessionNumber: string; patientIdValue: string | null; study: ImagingStudy;
  sourcePacsNodeId: number; resolutionMethod: "persisted_uid_verified" | "exact_accession" | "orthanc_remote_query";
  diagnostic: Record<string, unknown>;
}): Promise<PersistedStudyResolution> {
  const result = await pool.query<Row>(
    `insert into study_source_resolutions
      (appointment_id,accession_number,patient_id_value,study_instance_uid,source_pacs_node_id,resolution_method,safe_diagnostic_json)
     values ($1,$2,$3,$4,$5,$6,$7::jsonb)
     on conflict (appointment_id,source_pacs_node_id) do update set accession_number=excluded.accession_number,
       patient_id_value=excluded.patient_id_value,study_instance_uid=excluded.study_instance_uid,
       resolution_method=excluded.resolution_method,safe_diagnostic_json=excluded.safe_diagnostic_json,
       last_verified_at=now(),updated_at=now() returning *`,
    [input.appointmentId, input.accessionNumber, input.patientIdValue, input.study.studyInstanceUid,
     input.sourcePacsNodeId, input.resolutionMethod, JSON.stringify(input.diagnostic)]
  );
  return resolutionRow(result.rows[0]);
}

export async function createViewerLaunchSession(input: {
  userId: UserId; appointmentId: number; sourcePacsNodeId: number; accessStrategy: OhifAccessStrategy;
  currentStudyUid: string; permittedStudyUids: string[]; tokenHash: string; expiresAt: Date;
}): Promise<number> {
  const result = await pool.query<{ id: string }>(
    `insert into viewer_launch_sessions
      (user_id,case_id,appointment_id,source_pacs_node_id,access_strategy,study_instance_uid,permitted_study_uids,token_hash,expires_at)
     values ($1,$2,$2,$3,$4,$5,$6::jsonb,$7,$8) returning id`,
    [input.userId, input.appointmentId, input.sourcePacsNodeId, input.accessStrategy, input.currentStudyUid,
     JSON.stringify(input.permittedStudyUids), input.tokenHash, input.expiresAt.toISOString()]
  );
  return Number(result.rows[0]?.id);
}

export interface ViewerLaunchSessionRecord {
  id: number; userId: number; appointmentId: number; studyInstanceUid: string; permittedStudyUids: string[];
  sourcePacsNodeId: number; accessStrategy: OhifAccessStrategy; expiresAt: string; usedAt: string | null; revokedAt: string | null;
}

function launchSessionRow(row: Row): ViewerLaunchSessionRecord {
  return {
    id: Number(row.id), userId: Number(row.user_id), appointmentId: Number(row.appointment_id),
    studyInstanceUid: String(row.study_instance_uid),
    permittedStudyUids: Array.isArray(row.permitted_study_uids) ? row.permitted_study_uids.map(String) : [],
    sourcePacsNodeId: Number(row.source_pacs_node_id),
    accessStrategy: String(row.access_strategy) as OhifAccessStrategy, expiresAt: String(row.expires_at),
    usedAt: nullableText(row.used_at), revokedAt: nullableText(row.revoked_at),
  };
}

export async function consumeViewerLaunchToken(
  launchTokenHash: string,
  userId: UserId,
  viewerSessionTokenHash: string,
  executor: DbExecutor = pool,
): Promise<ViewerLaunchSessionRecord | null> {
  const result = await executor.query<Row>(
    `update viewer_launch_sessions set used_at=now(), viewer_session_token_hash=$3
     where token_hash=$1 and user_id=$2 and used_at is null and revoked_at is null and expires_at>now()
     returning *`, [launchTokenHash, userId, viewerSessionTokenHash]
  );
  return result.rows[0] ? launchSessionRow(result.rows[0]) : null;
}

export async function findAuthorizedViewerSession(viewerSessionTokenHash: string, userId: UserId, executor: DbExecutor = pool): Promise<ViewerLaunchSessionRecord | null> {
  const result = await executor.query<Row>(
    `select * from viewer_launch_sessions where viewer_session_token_hash=$1 and user_id=$2 and used_at is not null
     and revoked_at is null and expires_at>now() limit 1`, [viewerSessionTokenHash, userId]
  );
  return result.rows[0] ? launchSessionRow(result.rows[0]) : null;
}

export interface RetrievalJobRecord {
  id: number; appointmentId: number; accessionNumber: string; studyInstanceUid: string | null; sourcePacsNodeId: number;
  requestedByUserId: number; status: "queued" | "resolving" | "retrieving" | "available" | "not_found" | "ambiguous" | "failed" | "timed_out";
  orthancJobId: string | null; attemptCount: number; startedAt: string | null; completedAt: string | null; lastError: string | null;
  preexistingOrthancStudyIds: string[]; ownedOrthancStudyId: string | null; cacheOwnershipProven: boolean;
}

function retrievalJobRow(row: Row): RetrievalJobRecord {
  return {
    id: Number(row.id), appointmentId: Number(row.appointment_id), accessionNumber: String(row.accession_number),
    studyInstanceUid: nullableText(row.study_instance_uid), sourcePacsNodeId: Number(row.source_pacs_node_id),
    requestedByUserId: Number(row.requested_by_user_id), status: String(row.status) as RetrievalJobRecord["status"],
    orthancJobId: nullableText(row.orthanc_job_id), attemptCount: Number(row.attempt_count || 0),
    startedAt: nullableText(row.started_at), completedAt: nullableText(row.completed_at), lastError: nullableText(row.last_error),
    preexistingOrthancStudyIds: Array.isArray(row.preexisting_orthanc_study_ids) ? row.preexisting_orthanc_study_ids.map(String) : [],
    ownedOrthancStudyId: nullableText(row.owned_orthanc_study_id), cacheOwnershipProven: row.cache_ownership_proven === true,
  };
}

export async function enqueueRetrievalJob(input: { appointmentId: number; accessionNumber: string; studyInstanceUid: string; sourcePacsNodeId: number; userId: UserId }): Promise<RetrievalJobRecord> {
  const result = await pool.query<Row>(
    `insert into ohif_retrieval_jobs (appointment_id,accession_number,study_instance_uid,source_pacs_node_id,requested_by_user_id)
     values ($1,$2,$3,$4,$5)
     on conflict (source_pacs_node_id,accession_number) where status in ('queued','resolving','retrieving')
     do update set updated_at=now() returning *`,
    [input.appointmentId, input.accessionNumber, input.studyInstanceUid, input.sourcePacsNodeId, input.userId]
  );
  return retrievalJobRow(result.rows[0]);
}

export async function findRetrievalJob(id: number): Promise<RetrievalJobRecord | null> {
  const result = await pool.query<Row>(`select * from ohif_retrieval_jobs where id=$1 limit 1`, [id]);
  return result.rows[0] ? retrievalJobRow(result.rows[0]) : null;
}

export async function claimQueuedRetrievalJobs(limit = 3): Promise<RetrievalJobRecord[]> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await client.query<Row>(
      `with candidates as (select id from ohif_retrieval_jobs where status='queued' order by created_at asc limit $1 for update skip locked)
       update ohif_retrieval_jobs jobs set status='retrieving',attempt_count=attempt_count+1,started_at=coalesce(started_at,now()),updated_at=now()
       from candidates where jobs.id=candidates.id returning jobs.*`, [limit]
    );
    await client.query("commit");
    return result.rows.map(retrievalJobRow);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function listRetrievingJobs(limit = 20): Promise<RetrievalJobRecord[]> {
  const result = await pool.query<Row>(
    `select * from ohif_retrieval_jobs where status='retrieving' order by started_at asc nulls first limit $1`,
    [Math.max(1, Math.min(limit, 100))]
  );
  return result.rows.map(retrievalJobRow);
}

export async function updateRetrievalJob(id: number, patch: { status: RetrievalJobRecord["status"]; orthancJobId?: string | null; lastError?: string | null }): Promise<RetrievalJobRecord> {
  const terminal = ['available','not_found','ambiguous','failed','timed_out'].includes(patch.status);
  const result = await pool.query<Row>(
    `update ohif_retrieval_jobs set status=$2,orthanc_job_id=coalesce($3,orthanc_job_id),last_error=$4,
     completed_at=case when $5 then now() else completed_at end,updated_at=now() where id=$1 returning *`,
    [id, patch.status, patch.orthancJobId ?? null, patch.lastError ?? null, terminal]
  );
  if (!result.rows[0]) throw new HttpError(404, "OHIF retrieval job not found.");
  return retrievalJobRow(result.rows[0]);
}

export async function recordRetrievalCacheBaseline(id: number, orthancStudyIds: string[]): Promise<RetrievalJobRecord> {
  const result = await pool.query<Row>(
    `update ohif_retrieval_jobs set preexisting_orthanc_study_ids=$2::jsonb, updated_at=now()
     where id=$1 and cache_ownership_proven=false returning *`,
    [id, JSON.stringify([...new Set(orthancStudyIds)])]
  );
  if (!result.rows[0]) throw new HttpError(404, "OHIF retrieval job not found.");
  return retrievalJobRow(result.rows[0]);
}

export async function recordOwnedOrthancCacheStudy(id: number, orthancStudyId: string): Promise<RetrievalJobRecord> {
  const result = await pool.query<Row>(
    `update ohif_retrieval_jobs set owned_orthanc_study_id=$2, cache_ownership_proven=true, updated_at=now()
     where id=$1 and cache_ownership_proven=false returning *`,
    [id, orthancStudyId]
  );
  if (!result.rows[0]) throw new HttpError(404, "OHIF retrieval job not found.");
  return retrievalJobRow(result.rows[0]);
}

export async function listExpiredAvailableRetrievalJobs(cacheRetentionHours: number, limit = 10): Promise<RetrievalJobRecord[]> {
  const result = await pool.query<Row>(
    `select jobs.* from ohif_retrieval_jobs jobs
     where jobs.status='available' and jobs.completed_at < now() - ($1::text || ' hours')::interval
       and jobs.study_instance_uid is not null
       and not exists (
         select 1 from viewer_launch_sessions sessions
         where sessions.expires_at>now() and sessions.revoked_at is null
           and sessions.permitted_study_uids ? jobs.study_instance_uid
       )
     order by jobs.completed_at asc limit $2`,
    [Math.max(1, cacheRetentionHours), Math.max(1, Math.min(limit, 100))]
  );
  return result.rows.map(retrievalJobRow);
}

export async function deleteRetrievalJob(id: number): Promise<void> {
  await pool.query(`delete from ohif_retrieval_jobs where id=$1 and status='available'`, [id]);
}

export async function cleanupExpiredViewerSessionsAndJobs(cacheRetentionHours: number): Promise<{ sessions: number; jobs: number }> {
  const sessions = await pool.query(`delete from viewer_launch_sessions where expires_at < now() - interval '1 hour'`);
  const jobs = await pool.query(
    `delete from ohif_retrieval_jobs where status in ('not_found','ambiguous','failed','timed_out')
     and completed_at < now() - ($1::text || ' hours')::interval`, [Math.max(1, cacheRetentionHours)]
  );
  return { sessions: sessions.rowCount || 0, jobs: jobs.rowCount || 0 };
}
