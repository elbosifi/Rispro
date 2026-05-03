import { describe, expect, it } from "vitest";
import { todayIsoDateLy } from "../../lib/date-format";
import { buildRegistrationAppointmentQuery } from "./registration-query";

describe("buildRegistrationAppointmentQuery", () => {
  it("single date bounds the appointment query", () => {
    const selected = "2026-04-27";

    expect(
      buildRegistrationAppointmentQuery({
        dateMode: "single",
        date: selected,
        dateFrom: "",
        dateTo: "",
        modalityId: "",
        query: "",
        statuses: ["scheduled"],
      })
    ).toEqual({
      dateFrom: selected,
      dateTo: selected,
      modalityId: "",
      q: "",
      status: ["scheduled"],
    });
  });

  it("range dates are preserved when the single date is empty", () => {
    expect(
      buildRegistrationAppointmentQuery({
        dateMode: "range",
        date: "",
        dateFrom: "2026-04-20",
        dateTo: "2026-04-27",
        modalityId: "3",
        query: "abc",
        statuses: ["waiting", "arrived"],
      })
    ).toEqual({
      dateFrom: "2026-04-20",
      dateTo: "2026-04-27",
      modalityId: "3",
      q: "abc",
      status: ["waiting", "arrived"],
    });
  });

  it("default filters stay bounded to today", () => {
    const today = todayIsoDateLy();

    expect(
      buildRegistrationAppointmentQuery({
        dateMode: "single",
        date: today,
        dateFrom: today,
        dateTo: today,
        modalityId: "",
        query: "",
        statuses: ["scheduled", "arrived", "waiting"],
      })
    ).toEqual({
      dateFrom: today,
      dateTo: today,
      modalityId: "",
      q: "",
      status: ["scheduled", "arrived", "waiting"],
    });
  });

  it("all dates omits date filters entirely", () => {
    expect(
      buildRegistrationAppointmentQuery({
        dateMode: "all",
        date: "",
        dateFrom: "",
        dateTo: "",
        modalityId: "2",
        query: "MRN-123",
        statuses: ["scheduled", "waiting"],
      })
    ).toEqual({
      modalityId: "2",
      q: "MRN-123",
      status: ["scheduled", "waiting"],
    });
  });
});
