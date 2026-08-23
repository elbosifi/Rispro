import { describe, expect, it } from "vitest";
import { todayIsoDateLy } from "../../lib/date-format";
import { buildRegistrationAppointmentQuery, parseRegistrationFiltersFromSearchParams, type RegistrationsFilters } from "./registration-query";

const defaults: RegistrationsFilters = {
  dateMode: "single",
  date: "2026-04-27",
  dateFrom: "",
  dateTo: "",
  modalityId: "",
  query: "",
  statuses: ["scheduled"],
  sort: "booking-desc",
};

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
        sort: "booking-desc",
      })
    ).toEqual({
      dateFrom: selected,
      dateTo: selected,
      modalityId: "",
      q: "",
      status: ["scheduled"],
      sort: "booking-desc",
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
        patientId: "11",
        query: "abc",
        statuses: ["waiting", "arrived"],
        sort: "booking-asc",
      })
    ).toEqual({
      dateFrom: "2026-04-20",
      dateTo: "2026-04-27",
      modalityId: "3",
      patientId: "11",
      q: "abc",
      status: ["waiting", "arrived"],
      sort: "booking-asc",
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
        patientId: "11",
        query: "",
        statuses: ["scheduled", "arrived", "waiting"],
        sort: "patient-asc",
      })
    ).toEqual({
      dateFrom: today,
      dateTo: today,
      modalityId: "",
      patientId: "11",
      q: "",
      status: ["scheduled", "arrived", "waiting"],
      sort: "patient-asc",
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
        patientId: "11",
        query: "MRN-123",
        statuses: ["scheduled", "waiting"],
        sort: "time-asc",
      })
    ).toEqual({
      modalityId: "2",
      patientId: "11",
      q: "MRN-123",
      status: ["scheduled", "waiting"],
      sort: "time-asc",
    });
  });

  it("accepts valid sort values from URL parameters", () => {
    expect(parseRegistrationFiltersFromSearchParams(new URLSearchParams("sort=booking-asc"), defaults).sort).toBe("booking-asc");
  });

  it("falls back to the default sort for an invalid URL value", () => {
    expect(parseRegistrationFiltersFromSearchParams(new URLSearchParams("sort=unknown"), defaults).sort).toBe("booking-desc");
  });
});
