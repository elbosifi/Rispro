import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SchedulingError } from "../../shared/errors/scheduling-error.js";
import {
  BOOKING_PATIENT_PHONE_REQUIRED_MESSAGE,
  assertPatientMeetsBookingQueueRequirements,
} from "../../booking/services/patient-identifier-requirement.js";

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
        assert.equal(error.statusCode, 400);
        assert.equal(error.message, BOOKING_PATIENT_PHONE_REQUIRED_MESSAGE);
        assert.deepEqual(error.reasonCodes, ["patient_phone_required"]);
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
        assert.deepEqual(error.reasonCodes, ["patient_phone_required", "patient_primary_identifier_required"]);
        return true;
      }
    );
  });

  it("super admin can bypass missing identifier but not missing phone", async () => {
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
        assert.deepEqual(error.reasonCodes, ["patient_phone_required"]);
        return true;
      }
    );
  });
});
