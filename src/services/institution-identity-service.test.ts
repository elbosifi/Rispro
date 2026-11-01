import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { applyInstitutionIdentity, EMPTY_INSTITUTION_IDENTITY, validateInstitutionIdentity, validateLogo } from "./institution-identity-service.js";

test("institution logos accept decoded raster assets and reject SVG, remote URLs, corrupt data and excessive dimensions", async () => {
  const image = await sharp({create:{width:800,height:300,channels:3,background:"white"}}).jpeg().toBuffer();
  const result = await validateLogo("data:image/jpeg;base64," + image.toString("base64"));
  const metadata = await sharp(Buffer.from(result.split(",")[1],"base64")).metadata();
  assert.equal(metadata.format,"png"); assert.equal(metadata.width,600); assert.equal(metadata.height,225);
  for (const invalid of ["https://external.test/logo.png","data:image/svg+xml;base64,PHN2Zz4=","data:image/png;base64,YmFk", "data:image/png;base64,"+"A".repeat(2_800_001)]) await assert.rejects(()=>validateLogo(invalid));
});
test("identity validation keeps bilingual text, optional fields and safe contact data", async () => {
  const identity = await validateInstitutionIdentity({...EMPTY_INSTITUTION_IDENTITY,hospitalNameEn:" Synthetic Hospital ",hospitalNameAr:"مستشفى تجريبي",website:"https://hospital.example"});
  assert.equal(identity.hospitalNameEn,"Synthetic Hospital"); assert.equal(identity.hospitalNameAr,"مستشفى تجريبي");
  await assert.rejects(()=>validateInstitutionIdentity({...identity,website:"javascript:alert(1)"}));
  await assert.rejects(()=>validateInstitutionIdentity({...identity,unexpected:"x"}));
});
test("one institution overrides legacy names while QR arrival, location, parking and functional settings survive", () => {
  const identity = {...EMPTY_INSTITUTION_IDENTITY,hospitalNameEn:"New Hospital",departmentNameEn:"New Department",primaryPhone:"12345",addressEn:"New address"};
  const slip = applyInstitutionIdentity("appointment_slip",{hospitalNameEn:"Old Hospital",showQrCode:false},identity);
  assert.equal(slip.hospitalNameEn,"New Hospital");assert.equal(slip.showQrCode,false);
  const qr = applyInstitutionIdentity("patient_qr_self_service",{allowCancellation:false,location:{centerNameEn:"Old",arrivalInstructionsEn:"Early",parkingNoteEn:"Gate 3",departmentLocationEn:"Floor 2"},contact:{whatsapp:"67890"}},identity);
  assert.deepEqual(qr.location,{centerNameEn:"New Hospital",centerNameAr:"",addressEn:"New address",addressAr:"",arrivalInstructionsEn:"Early",parkingNoteEn:"Gate 3",departmentLocationEn:"Floor 2"});
  assert.equal((qr.contact as Record<string,string>).whatsapp,"67890");assert.equal(qr.allowCancellation,false);
});
