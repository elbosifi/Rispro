import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SchedulingError } from "../../shared/errors/scheduling-error.js";
import {
  BOOKING_PATIENT_IDENTIFIER_REQUIRED_MESSAGE,
  BOOKING_PATIENT_PHONE_AND_IDENTIFIER_REQUIRED_MESSAGE,
  BOOKING_PATIENT_PHONE_REQUIRED_MESSAGE,
  assertPatientIdentifierAllowsBooking,
  assertPatientMeetsBookingQueueRequirements,
} from "../../booking/services/patient-identifier-requirement.js";

const requirementSource = readFileSync(
  new URL("../../booking/services/patient-identifier-requirement.ts", import.meta.url),
  "utf8"
);

describe("patient booking and queue requirements", () => {
  it("required phone setting blocks booking when patient has no phone", async () => {
    const client = {
      query: async (sql: string) => {
        if (sql.includes("system_settings")) {
          return {
            rows: [
              { setting_key: "phone1_required", value: "required" },
              { setting_key: "national_id_required", value: "optional" },
            ],
          };
        }
        return { rows: [{ phone_1: "", primary_identifier: "P-123" }] };
      },
    };

    await assert.rejects(
      () => assertPatientMeetsBookingQueueRequirements(client as never, 1, "receptionist"),
      (error: unknown) => {
        assert.ok(error instanceof SchedulingError);
        assert.equal(error.statusCode, 422);
        assert.equal(error.message, BOOKING_PATIENT_PHONE_REQUIRED_MESSAGE);
        assert.deepEqual(error.reasonCodes, ["patient_phone_required"]);
        assert.deepEqual(error.details, { patientId: 1, missingPhone: true, missingIdentifier: false });
        return true;
      }
    );
  });

  it("optional phone setting allows booking when patient has no phone", async () => {
    const client = {
      query: async (sql: string) => {
        if (sql.includes("system_settings")) {
          return {
            rows: [
              { setting_key: "phone1_required", value: "optional" },
              { setting_key: "national_id_required", value: "optional" },
            ],
          };
        }
        return { rows: [{ phone_1: "", primary_identifier: "P-123" }] };
      },
    };

    await assert.doesNotReject(() => assertPatientMeetsBookingQueueRequirements(client as never, 1, "receptionist"));
  });

  it("reports both missing phone and identifier when both are required", async () => {
    const client = {
      query: async (sql: string) => {
        if (sql.includes("system_settings")) {
          return {
            rows: [
              { setting_key: "phone1_required", value: "required" },
              { setting_key: "national_id_required", value: "required" },
            ],
          };
        }
        return { rows: [{ phone_1: "", primary_identifier: "" }] };
      },
    };

    await assert.rejects(
      () => assertPatientMeetsBookingQueueRequirements(client as never, 1, "receptionist"),
      (error: unknown) => {
        assert.ok(error instanceof SchedulingError);
        assert.equal(error.statusCode, 422);
        assert.equal(error.message, BOOKING_PATIENT_PHONE_AND_IDENTIFIER_REQUIRED_MESSAGE);
        assert.deepEqual(error.reasonCodes, ["patient_phone_required", "patient_primary_identifier_required"]);
        assert.deepEqual(error.details, { patientId: 1, missingPhone: true, missingIdentifier: true });
        return true;
      }
    );
  });

  it("reports missing identifier only with status and details", async () => {
    const client = {
      query: async (sql: string) => {
        if (sql.includes("system_settings")) {
          return {
            rows: [
              { setting_key: "phone1_required", value: "required" },
              { setting_key: "national_id_required", value: "required" },
            ],
          };
        }
        return { rows: [{ phone_1: "0912345678", primary_identifier: "" }] };
      },
    };

    await assert.rejects(
      () => assertPatientMeetsBookingQueueRequirements(client as never, 1, "receptionist"),
      (error: unknown) => {
        assert.ok(error instanceof SchedulingError);
        assert.equal(error.statusCode, 422);
        assert.equal(error.message, BOOKING_PATIENT_IDENTIFIER_REQUIRED_MESSAGE);
        assert.deepEqual(error.reasonCodes, ["patient_primary_identifier_required"]);
        assert.deepEqual(error.details, { patientId: 1, missingPhone: false, missingIdentifier: true });
        return true;
      }
    );
  });

  it("super admin is blocked by missing identifier and still checked for missing phone", async () => {
    const client = {
      query: async (sql: string) => {
        if (sql.includes("system_settings")) {
          return {
            rows: [
              { setting_key: "phone1_required", value: "required" },
              { setting_key: "national_id_required", value: "required" },
            ],
          };
        }
        return { rows: [{ phone_1: "", primary_identifier: "" }] };
      },
    };

    await assert.rejects(
      () => assertPatientMeetsBookingQueueRequirements(client as never, 1, "super_admin"),
      (error: unknown) => {
        assert.ok(error instanceof SchedulingError);
        assert.equal(error.statusCode, 422);
        assert.deepEqual(error.reasonCodes, ["patient_phone_required", "patient_primary_identifier_required"]);
        assert.deepEqual(error.details, { patientId: 1, missingPhone: true, missingIdentifier: true });
        return true;
      }
    );
  });

  it("super admin is blocked when required primary identifier is missing", async () => {
    const client = {
      query: async (sql: string) => {
        if (sql.includes("system_settings")) {
          return {
            rows: [
              { setting_key: "phone1_required", value: "optional" },
              { setting_key: "national_id_required", value: "required" },
            ],
          };
        }
        return { rows: [{ phone_1: "0912345678", primary_identifier: "" }] };
      },
    };

    await assert.rejects(
      () => assertPatientMeetsBookingQueueRequirements(client as never, 1, "super_admin"),
      (error: unknown) => {
        assert.ok(error instanceof SchedulingError);
        assert.equal(error.statusCode, 422);
        assert.deepEqual(error.reasonCodes, ["patient_primary_identifier_required"]);
        assert.deepEqual(error.details, { patientId: 1, missingPhone: false, missingIdentifier: true });
        return true;
      }
    );
  });

  it("identifier-only booking check includes status and patient details", async () => {
    const client = {
      query: async (sql: string) => {
        if (sql.includes("system_settings")) {
          return {
            rows: [
              { setting_key: "phone1_required", value: "optional" },
              { setting_key: "national_id_required", value: "required" },
            ],
          };
        }
        return { rows: [{ phone_1: "", primary_identifier: "" }] };
      },
    };

    await assert.rejects(
      () => assertPatientIdentifierAllowsBooking(client as never, 7, "receptionist"),
      (error: unknown) => {
        assert.ok(error instanceof SchedulingError);
        assert.equal(error.statusCode, 422);
        assert.deepEqual(error.reasonCodes, ["patient_primary_identifier_required"]);
        assert.deepEqual(error.details, { patientId: 7, missingPhone: false, missingIdentifier: true });
        return true;
      }
    );
  });

  it("effective primary identifier trims blanks before falling back to legacy fields", () => {
    assert.match(requirementSource, /nullif\(trim\(primary_identifier\.value\), ''\)/);
    assert.match(requirementSource, /nullif\(trim\(p\.identifier_value\), ''\)/);
    assert.match(requirementSource, /nullif\(trim\(p\.national_id\), ''\)/);
  });
});
