import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { EMPTY_SECTIONS, sections, provenance, validatePng } from "./reporting-validation.js";

test("report text is explicit, preserves paste, and never fabricates findings", () => {
  assert.deepEqual(sections(EMPTY_SECTIONS), EMPTY_SECTIONS);
  assert.equal(sections({...EMPTY_SECTIONS,findings:"Line 1\nخط ثان"}).findings,"Line 1\nخط ثان");
  assert.throws(()=>sections({...EMPTY_SECTIONS,findings:5}));
});
test("reconstructed planes cannot invent a SOP; native frames are one based", () => {
  const camera = {viewPlaneNormal:[0,0,1],viewUp:[0,-1,0],position:[0,0,10],focalPoint:[0,0,0]};
  const p = {studyInstanceUid:"1.2.3",seriesInstanceUid:"1.2.4",sopInstanceUid:"1.2.5",frameNumber:1,frameOfReferenceUid:"1.2.6",viewportType:"stack",display:{invert:true},camera,slabThickness:null,blendMode:null};
  assert.equal(provenance(p).frameNumber,1);
  assert.throws(()=>provenance({...p,frameNumber:0}));
  assert.throws(()=>provenance({...p,viewportType:"mip",slabThickness:20,blendMode:1}));
  assert.equal(provenance({...p,viewportType:"mpr",sopInstanceUid:null,frameNumber:null,slabThickness:1,blendMode:0}).sopInstanceUid,null);
});
test("PNG validation decodes actual pixels and enforces dimensions and format", async () => {
  const bytes = await sharp({create:{width:320,height:240,channels:3,background:"#555"}}).png().toBuffer();
  assert.deepEqual(await validatePng(bytes),{width:320,height:240});
  await assert.rejects(()=>validatePng(bytes.subarray(0,50)));
  await assert.rejects(()=>validatePng(Buffer.from("not an image")));
  await assert.rejects(()=>validatePng(Buffer.alloc(13*1024*1024)));
});
