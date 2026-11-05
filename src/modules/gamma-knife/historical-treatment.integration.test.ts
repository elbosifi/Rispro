import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../app.js';
import { pool } from '../../db/pool.js';
import { seedTestData, cleanupTestData, createTestAuthCookie, type TestData } from '../appointments-v2/tests/integration/helpers.js';

const prefix = `gkhistorical_${randomUUID().replaceAll('-','').slice(0,10)}_`;
let fixture: TestData;
let other: TestData;
let server: Server;
let base: string;
let cookie: string;
let currentId: number;
let previousId: number;
let foreignId: number;
let courseId: number;
const episodes: number[] = [];
async function call(path: string, body?: unknown) {
  return fetch(base + path, {method:body === undefined ? 'GET':'POST',headers:{cookie,'content-type':'application/json'},...(body === undefined ? {} : {body:JSON.stringify(body)})});
}

describe('cross-episode historical treatment evidence (separate from module authorization)', () => {
  before(async () => {
    fixture = await seedTestData('appointments_v2',prefix);
    other = await seedTestData('appointments_v2',prefix+'other_');
    await pool.query("update users set gamma_knife_permissions=array['access','clinical','treatment']::text[] where id=$1",[fixture.userId]);
    cookie = createTestAuthCookie(fixture.userId);
    for (const [patient,active] of [[fixture.patientId,false],[other.patientId,false],[fixture.patientId,true]] as const) {
      const id = Number((await pool.query(`insert into gamma_knife_episodes(patient_id,diagnosis,diagnosis_category,status,active,data,created_by) values($1,'Synthetic historical treatment','Other',$2,$3,$4::jsonb,$5) returning id`,[patient,active?'clinical_review':'closed',active,JSON.stringify(active?{}:{treatment:{completed:true,date:'2020-01-01',immobilization:'frame',fractions:1,team:['Historical record'],reportId:null,finalized:false}}),fixture.userId])).rows[0].id);
      episodes.push(id);
    }
    [previousId,foreignId,currentId] = episodes;
    courseId = Number((await pool.query(`insert into gamma_knife_treatment_courses(episode_id,course_number,immobilization,planned_fraction_count,status,completion_confirmed,completion_reason,completed_at,completed_by,created_by) values($1,1,'frame',1,'completed',true,'Synthetic historical evidence','2020-01-01',$2,$2) returning id`,[previousId,fixture.userId])).rows[0].id);
    server = createServer(createApp());
    await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
    base = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
  });
  after(async () => {
    if (server) await new Promise<void>((resolve,reject) => server.close(e => e?reject(e):resolve()));
    await pool.query('delete from gamma_knife_historical_references where episode_id=any($1::bigint[])',[episodes]);
    await pool.query('delete from gamma_knife_history where episode_id=any($1::bigint[])',[episodes]);
    if (courseId) await pool.query('delete from gamma_knife_treatment_courses where id=$1',[courseId]);
    await pool.query('delete from gamma_knife_episodes where id=any($1::bigint[])',[episodes]);
    await cleanupTestData(prefix+'other_');
    await cleanupTestData(prefix);
    await pool.end();
  });
  it('links completed evidence in an earlier episode, retains history and current approval requirements', async () => {
    const denied = await call(`/api/gamma-knife/episodes/${currentId}/historical-treatment-references`,{revision:1,priorEpisodeId:foreignId,reason:'Wrong patient'});
    assert.equal(denied.status,409);
    const link = await call(`/api/gamma-knife/episodes/${currentId}/historical-treatment-references`,{revision:1,priorEpisodeId:previousId,priorCourseId:courseId,reason:'Documented prior radiosurgery at this hospital'});
    assert.equal(link.status,201,await link.clone().text());
    const profile = await (await call(`/api/gamma-knife/episodes/${currentId}`)).json() as {historicalTreatment:{references:unknown[]};episode:{revision:number;status:string;data:Record<string,unknown>};history:{action:string}[]};
    assert.equal(profile.historicalTreatment.references.length,1);
    assert.equal(profile.episode.revision,2);
    assert.equal(profile.episode.status,'clinical_review');
    assert.equal(profile.episode.data.mdt,undefined);
    assert.equal(profile.history[0].action,'historical_treatment_linked');
    assert.equal((await call(`/api/gamma-knife/episodes/${currentId}/courses`,{revision:2,immobilization:'frame',plannedFractionCount:1,gammaPlanReference:'Synthetic new plan'})).status,409);
    assert.equal((await call(`/api/gamma-knife/episodes/${currentId}/historical-treatment-references`,{revision:1,priorEpisodeId:previousId,priorCourseId:courseId,reason:'Stale write'})).status,409);
    assert.equal((await pool.query('select count(*)::int as count from gamma_knife_episodes where patient_id=$1 and active',[fixture.patientId])).rows[0].count,1);
    const client=await pool.connect();
    try {
      await client.query('begin');
      await assert.rejects(client.query("insert into gamma_knife_historical_references(episode_id,prior_episode_id,reason,created_by) values($1,$2,'Wrong patient',$3)",[currentId,foreignId,fixture.userId]),{code:'23514'});
    } finally {await client.query('rollback');client.release();}
  });
});
