import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../../docs/mobile/rispro-operations-widget.js", import.meta.url), "utf8");
const counts = {totalAppointments:47,scheduled:21,arrived:5,waiting:6,inProgress:3,inQueue:14,completed:10,noShow:1,cancelled:1,discontinued:0,voided:0,walkIn:2};
function fixture() { return {schemaVersion:1,date:"2026-09-25",timezone:"Africa/Tripoli",generatedAt:"2026-09-25T08:00:00Z",totals:counts,waiting:{count:6,oldestWaitingMinutes:42,over30Minutes:3,over60Minutes:0,unknownDurationCount:0},modalities:[{code:"CT",...counts}]}; }
function harness({status=200,payload=fixture(),offline=false}={}) {
  const requests=[]; const lines=[];
  class Color { static dynamic(light) { return light; } }
  class ListWidget { addText(value){lines.push(value);return {};} addSpacer(){} setPadding(){} }
  class Request { constructor(url){this.url=url;requests.push(this);} async loadString(){if(offline)throw new Error("offline");this.response={statusCode:status};return JSON.stringify(payload);} }
  const context=vm.createContext({Request,Color,ListWidget,Font:{systemFont:()=>null,boldSystemFont:()=>null},Date});
  vm.runInContext(source.replace(/await main\(\);\s*$/, "")+"\nthis.exports = {parseSummary,selectModality,loadSummary,renderWidget,normalizeBase};",context);
  return {...context.exports,requests,lines};
}
function cache(value=null) { return {value,read(){return this.value;},write(next){this.value=next;},clear(){this.value=null;}}; }
const secret=`rwm_${"a".repeat(43)}`;
test("Scriptable source parses as an async script and contains no embedded credential",()=>{
  new vm.Script(`(async()=>{${source}\n})`); assert.ok(!source.includes(secret));
});
test("validated projection drops unexpected PHI/secret fields and rejects malformed values",()=>{
  const h=harness(); const raw={...fixture(),patientName:"PHI_TEST_PATIENT_NAME_123",secret};
  const result=h.parseSummary(raw); assert.ok(!JSON.stringify(result).includes("PHI_TEST"));assert.ok(!JSON.stringify(result).includes(secret));
  for(const raw of [{}, {...fixture(),schemaVersion:2}, {...fixture(),totals:{...counts,waiting:-1}}, {...fixture(),modalities:null}])assert.throws(()=>h.parseSummary(raw));
});
test("modality parameter matches case insensitively and invalid falls back",()=>{
  const h=harness();assert.equal(h.selectModality(fixture()," ct ").code,"CT");assert.equal(h.selectModality(fixture(),"bad"),null);assert.equal(h.selectModality(fixture(),"all"),null);
});
test("successful fetch uses header only, rejects redirects and caches projected aggregates",async()=>{
  const h=harness();const c=cache();const result=await h.loadSummary("https://rispro.example",secret,c);
  assert.equal(result.state,"live");assert.equal(h.requests.length,1);assert.equal(h.requests[0].headers.Authorization,`Bearer ${secret}`);
  assert.ok(!h.requests[0].url.includes(secret));assert.equal(h.requests[0].onRedirect(),null);assert.ok(!JSON.stringify(c.value).includes(secret));
});
test("offline fallback preserves original timestamp; malformed cache never renders",async()=>{
  const h=harness({offline:true});const result=await h.loadSummary("https://rispro.example",secret,cache(fixture()),new Date("2026-09-26"));
  assert.equal(result.state,"offline");assert.equal(result.data.generatedAt,fixture().generatedAt);
  assert.equal((await h.loadSummary("https://rispro.example",secret,cache({schemaVersion:2}))).data,null);
});
test("unsupported schema says update; malformed response falls back safely",async()=>{
  const update=harness({payload:{schemaVersion:2}});assert.equal((await update.loadSummary("https://rispro.example",secret,cache())).state,"update");
  const bad=harness({payload:{schemaVersion:1}});assert.equal((await bad.loadSummary("https://rispro.example",secret,cache())).state,"offline");
});
test("missing token makes no request; expired token discards cache",async()=>{
  const h=harness({status:401});assert.equal((await h.loadSummary("https://rispro.example","",cache())).state,"setup");assert.equal(h.requests.length,0);
  const c=cache(fixture());assert.equal((await h.loadSummary("https://rispro.example",secret,c,new Date("2026-09-26"))).state,"credential");assert.equal(c.value,null);
});
test("fresh cache throttles repeated requests",async()=>{
  const h=harness();await h.loadSummary("https://rispro.example",secret,cache(fixture()),new Date("2026-09-25T08:05:00Z"));assert.equal(h.requests.length,0);
});
for(const family of ["small","medium","large","accessoryRectangular","accessoryCircular","accessoryInline"])test(`renders ${family} with safe deep link and last update`,()=>{
  const h=harness();const widget=h.renderWidget({data:fixture(),state:"offline"},family,"CT","https://rispro.example");
  assert.equal(widget.url,"https://rispro.example/queue");assert.ok(h.lines.some(line=>line.includes("10:00")));assert.ok(h.lines.some(line=>/stale/i.test(line)));
  assert.ok(widget.refreshAfterDate.getTime()>Date.now()+14*60000);assert.ok(!JSON.stringify(h.lines).includes(secret));
});
test("base URL rejects cleartext, embedded credentials, query and path",()=>{
  const h=harness();for(const value of ["http://host","https://token@host","https://host?token=x","https://host/path"])assert.throws(()=>h.normalizeBase(value));
});
