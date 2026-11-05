import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pool } from '../pool.js';

test('247 preserves legacy authorization, sessions and credentials and converts Gamma Knife-only accounts', async () => {
  const client = await pool.connect();
  const schema = `module_migration_${randomUUID().replaceAll('-', '')}`;
  try {
    await client.query('begin');
    await client.query(`create schema ${schema}; set local search_path to ${schema}`);
    await client.query(`create table users(id bigint primary key, role text, gamma_knife_only boolean not null default false,auth_version integer,password_hash text);
      insert into users values(1,'doctor',true,7,'unchanged'),(2,'receptionist',false,4,'unchanged'),(3,'super_admin',false,2,'unchanged');`);
    await client.query(await readFile(new URL('./247_user_module_access.sql', import.meta.url), 'utf8'));
    const users = (await client.query('select * from users order by id')).rows;
    assert.equal(users[0].module_access_mode, 'restricted');
    assert.equal(users[0].default_landing_module, 'gamma-knife');
    assert.deepEqual((await client.query('select user_id,module_id from user_module_grants')).rows, [{ user_id: '1', module_id: 'gamma-knife' }]);
    assert.deepEqual(users.map(u => u.auth_version), [7,4,2]);
    assert.ok(users.every(u => u.password_hash === 'unchanged'));
    assert.deepEqual(users.slice(1).map(u => u.module_access_mode), ['legacy','legacy']);
    await client.query("insert into users(id,role,gamma_knife_only) values(4,'doctor',true)");
    assert.equal((await client.query('select module_access_mode from users where id=4')).rows[0].module_access_mode, 'restricted');
    await client.query('update users set gamma_knife_only=false where id=4');
    assert.equal((await client.query('select module_access_mode from users where id=4')).rows[0].module_access_mode, 'restricted', 'stale compatibility writes never reopen Core');
    await client.query("insert into users(id,role) values(5,'supervisor'); update user_module_grants set granted_by=5 where user_id=4; delete from users where id=5");
    assert.equal((await client.query('select granted_by from user_module_grants where user_id=4')).rows[0].granted_by,null,'deleting an administrator preserves other users grants');
  } finally { await client.query('rollback'); client.release(); }
});
