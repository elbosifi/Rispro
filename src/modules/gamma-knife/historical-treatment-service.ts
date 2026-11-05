import type { PoolClient } from 'pg';
import { pool } from '../../db/pool.js';
import { HttpError } from '../../utils/http-error.js';
import { logAuditEntry } from '../../services/audit-service.js';
import { authorize, findEpisode, type Actor } from './gamma-knife-service.js';
import { id, record, text } from './gamma-knife-validation.js';

export async function historicalTreatments(episodeId: number, db: PoolClient | typeof pool = pool) {
  const references = await db.query(`select r.id,r.prior_episode_id as "priorEpisodeId",r.prior_course_id as "priorCourseId",r.reason,r.created_at as "createdAt",u.full_name as actor
    from gamma_knife_historical_references r join users u on u.id=r.created_by where r.episode_id=$1 order by r.id`, [episodeId]);
  const candidates = await db.query(`select p.id as "episodeId",c.id as "courseId",c.course_number as "courseNumber"
    from gamma_knife_episodes e join gamma_knife_episodes p on p.patient_id=e.patient_id and p.id<>e.id and not p.active and p.created_at<=e.created_at
    left join gamma_knife_treatment_courses c on c.episode_id=p.id and c.status='completed'
    where e.id=$1 and (c.id is not null or (p.data->'treatment'->>'completed')::boolean is true) order by p.id,c.id`, [episodeId]);
  return { references: references.rows, candidates: candidates.rows };
}

export async function linkHistoricalTreatment(actor: Actor, episodeId: unknown, input: unknown) {
  const body = record(input);
  const priorEpisodeId = id(body.priorEpisodeId);
  const priorCourseId = body.priorCourseId == null ? null : id(body.priorCourseId);
  const reason = text(body.reason, 'Historical treatment reference reason', true, 4000);
  const client = await pool.connect();
  try {
    await client.query('begin');
    await authorize(actor, 'clinical', client);
    const episode = await findEpisode(episodeId, client, true);
    if (!episode.active || episode.revision !== Number(body.revision)) throw new HttpError(409, 'Episode is closed or changed. Reload before linking historical treatment.');
    const eligible = await historicalTreatments(episode.id, client);
    if (!eligible.candidates.some(c => Number(c.episodeId) === priorEpisodeId && (c.courseId == null ? null : Number(c.courseId)) === priorCourseId)) throw new HttpError(409, 'Select completed treatment from an earlier closed episode of the same patient.');
    await client.query('insert into gamma_knife_historical_references(episode_id,prior_episode_id,prior_course_id,reason,created_by) values($1,$2,$3,$4,$5)', [episode.id,priorEpisodeId,priorCourseId,reason,actor.sub]);
    await client.query('update gamma_knife_episodes set revision=revision+1,updated_at=now() where id=$1',[episode.id]);
    const details = { priorEpisodeId, priorCourseId, reason };
    await client.query(`insert into gamma_knife_history(episode_id,revision,action,snapshot,actor_id) values($1,$2,'historical_treatment_linked',$3::jsonb,$4)`, [episode.id,episode.revision+1,JSON.stringify({data:episode.data,status:episode.status,reason,details}),actor.sub]);
    await logAuditEntry({entityType:'gamma_knife_episode',entityId:episode.id,actionType:'historical_treatment_linked',newValues:details,changedByUserId:actor.sub},client);
    await client.query('commit');
    return { revision:episode.revision+1, ...await historicalTreatments(episode.id) };
  } catch (error) {
    await client.query('rollback');
    if ((error as {code?:string}).code === '23505') throw new HttpError(409, 'This historical episode is already linked.');
    throw error;
  } finally { client.release(); }
}
