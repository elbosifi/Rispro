// Separate synthetic-only backend process: CPU and DB metrics exclude Playwright.
import { createServer } from 'node:http';
const db = new URL(process.env.DATABASE_URL || 'http://invalid');
const docker=process.env.RISPRO_BENCH_DOCKER==='1';
if (process.env.RISPRO_E2E !== '1' || !(docker?db.hostname==='rispro-test-postgres'&&db.port==='5432':['localhost', '127.0.0.1'].includes(db.hostname)&&db.port==='5433') || db.pathname !== '/rispro_test' || db.username !== 'rispro_test') throw Error('Disposable synthetic benchmark DB only');
const { pool } = await import('../src/db/pool.ts');
const {createApp}=await import('../src/app.ts');
let metrics, cpu;
function reset() { metrics = { queries: 0, queryMs: 0, maxPoolWaiting: 0, poolWaits:0,poolWaitMs:0, proxyFrames: 0, authorizations: 0 }; cpu = process.cpuUsage(); }
reset();
const query = pool.query.bind(pool);
const connect=pool.connect.bind(pool);
pool.connect=callback=>{
  const waiting=pool.idleCount===0&&pool.totalCount>=pool.options.max,start=performance.now();
  if(waiting)metrics.poolWaits++;
  const acquired=()=>{if(waiting)metrics.poolWaitMs+=performance.now()-start;};
  if(callback)return connect((error,client,release)=>{acquired();callback(error,client,release);});
  return connect().then(client=>{acquired();return client;});
};
pool.query = (...args) => {
  metrics.queries++;
  const start = performance.now(), result = query(...args);
  if (result?.then) result.then(() => { metrics.queryMs += performance.now() - start; }, () => {});
  return result;
};
const sample = setInterval(() => { metrics.maxPoolWaiting = Math.max(metrics.maxPoolWaiting, pool.waitingCount); }, 5);
sample.unref();
const app=createApp();
const server = createServer((req, res) => {
  if (req.url?.startsWith('/__benchmark/metrics')) {
    if (req.url.endsWith('?reset=1')) reset();
    const usage = process.cpuUsage(cpu);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ...metrics, cpuMs: (usage.user + usage.system) / 1000 }));
    return;
  }
  if (req.url?.startsWith('/ohif-dicomweb/') && req.url.includes('/frames/')) metrics.proxyFrames++;
  if (req.url?.startsWith('/api/ohif/native/')) metrics.authorizations++;
  app(req, res);
});
await new Promise(r => server.listen(docker?3000:0, docker?'0.0.0.0':'127.0.0.1', r));
if(process.send)process.send({ port: server.address().port });
process.on('message', async message => {
  if (message !== 'close') return;
  server.closeAllConnections();
  await new Promise(r => server.close(r));
  await pool.end();
  process.exit(0);
});
