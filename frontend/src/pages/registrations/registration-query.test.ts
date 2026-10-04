import { describe, expect, it } from "vitest";
import { todayIsoDateLy } from "../../lib/date-format";
import {
  buildRegistrationSearch,
  buildRegistrationLastLocationSearch,
  buildRegistrationAppointmentQuery,
  clearRegistrationSearch,
  parseRegistrationFiltersFromSearchParams,
  readRegistrationSearch,
  REGISTRATION_DEFAULT_STATUSES,
  REGISTRATION_FILTER_STATUSES,
  sanitizeRegistrationSearch,
  type RegistrationsFilters,
  writeRegistrationSearch,
} from "./registration-query";

const defaults: RegistrationsFilters = {
  dateMode: "single",
  date: "2026-04-27",
  dateFrom: "",
  dateTo: "",
  modalityId: "",
  identifierType: "",
  query: "",
  statuses: [...REGISTRATION_DEFAULT_STATUSES],
  sort: "booking-desc",
};

describe("buildRegistrationAppointmentQuery", () => {
  it("defines the active and selectable Registration status sets in order", () => {
    expect(REGISTRATION_DEFAULT_STATUSES).toEqual(["scheduled", "arrived", "waiting", "in-progress"]);
    expect(REGISTRATION_FILTER_STATUSES).toEqual([
      "scheduled",
      "arrived",
      "waiting",
      "in-progress",
      "completed",
      "no-show",
      "cancelled",
      "discontinued",
    ]);
  });

  it("single date bounds the appointment query", () => {
    const selected = "2026-04-27";

    expect(
      buildRegistrationAppointmentQuery({
        dateMode: "single",
        date: selected,
        dateFrom: "",
        dateTo: "",
        modalityId: "",
        identifierType: "",
        query: "",
        statuses: ["scheduled"],
        sort: "booking-desc",
      })
    ).toEqual({
      dateFrom: selected,
      dateTo: selected,
      modalityId: "",
      identifierType: "",
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
        identifierType: "passport",
        patientId: "11",
        query: "abc",
        statuses: ["waiting", "arrived"],
        sort: "booking-asc",
      })
    ).toEqual({
      dateFrom: "2026-04-20",
      dateTo: "2026-04-27",
      modalityId: "3",
      identifierType: "passport",
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
        identifierType: "",
        patientId: "11",
        query: "",
        statuses: [...REGISTRATION_DEFAULT_STATUSES],
        sort: "patient-asc",
      })
    ).toEqual({
      dateFrom: today,
      dateTo: today,
      modalityId: "",
      identifierType: "",
      patientId: "11",
      q: "",
      status: ["scheduled", "arrived", "waiting", "in-progress"],
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
        identifierType: "__missing__",
        patientId: "11",
        query: "MRN-123",
        statuses: ["scheduled", "waiting"],
        sort: "time-asc",
      })
    ).toEqual({
      modalityId: "2",
      identifierType: "__missing__",
      patientId: "11",
      q: "MRN-123",
      status: ["scheduled", "waiting"],
      sort: "time-asc",
    });
  });

  it("accepts valid sort values from URL parameters", () => {
    expect(parseRegistrationFiltersFromSearchParams(new URLSearchParams("sort=booking-asc"), defaults).sort).toBe("booking-asc");
  });

  it("parses, serializes, and sends identifier-type filters", () => {
    expect(parseRegistrationFiltersFromSearchParams(new URLSearchParams("identifierType=passport"), defaults).identifierType).toBe("passport");
    expect(parseRegistrationFiltersFromSearchParams(new URLSearchParams("identifierType=__missing__"), defaults).identifierType).toBe("__missing__");
    expect(buildRegistrationSearch(new URLSearchParams(), { ...defaults, identifierType: "passport" }, defaults).toString()).toBe("identifierType=passport");
    expect(buildRegistrationSearch(new URLSearchParams(), defaults, defaults).has("identifierType")).toBe(false);
    expect(buildRegistrationAppointmentQuery({ ...defaults, identifierType: "__missing__" }).identifierType).toBe("__missing__");
    expect(buildRegistrationLastLocationSearch(new URLSearchParams("identifierType=passport&patientId=7")).get("identifierType")).toBe("passport");
  });

  it("falls back to the default sort for an invalid URL value", () => {
    expect(parseRegistrationFiltersFromSearchParams(new URLSearchParams("sort=unknown"), defaults).sort).toBe("booking-desc");
  });

  it("preserves an explicit in-progress URL status", () => {
    expect(parseRegistrationFiltersFromSearchParams(new URLSearchParams("status=in-progress"), defaults).statuses).toEqual([
      "in-progress",
    ]);
  });

  it("preserves multiple URL status filters", () => {
    expect(
      parseRegistrationFiltersFromSearchParams(new URLSearchParams("status=waiting&status=in-progress"), defaults).statuses,
    ).toEqual(["waiting", "in-progress"]);
  });

  it("rejects invalid URL filter values and never imports private search text", () => {
    const parsed = parseRegistrationFiltersFromSearchParams(
      new URLSearchParams("q=Patient%20Name&modalityId=0&status=unknown&dateMode=range&dateFrom=bad&dateTo=2026-04-27"),
      defaults,
    );
    expect(parsed).toEqual(defaults);
    expect(sanitizeRegistrationSearch(new URLSearchParams("q=Patient%20Name&appointmentId=7"))).toEqual(
      new URLSearchParams("appointmentId=7"),
    );
  });

  it("omits default filters, preserves appointment deep-link state, and excludes private search text", () => {
    const next = buildRegistrationSearch(
      new URLSearchParams("q=Patient%20Name&appointmentId=7&tab=details&source=statistics"),
      {
        ...defaults,
        dateMode: "range",
        date: "",
        dateFrom: "2026-04-20",
        dateTo: "2026-04-27",
        modalityId: "2",
        identifierType: "passport",
        statuses: ["waiting", "in-progress"],
        sort: "time-asc",
      },
      defaults,
    );
    expect(next.toString()).toBe("appointmentId=7&tab=details&source=statistics&dateMode=range&dateFrom=2026-04-20&dateTo=2026-04-27&modalityId=2&identifierType=passport&status=waiting&status=in-progress&sort=time-asc");
  });

  it("keeps private registration search in session storage only", () => {
    clearRegistrationSearch();
    writeRegistrationSearch("Patient Name");
    expect(readRegistrationSearch()).toBe("Patient Name");
    clearRegistrationSearch();
    expect(readRegistrationSearch()).toBe("");
  });
});
