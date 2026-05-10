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
    scheduledStationAeTitleDefault: "",
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
    allowedBasePaths: ["storage/sante-hl7-output"],
    hostOutboxHint: "storage/sante-hl7-output",
    windowsShareSourceHint: "storage/sante-hl7-output",
  };
}

test("buildSanteOrmO01Message emits ORM O01 with configured identity and NW order", () => {
  const message = buildSanteOrmO01Message({
    booking: buildSyntheticSanteTestProjection(),
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

test("buildSanteOrmO01Message includes configured scheduled station AE title only when set", () => {
  const base = buildSanteOrmO01Message({
    booking: buildSyntheticSanteTestProjection(),
    orderControl: "NW",
    settings: settings(),
  });
  const withAe = buildSanteOrmO01Message({
    booking: buildSyntheticSanteTestProjection(),
    orderControl: "NW",
    settings: { ...settings(), scheduledStationAeTitleDefault: "CT_ROOM_1" },
  });

  assert.doesNotMatch(base.message, /\rZSS\|/);
  assert.match(withAe.message, /\rZSS\|CT_ROOM_1\r/);
});
