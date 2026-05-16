import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAccessionNumber,
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

function segmentFields(message: string, segmentName: string): string[] {
  const segment = message.split("\r").find((value) => value.startsWith(`${segmentName}|`));
  assert.ok(segment, `${segmentName} segment is present`);
  return segment.split("|");
}

test("buildAccessionNumber uses canonical padded V2 accession format", () => {
  assert.equal(buildAccessionNumber(123), "V2-000123");
});

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

  const orc = segmentFields(message.message, "ORC");
  const obr = segmentFields(message.message, "OBR");
  assert.equal(orc[2], "V2-000000");
  assert.equal(orc[5], "SC");
  assert.equal(orc[15], "20260510080000");
  assert.equal(obr[4], "SANTE_TEST^Synthetic Sante Worklist Test");
  assert.equal(obr[6], "20260510080000");
  assert.equal(obr[7], "20260510080000");
  assert.equal(obr[18], "CT");
  assert.notEqual(obr[18], "V2-000000");
  assert.equal(obr[20], "Synthetic Sante Worklist Test");
  assert.equal(obr[21], "RISPRO_MWL");
  assert.equal(obr[24], "CT");
  assert.equal(obr[25], "CT");
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

test("buildSanteOrmO01Message keeps full patient name in PID-5 component 1 for Sante", () => {
  const message = buildSanteOrmO01Message({
    booking: { ...buildSyntheticSanteTestProjection(), english_full_name: "First Second Third Fourth" },
    orderControl: "NW",
    settings: settings(),
  });

  const pid = segmentFields(message.message, "PID");
  assert.equal(pid[5], "First Second Third Fourth");
});

test("buildSanteOrmO01Message leaves MSH-15 blank for file-drop delivery", () => {
  const message = buildSanteOrmO01Message({
    booking: buildSyntheticSanteTestProjection(),
    orderControl: "NW",
    settings: settings(),
    messageControlId: "RISPRO-TEST-3",
  });

  const msh = segmentFields(message.message, "MSH");
  assert.equal(msh[14], "");
});

test("buildSanteOrmO01Message requests accept ACK for MLLP when configured", () => {
  const message = buildSanteOrmO01Message({
    booking: buildSyntheticSanteTestProjection(),
    orderControl: "NW",
    settings: { ...settings(), deliveryMethod: "mllp", mllpHost: "127.0.0.1", mllpPort: 2575, mllpExpectAck: true },
    messageControlId: "RISPRO-TEST-4",
  });

  const msh = segmentFields(message.message, "MSH");
  assert.equal(msh[14], "AL");
});

test("buildSanteOrmO01Message maps patient contact fields to Sante PID positions", () => {
  const message = buildSanteOrmO01Message({
    booking: {
      ...buildSyntheticSanteTestProjection(),
      phone_1: "0912345678",
      address: "Tripoli|Center",
    },
    orderControl: "NW",
    settings: settings(),
  });

  const pid = segmentFields(message.message, "PID");
  assert.equal(pid[11], "Tripoli\\F\\Center");
  assert.equal(pid[13], "0912345678");
});

test("buildSanteOrmO01Message maps assigned contrast protocol only when contrast is required", () => {
  const withContrast = buildSanteOrmO01Message({
    booking: {
      ...buildSyntheticSanteTestProjection(),
      protocol_text: "Portal venous phase",
      contrast_required: true,
      contrast_phase_or_protocol: "IV contrast",
    },
    orderControl: "NW",
    settings: settings(),
  });

  const contrastObr = segmentFields(withContrast.message, "OBR");
  assert.equal(contrastObr[13], "IV contrast");
  assert.equal(contrastObr[31], "Portal venous phase");

  const withoutContrast = buildSanteOrmO01Message({
    booking: {
      ...buildSyntheticSanteTestProjection(),
      protocol_text: "Non-contrast protocol note",
      contrast_required: false,
      contrast_phase_or_protocol: "No IV contrast",
    },
    orderControl: "NW",
    settings: settings(),
  });

  const plainObr = segmentFields(withoutContrast.message, "OBR");
  assert.equal(plainObr[13], "");
  assert.equal(plainObr[31], "");
});

test("buildSanteOrmO01Message maps cancellation status to Sante ORC-5", () => {
  const message = buildSanteOrmO01Message({
    booking: buildSyntheticSanteTestProjection(),
    orderControl: "CA",
    settings: settings(),
  });

  const orc = segmentFields(message.message, "ORC");
  assert.equal(orc[5], "CA");
});

test("buildSanteOrmO01Message does not invent scheduled station when booking has none", () => {
  const message = buildSanteOrmO01Message({
    booking: buildSyntheticSanteTestProjection(),
    orderControl: "NW",
    settings: settings(),
  });

  assert.doesNotMatch(message.message, /\rZSS\|/);
});
