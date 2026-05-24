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
    sendOnlyWhenPatientEntersQueue: false,
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
    procedureCodeField: "exam_type_code",
    procedureDescriptionField: "exam_name_en",
    scheduledStationAeTitleDefault: "RISPRO_MWL",
    hl7EnabledFields: {},
    hl7FieldLimits: {},
    hl7OverflowPolicy: {},
    hl7ExtraFields: [],
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

test("buildSanteOrmO01Message uses configured procedure code and description sources", () => {
  const message = buildSanteOrmO01Message({
    booking: {
      ...buildSyntheticSanteTestProjection(),
      exam_type_code: "XR-CHEST",
      exam_name_en: "Chest X-Ray",
      exam_name_ar: "أشعة صدر",
      modality_code: "CR",
      modality_name_en: "Computed Radiography",
      modality_name_ar: "أشعة",
    },
    orderControl: "NW",
    settings: {
      ...settings(),
      procedureCodeField: "modality_code",
      procedureDescriptionField: "exam_name_ar",
    },
  });

  const obr = segmentFields(message.message, "OBR");
  assert.equal(obr[4], "CR^أشعة صدر");
  assert.equal(obr[20], "أشعة صدر");
});

test("buildSanteOrmO01Message does not invent scheduled station when booking has none", () => {
  const message = buildSanteOrmO01Message({
    booking: buildSyntheticSanteTestProjection(),
    orderControl: "NW",
    settings: settings(),
  });

  assert.doesNotMatch(message.message, /\rZSS\|/);
});

test("buildSanteOrmO01Message rejects over-limit patient identifiers by default", () => {
  assert.throws(
    () => buildSanteOrmO01Message({
      booking: { ...buildSyntheticSanteTestProjection(), patient_primary_id: "P".repeat(65) },
      orderControl: "NW",
      settings: {
        ...settings(),
        hl7FieldLimits: { "PID.3": 64 },
        hl7OverflowPolicy: { "PID.3": "reject" },
      },
    }),
    /PID\.3 exceeds maximum length/
  );
});

test("buildSanteOrmO01Message truncates configured display fields and logs the action", () => {
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (message?: unknown) => {
    warnings.push(String(message));
  };

  try {
    const message = buildSanteOrmO01Message({
      booking: { ...buildSyntheticSanteTestProjection(), exam_name_en: "Long Procedure ".repeat(10) },
      orderControl: "NW",
      settings: {
        ...settings(),
        hl7FieldLimits: { "OBR.20": 20 },
        hl7OverflowPolicy: { "OBR.20": "truncate" },
      },
    });

    const obr = segmentFields(message.message, "OBR");
    assert.equal(obr[20], "Long Procedure Long ");
    assert.equal(warnings.some((message) => message.includes("hl7_value_truncated")), true);
  } finally {
    console.warn = originalWarn;
  }
});

test("buildSanteOrmO01Message omits disabled fields and applies extra fields", () => {
  const message = buildSanteOrmO01Message({
    booking: buildSyntheticSanteTestProjection(),
    orderControl: "NW",
    settings: {
      ...settings(),
      hl7EnabledFields: { "PID.11": false },
      hl7ExtraFields: [{ segment: "OBR", field: 27, value: "routine" }],
    },
  });

  const pid = segmentFields(message.message, "PID");
  const obr = segmentFields(message.message, "OBR");
  assert.equal(pid[11], "");
  assert.equal(obr[27], "routine");
});
