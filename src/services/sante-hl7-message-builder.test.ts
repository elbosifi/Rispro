import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSanteOrmO01Message,
  buildSyntheticSanteTestProjection,
} from "./sante-hl7-message-builder.js";
import type { ResolvedSanteWorklistSettings } from "./sante-worklist-settings-resolver.js";

function settings(): ResolvedSanteWorklistSettings {
  return {
    enabled: true,
    mode: "shadow",
    keepInternalMwlActive: true,
    deliveryMethod: "file_drop",
    outputFolderPath: "storage/sante-hl7-output",
    fileExtension: ".hl7",
    successBehavior: "auto_detect",
    errorExtensions: [".ERR", ".err"],
    mllpHost: "",
    mllpPort: 0,
    mllpTimeoutSeconds: 10,
    mllpExpectAck: true,
    retryMaxAttempts: 5,
    retryInitialDelaySeconds: 30,
    retryMaxDelaySeconds: 300,
    pendingImportTimeoutSeconds: 900,
    orderControlCreate: "NW",
    orderControlUpdate: "XO",
    orderControlCancel: "CA",
    sendingApplication: "RISPRO",
    sendingFacility: "RISPRO",
    receivingApplication: "SANTE_WORKLIST",
    receivingFacility: "SANTE",
    hl7Version: "2.3.1",
    charset: "UNICODE UTF-8",
    patientIdField: "identifier_value",
    patientNameField: "english_full_name",
    scheduledStationAeTitleDefault: "RISPRO_MWL",
    allowedBasePaths: ["storage/sante-hl7-output"],
    hostOutboxHint: "storage/sante-hl7-output",
    windowsShareSourceHint: "storage/sante-hl7-output",
  };
}

test("buildSanteOrmO01Message emits ORM O01 with configured identity and NW order", () => {
  const message = buildSanteOrmO01Message({
    booking: { ...buildSyntheticSanteTestProjection(), booking_date: "2026-05-10", booking_time: "08:00:00" },
    orderControl: "NW",
    settings: settings(),
    messageControlId: "RISPRO-TEST-1",
    now: new Date("2026-05-05T12:34:56Z"),
  });

  assert.match(message.message, /^MSH\|\^~\\&\|RISPRO\|RISPRO\|SANTE_WORKLIST\|SANTE\|/);
  assert.match(message.message, /\|ORM\^O01\|RISPRO-TEST-1\|P\|2\.3\.1/);
  assert.match(message.message, /\rORC\|NW\|V2-000000/);
  assert.match(message.message, /\rOBR\|1\|V2-000000/);
  assert.equal(message.accessionNumber, "V2-000000");
  assert.equal(message.payloadHash.length, 64);

  const obr = message.message.split("\r").find((segment) => segment.startsWith("OBR|"))?.split("|") || [];
  assert.equal(obr[6], "20260510080000");
  assert.equal(obr[7], "20260510080000");
  assert.equal(obr[21], "RISPRO_MWL");
  assert.equal(obr[24], "CT");
});

test("buildSanteOrmO01Message escapes HL7 separators", () => {
  const projection = {
    ...buildSyntheticSanteTestProjection(),
    english_full_name: "Pipe|Caret^Amp&Back\\Name",
  };
  const message = buildSanteOrmO01Message({
    booking: projection,
    orderControl: "XO",
    settings: settings(),
    messageControlId: "RISPRO-TEST-2",
  });

  assert.match(message.message, /Pipe\\F\\Caret\\S\\Amp\\T\\Back\\E\\Name/);
  assert.match(message.message, /\rORC\|XO\|/);
});

test("buildSanteOrmO01Message keeps patient name components in entered order", () => {
  const message = buildSanteOrmO01Message({
    booking: { ...buildSyntheticSanteTestProjection(), english_full_name: "First Second Third Fourth" },
    orderControl: "NW",
    settings: settings(),
  });

  assert.match(message.message, /\rPID\|1\|\|TEST-SANTE-001\|\|First\^Second\^Third\^Fourth\|/);
});

test("buildSanteOrmO01Message leaves MSH-15 blank for file-drop delivery", () => {
  const message = buildSanteOrmO01Message({
    booking: buildSyntheticSanteTestProjection(),
    orderControl: "NW",
    settings: settings(),
    messageControlId: "RISPRO-TEST-3",
  });

  const msh = message.message.split("\r")[0].split("|");
  assert.equal(msh[14], "");
});

test("buildSanteOrmO01Message requests accept ACK for MLLP when configured", () => {
  const message = buildSanteOrmO01Message({
    booking: buildSyntheticSanteTestProjection(),
    orderControl: "NW",
    settings: { ...settings(), deliveryMethod: "mllp", mllpHost: "127.0.0.1", mllpPort: 2575, mllpExpectAck: true },
    messageControlId: "RISPRO-TEST-4",
  });

  const msh = message.message.split("\r")[0].split("|");
  assert.equal(msh[14], "AL");
});

test("buildSanteOrmO01Message does not invent scheduled station when booking has none", () => {
  const message = buildSanteOrmO01Message({
    booking: buildSyntheticSanteTestProjection(),
    orderControl: "NW",
    settings: settings(),
  });

  assert.doesNotMatch(message.message, /\rZSS\|/);
});
