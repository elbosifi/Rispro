import assert from "node:assert/strict";
import test from "node:test";
import { buildRegistrationAppointmentQuery } from "./registration-query";
import { todayIsoDateLy } from "../../lib/date-format";

test("single date bounds the appointment query", () => {
  const selected = "2026-04-27";

  assert.deepEqual(
    buildRegistrationAppointmentQuery({
      date: selected,
      dateFrom: "",
      dateTo: "",
      modalityId: "",
      query: "",
      statuses: ["scheduled"],
    }),
    {
      dateFrom: selected,
      dateTo: selected,
      modalityId: "",
      q: "",
      status: ["scheduled"],
    },
  );
});

test("range dates are preserved when the single date is empty", () => {
  assert.deepEqual(
    buildRegistrationAppointmentQuery({
      date: "",
      dateFrom: "2026-04-20",
      dateTo: "2026-04-27",
      modalityId: "3",
      query: "abc",
      statuses: ["waiting", "arrived"],
    }),
    {
      dateFrom: "2026-04-20",
      dateTo: "2026-04-27",
      modalityId: "3",
      q: "abc",
      status: ["waiting", "arrived"],
    },
  );
});

test("default filters stay bounded to today", () => {
  const today = todayIsoDateLy();

  assert.deepEqual(
    buildRegistrationAppointmentQuery({
      date: today,
      dateFrom: today,
      dateTo: today,
      modalityId: "",
      query: "",
      statuses: ["scheduled", "arrived", "waiting"],
    }),
    {
      dateFrom: today,
      dateTo: today,
      modalityId: "",
      q: "",
      status: ["scheduled", "arrived", "waiting"],
    },
  );
});
