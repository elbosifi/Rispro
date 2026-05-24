import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCanonicalMwlDataset,
  renderCanonicalMwlToDump,
  renderCanonicalMwlToOrthancJson,
  type CanonicalMwlInput,
} from "./mwl-dataset-builder.js";

function baseInput(overrides: Partial<CanonicalMwlInput> = {}): CanonicalMwlInput {
  return {
    modalityCode: "MRI",
    appointmentDate: "2030-01-15",
    patientPrimaryId: "PRIMARY-123",
    patientMrn: "MRN-123",
    patientNationalId: "NAT-456",
    patientId: 99,
    patientEnglishFullName: "John Smith",
    patientArabicFullName: "جون سميث",
    patientBirthDate: "1980-03-20",
    patientSex: "male",
    examNameEn: "MRI Brain",
    examNameAr: "رنين دماغ",
    modalityNameEn: "MRI",
    modalityNameAr: "رنين",
    ...overrides,
  };
}

test("buildCanonicalMwlDataset produces minimal canonical dataset", () => {
  const dataset = buildCanonicalMwlDataset(baseInput(), { mwlProfile: "minimal" });

  assert.deepEqual(dataset, {
    specificCharacterSet: "ISO_IR 192",
    patientName: "John Smith",
    patientId: "PRIMARY-123",
    patientBirthDate: "19800320",
    patientSex: "M",
    accessionNumber: undefined,
    scheduledProcedureStepSequence: [
      {
        modality: "MR",
        scheduledProcedureStepStartDate: "20300115",
        scheduledProcedureStepDescription: "MRI Brain",
      },
    ],
  });
});

test("buildCanonicalMwlDataset rejects non-minimal profile values", () => {
  assert.throws(
    () => buildCanonicalMwlDataset(baseInput(), { mwlProfile: "extended" }),
    /Only "minimal" is supported/
  );
});

test("buildCanonicalMwlDataset maps modality labels to DICOM modality values", () => {
  const mri = buildCanonicalMwlDataset(baseInput({ modalityCode: "MRI" }), { mwlProfile: "minimal" });
  const ct = buildCanonicalMwlDataset(baseInput({ modalityCode: "CT" }), { mwlProfile: "minimal" });
  const us = buildCanonicalMwlDataset(baseInput({ modalityCode: "Ultrasound" }), { mwlProfile: "minimal" });

  assert.equal(mri.scheduledProcedureStepSequence[0].modality, "MR");
  assert.equal(ct.scheduledProcedureStepSequence[0].modality, "CT");
  assert.equal(us.scheduledProcedureStepSequence[0].modality, "US");
});

test("renderers keep optional tags excluded by default", () => {
  const dataset = buildCanonicalMwlDataset(baseInput(), { mwlProfile: "minimal" });
  const dump = renderCanonicalMwlToDump(dataset);
  const orthancJson = renderCanonicalMwlToOrthancJson(dataset) as Record<string, unknown>;

  assert.equal(dump.includes("(0040,0001)"), false);
  assert.equal(dump.includes("(0040,0003)"), false);
  assert.equal(dump.includes("(0040,0009)"), false);
  assert.equal(dump.includes("(0008,0050)"), false);
  assert.equal(dump.includes("(0032,1060)"), false);
  assert.equal(dump.includes("(0040,1001)"), false);

  assert.equal("ScheduledStationAETitle" in orthancJson, false);
  assert.equal("AccessionNumber" in orthancJson, false);
  assert.equal("RequestedProcedureDescription" in orthancJson, false);
  assert.equal("RequestedProcedureCodeSequence" in orthancJson, false);
  assert.equal("RequestedProcedureID" in orthancJson, false);
});

test("parity regression: dump and Orthanc JSON render from the same canonical dataset", () => {
  const dataset = buildCanonicalMwlDataset(baseInput({ modalityCode: "Ultrasound" }), { mwlProfile: "minimal" });
  const dump = renderCanonicalMwlToDump(dataset);
  const orthancJson = renderCanonicalMwlToOrthancJson(dataset) as Record<string, unknown>;
  const sps = ((orthancJson.ScheduledProcedureStepSequence as Array<Record<string, unknown>>)[0]) || {};

  assert.equal(orthancJson.SpecificCharacterSet, dataset.specificCharacterSet);
  assert.equal(orthancJson.PatientName, dataset.patientName);
  assert.equal(orthancJson.PatientID, dataset.patientId);
  assert.equal(orthancJson.PatientBirthDate, dataset.patientBirthDate);
  assert.equal(orthancJson.PatientSex, dataset.patientSex);
  assert.equal(sps.Modality, dataset.scheduledProcedureStepSequence[0].modality);
  assert.equal(sps.ScheduledProcedureStepStartDate, dataset.scheduledProcedureStepSequence[0].scheduledProcedureStepStartDate);
  assert.equal(sps.ScheduledProcedureStepDescription, dataset.scheduledProcedureStepSequence[0].scheduledProcedureStepDescription);

  assert.equal(dump.includes(`(0008,0005) CS [${dataset.specificCharacterSet}]`), true);
  assert.equal(dump.includes(`(0010,0010) PN [${dataset.patientName}]`), true);
  assert.equal(dump.includes(`(0010,0020) LO [${dataset.patientId}]`), true);
  assert.equal(dump.includes(`(0010,0030) DA [${dataset.patientBirthDate}]`), true);
  assert.equal(dump.includes(`(0010,0040) CS [${dataset.patientSex}]`), true);
  assert.equal(dump.includes(`(0008,0060) CS [${dataset.scheduledProcedureStepSequence[0].modality}]`), true);
  assert.equal(dump.includes(`(0040,0002) DA [${dataset.scheduledProcedureStepSequence[0].scheduledProcedureStepStartDate}]`), true);
  assert.equal(dump.includes(`(0040,0007) LO [${dataset.scheduledProcedureStepSequence[0].scheduledProcedureStepDescription}]`), true);
});

test("buildCanonicalMwlDataset falls back to MRN when no primary identifier is selected", () => {
  const dataset = buildCanonicalMwlDataset(baseInput({ patientPrimaryId: null }), { mwlProfile: "minimal" });

  assert.equal(dataset.patientId, "MRN-123");
});

test("renderers include Orthanc-friendly identifiers when provided", () => {
  const dataset = buildCanonicalMwlDataset(
    baseInput({
      accessionNumber: "V2-123",
      requestedProcedureId: "rispro-v2-booking-123",
      scheduledStationAeTitle: "RISPRO_MWL",
    }),
    { mwlProfile: "minimal" }
  );

  const dump = renderCanonicalMwlToDump(dataset);
  const orthancJson = renderCanonicalMwlToOrthancJson(dataset) as Record<string, unknown>;
  const sps = ((orthancJson.ScheduledProcedureStepSequence as Array<Record<string, unknown>>)[0]) || {};

  assert.equal(dump.includes("(0008,0050) SH [V2-123]"), true);
  assert.equal(dump.includes("(0040,0001)"), false);
  assert.equal(dump.includes("(0040,0009)"), false);
  assert.equal(orthancJson.AccessionNumber, "V2-123");
  assert.equal("RequestedProcedureID" in orthancJson, false);
  assert.equal("ScheduledStationAETitle" in sps, false);
  assert.equal("ScheduledProcedureStepID" in sps, false);
});

test("Orthanc compatibility settings can change character set without affecting defaults", () => {
  const dataset = buildCanonicalMwlDataset(
    baseInput(),
    { mwlProfile: "minimal", compatibility: { specificCharacterSet: "ISO_IR 100" } }
  );

  const orthancJson = renderCanonicalMwlToOrthancJson(dataset) as Record<string, unknown>;
  assert.equal(orthancJson.SpecificCharacterSet, "ISO_IR 100");
});

test("Orthanc compatibility settings reject over-limit identity values by default", () => {
  assert.throws(
    () => buildCanonicalMwlDataset(
      baseInput({ patientPrimaryId: "P".repeat(65) }),
      { mwlProfile: "minimal", compatibility: { enforceDicomVrLimits: true } }
    ),
    /PatientID exceeds DICOM LO maximum/
  );
});

test("Orthanc compatibility settings truncate display fields and log the action", () => {
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (message?: unknown) => {
    warnings.push(String(message));
  };

  try {
    const dataset = buildCanonicalMwlDataset(
      baseInput({ examNameEn: "Brain MRI ".repeat(10) }),
      { mwlProfile: "minimal", compatibility: { enforceDicomVrLimits: true } }
    );

    assert.equal(dataset.scheduledProcedureStepSequence[0].scheduledProcedureStepDescription.length, 64);
    assert.equal(warnings.some((message) => message.includes("mwl_value_truncated")), true);
  } finally {
    console.warn = originalWarn;
  }
});

test("Orthanc compatibility settings validate advanced extra tags", () => {
  const dataset = buildCanonicalMwlDataset(
    baseInput(),
    {
      mwlProfile: "minimal",
      compatibility: {
        extraTags: [
          { tag: "RequestedProcedureDescription", vr: "LO", value: "MRI Brain With Contrast" },
        ],
      },
    }
  );

  const orthancJson = renderCanonicalMwlToOrthancJson(dataset) as Record<string, unknown>;
  assert.equal(orthancJson.RequestedProcedureDescription, "MRI Brain With Contrast");

  assert.throws(
    () => buildCanonicalMwlDataset(
      baseInput(),
      {
        mwlProfile: "minimal",
        compatibility: {
          extraTags: [
            { tag: "Bad Tag", vr: "LO", value: "x" },
          ],
        },
      }
    ),
    /Invalid DICOM tag key/
  );
});
