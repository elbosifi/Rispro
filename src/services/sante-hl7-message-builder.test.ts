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
    outputFolderPath: "storage/sante-hl7-output",
    fileExtension: ".hl7",
    successBehavior: "auto_detect",
    errorExtensions: [".ERR", ".err"],
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

