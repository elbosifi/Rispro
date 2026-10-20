import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
  cleanup,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { DragEndEvent } from "@dnd-kit/core";
import * as api from "@/lib/api-hooks";
import type {
  DoctorMe,
  DoctorProfile,
  DoctorRosterAssignment,
  DoctorRosterWeek,
} from "@/types/api";
import { DoctorRosterBoard } from "./doctor-roster-board";
import { nextRosterRange } from "./roster-board-utils";

const drag = vi.hoisted(() => ({
  end: undefined as undefined | ((event: DragEndEvent) => void),
}));
vi.mock("@dnd-kit/core", async (importOriginal) => {
  const original = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...original,
    DndContext: (props: React.ComponentProps<typeof original.DndContext>) => {
      drag.end = props.onDragEnd;
      return <original.DndContext {...props} />;
    },
  };
});
vi.mock("@/lib/api-hooks", () =>
  Object.fromEntries(
    [
      "fetchSavedDoctorRosters",
      "fetchDoctorRosterWeek",
      "fetchRosterDoctors",
      "fetchRosterDutyTypes",
      "fetchAppointmentLookups",
      "fetchRosterWeekConflicts",
      "createDoctorRosterWeek",
      "createDoctorRosterAssignment",
      "addDoctorRosterMember",
      "deleteDoctorRosterMember",
      "deleteDoctorRosterAssignment",
      "transferDoctorRosterMember",
      "publishDoctorRosterWeek",
      "updateDoctorRosterSection",
    ].map((key) => [key, vi.fn()]),
  ),
);
const me = { moduleCapabilities: ["doctor", "doctor_supervisor"] } as DoctorMe;
const range = nextRosterRange();
const week: DoctorRosterWeek = {
  id: 1,
  weekStartDate: range.start,
  weekEndDate: range.end,
  status: "draft",
  createdBy: 1,
  publishedBy: null,
  publishedAt: null,
  createdAt: "",
  updatedAt: "",
};
const section: DoctorRosterAssignment = {
  id: 10,
  rosterWeekId: 1,
  date: range.start,
  teamName: "CT",
  modalityId: 1,
  modalityCode: "CT",
  modalityNameEn: "CT",
  modalityNameAr: "مقطعية",
  dutyType: "ct_protocol_day",
  sessionName: null,
  startTime: "08:00",
  endTime: "14:00",
  status: "active",
  members: [],
};
const doctors = [
  "consultant",
  "specialist",
  "senior_house_officer",
  "resident",
].map((doctorRole, index) => ({
  id: index + 1,
  userId: index + 1,
  displayName: ["Dr Consultant", "Dr Specialist", "Dr Senior", "Dr Junior"][
    index
  ],
  doctorRole,
  active: true,
})) as DoctorProfile[];
function mount(identity = me) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <DoctorRosterBoard me={identity} />
    </QueryClientProvider>,
  );
}
async function ready() {
  await screen.findByRole("button", { name: "Publish roster" });
  await waitFor(() => expect(screen.queryByText("Loading roster…")).toBeNull());
}
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.setItem("rispro-language", "en");
  vi.mocked(api.fetchSavedDoctorRosters).mockResolvedValue([week]);
  vi.mocked(api.fetchDoctorRosterWeek).mockResolvedValue({
    week,
    assignments: [structuredClone(section)],
  });
  vi.mocked(api.fetchRosterDoctors).mockResolvedValue(doctors);
  vi.mocked(api.fetchRosterDutyTypes).mockResolvedValue([
    {
      code: "ct_protocol_day",
      label: "CT protocol",
      active: true,
      requiresSpecialist: true,
      sortOrder: 0,
    },
  ]);
  vi.mocked(api.fetchAppointmentLookups).mockResolvedValue({
    modalities: [{ id: 1, code: "CT", nameEn: "CT", nameAr: "مقطعية" }],
    examTypes: [],
    priorities: [],
  });
  vi.mocked(api.fetchRosterWeekConflicts).mockResolvedValue([]);
});
afterEach(cleanup);

describe("roster board", () => {
  it("opens one short creation flow with editable Sunday–Thursday dates and blank/copy choices", async () => {
    mount();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Create Roster" }));
    expect(
      (screen.getByLabelText("Start date") as HTMLInputElement).value,
    ).toBe(range.start);
    expect((screen.getByLabelText("End date") as HTMLInputElement).value).toBe(
      range.end,
    );
    fireEvent.change(screen.getByLabelText("Start date"), {
      target: { value: "2091-01-07" },
    });
    fireEvent.change(screen.getByLabelText("End date"), {
      target: { value: "2091-01-09" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Start from an existing roster?")).toBeTruthy();
    expect(screen.getByLabelText("Start blank")).toBeTruthy();
    expect(screen.getByLabelText("Choose a saved roster")).toBeTruthy();
    vi.mocked(api.createDoctorRosterWeek).mockResolvedValue({
      week: { ...week, weekStartDate: "2091-01-07" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create draft" }));
    await waitFor(() =>
      expect(api.createDoctorRosterWeek).toHaveBeenCalledWith({
        weekStartDate: "2091-01-07",
        weekEndDate: "2091-01-09",
        sourceRosterWeekId: undefined,
        structureOnly: false,
      }),
    );
  });
  it("lets managers select an older source, previews exclusions and defaults to a published source", async () => {
    const published = {
      ...week,
      id: 2,
      weekStartDate: "2025-10-19",
      weekEndDate: "2025-10-25",
      status: "published" as const,
    };
    const older = {
      ...published,
      id: 3,
      weekStartDate: "2025-10-12",
      weekEndDate: "2025-10-16",
    };
    vi.mocked(api.fetchSavedDoctorRosters).mockResolvedValue([
      week,
      published,
      older,
    ]);
    vi.mocked(api.fetchDoctorRosterWeek).mockImplementation(async (start) =>
      start === range.start
        ? { week, assignments: [section] }
        : {
            week: start === published.weekStartDate ? published : older,
            assignments: [
              {
                ...section,
                date: start,
                members: [
                  {
                    id: 11,
                    rosterAssignmentId: 10,
                    doctorId: 1,
                    displayName: "Dr Consultant",
                    doctorRole: "consultant",
                    teamRole: "lead",
                  },
                ],
              },
            ],
          },
    );
    mount();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Create Roster" }));
    fireEvent.change(screen.getByLabelText("Start date"), {
      target: { value: "2091-01-07" },
    });
    fireEvent.change(screen.getByLabelText("End date"), {
      target: { value: "2091-01-11" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByLabelText("Choose a saved roster"));
    expect(
      (screen.getByLabelText("Source roster") as HTMLSelectElement).value,
    ).toBe("2");
    fireEvent.change(screen.getByLabelText("Source roster"), {
      target: { value: "3" },
    });
    await screen.findByText("1 sections to copy · 0 excluded");
    vi.mocked(api.createDoctorRosterWeek).mockResolvedValue({ week });
    fireEvent.click(screen.getByRole("button", { name: "Create draft" }));
    await waitFor(() =>
      expect(api.createDoctorRosterWeek).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceRosterWeekId: 3,
          structureOnly: false,
        }),
      ),
    );
  });
  it("groups professional grades, searches doctors and adds a daily section with two actions", async () => {
    mount();
    await ready();
    for (const grade of [
      "Consultants",
      "Specialists",
      "Senior SHOs",
      "Junior SHOs",
    ])
      expect(screen.getByText(grade)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search doctors"), {
      target: { value: "Junior" },
    });
    expect(screen.queryByText("Dr Consultant")).toBeNull();
    expect(screen.getByText("Dr Junior")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "+ Add Roster" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "CT" }));
    await waitFor(() =>
      expect(api.createDoctorRosterAssignment).toHaveBeenCalledWith(
        expect.objectContaining({
          date: range.start,
          dutyType: "ct_protocol_day",
          modalityId: 1,
          teamName: "CT",
          startTime: "08:00",
          endTime: "14:00",
        }),
      ),
    );
  });
  it("assigns by drag and lets the backend suggest responsibility from the doctor profile", async () => {
    mount();
    await ready();
    act(() =>
      drag.end!({
        active: { data: { current: { doctorId: 1, label: "Dr Consultant" } } },
        over: { data: { current: { assignmentId: 10 } } },
      } as unknown as DragEndEvent),
    );
    await waitFor(() =>
      expect(api.addDoctorRosterMember).toHaveBeenCalledWith(10, {
        doctorId: 1,
      }),
    );
    await screen.findByText(/Dr Consultant assigned to CT/);
  });
  it("offers tap assignment and prevents duplicate membership", async () => {
    vi.mocked(api.fetchDoctorRosterWeek).mockResolvedValue({
      week,
      assignments: [
        {
          ...section,
          members: [
            {
              id: 11,
              rosterAssignmentId: 10,
              doctorId: 1,
              displayName: "Dr Consultant",
              doctorRole: "consultant",
              teamRole: "lead",
            },
          ],
        },
      ],
    });
    mount();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "+ Add doctor" }));
    const dialog = screen.getByRole("dialog");
    expect(
      (
        within(dialog).getByRole("button", {
          name: "Dr Consultant · Assigned",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "Dr Junior" }));
    await waitFor(() =>
      expect(api.addDoctorRosterMember).toHaveBeenCalledWith(10, {
        doctorId: 4,
      }),
    );
    expect(api.addDoctorRosterMember).toHaveBeenCalledTimes(1);
  });
  it("moves in one atomic request and removes a doctor without separate add/remove move calls", async () => {
    const member = {
      id: 11,
      rosterAssignmentId: 10,
      doctorId: 1,
      displayName: "Dr Consultant",
      doctorRole: "consultant",
      teamRole: "lead" as const,
    };
    vi.mocked(api.fetchDoctorRosterWeek).mockResolvedValue({
      week,
      assignments: [
        { ...section, members: [member] },
        { ...section, id: 20, teamName: "MRI" },
      ],
    });
    mount();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Move / copy" }));
    fireEvent.change(screen.getByLabelText("Destination section"), {
      target: { value: "20" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Move doctor" }));
    await waitFor(() =>
      expect(api.transferDoctorRosterMember).toHaveBeenCalledWith(
        10,
        11,
        20,
        "move",
      ),
    );
    expect(api.addDoctorRosterMember).not.toHaveBeenCalled();
    expect(api.deleteDoctorRosterMember).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Remove doctor" }));
    await waitFor(() =>
      expect(api.deleteDoctorRosterMember).toHaveBeenCalledWith(10, 11),
    );
  });
  it("shows conflicts and keeps publishing server-authoritative", async () => {
    vi.mocked(api.fetchRosterWeekConflicts).mockResolvedValue([
      {
        assignmentId: 10,
        doctorId: null,
        memberId: null,
        code: "team_missing_lead",
        message: "Team has no lead.",
        severity: "error",
      },
    ]);
    vi.mocked(api.publishDoctorRosterWeek).mockRejectedValue(
      new Error("publish blocked"),
    );
    mount();
    await ready();
    await screen.findByText("Choose a qualified team lead.");
    fireEvent.click(screen.getByRole("button", { name: "Publish roster" }));
    await waitFor(() =>
      expect(api.publishDoctorRosterWeek).toHaveBeenCalledWith(1),
    );
    await screen.findByRole("alert");
  });
  it("keeps published rosters read-only and denies unauthorized edits", async () => {
    vi.mocked(api.fetchDoctorRosterWeek).mockResolvedValue({
      week: { ...week, status: "published" },
      assignments: [section],
    });
    mount();
    await screen.findByText("Read-only roster");
    expect(screen.queryByRole("button", { name: "+ Add Roster" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Publish roster" })).toBeNull();
    cleanup();
    vi.clearAllMocks();
    mount({ moduleCapabilities: ["doctor"] } as DoctorMe);
    await screen.findByText("Roster manager access is required.");
    expect(api.fetchSavedDoctorRosters).not.toHaveBeenCalled();
  });
  it("supports Arabic labels and local RTL without changing the English Doctor shell", async () => {
    localStorage.setItem("rispro-language", "ar");
    mount();
    await screen.findByRole("button", { name: "نشر الجدول" });
    expect(screen.getByTestId("doctor-roster-board").getAttribute("dir")).toBe(
      "rtl",
    );
    expect(screen.getByText("الاستشاريون")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    await screen.findByRole("button", { name: "Publish roster" });
  });
  it("handles loading, failure, retry and an empty board", async () => {
    vi.mocked(api.fetchSavedDoctorRosters).mockRejectedValueOnce(
      new Error("offline"),
    );
    mount();
    await screen.findByText("Could not load the roster. Try again.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await ready();
    cleanup();
    vi.mocked(api.fetchSavedDoctorRosters).mockResolvedValue([]);
    vi.mocked(api.fetchDoctorRosterWeek).mockResolvedValue({
      week: null,
      assignments: [],
    });
    mount();
    await waitFor(() =>
      expect(screen.queryByText("Loading roster…")).toBeNull(),
    );
    expect(
      screen.getAllByText(
        "Create a roster to add daily sections and assign doctors.",
      ).length,
    ).toBeGreaterThan(0);
  });
  it("never substitutes an administrative duty for a CT preset", async () => {
    vi.mocked(api.fetchRosterDutyTypes).mockResolvedValue([
      {
        code: "admin",
        label: "Department administration",
        active: true,
        requiresSpecialist: false,
        sortOrder: 0,
      },
    ]);
    mount();
    await ready();
    fireEvent.click(screen.getAllByRole("button", { name: "+ Add Roster" })[0]);
    expect(
      (screen.getByRole("button", { name: "CT" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    expect(
      screen.getByRole("option", { name: "Department administration" }),
    ).toBeTruthy();
    expect(api.createDoctorRosterAssignment).not.toHaveBeenCalled();
  });
  it("offers saved sources with different date coverage, including a saved future draft", async () => {
    const future = {
      ...week,
      id: 50,
      weekStartDate: "2095-01-02",
      weekEndDate: "2095-01-20",
    };
    vi.mocked(api.fetchSavedDoctorRosters).mockResolvedValue([future, week]);
    mount();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Create Roster" }));
    fireEvent.change(screen.getByLabelText("Start date"), {
      target: { value: "2091-01-07" },
    });
    fireEvent.change(screen.getByLabelText("End date"), {
      target: { value: "2091-01-11" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByLabelText("Choose a saved roster"));
    expect(
      within(screen.getByLabelText("Source roster")).getByRole("option", {
        name: "2095-01-02 – 2095-01-20 · Draft",
      }),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Source roster"), {
      target: { value: "50" },
    });
    await waitFor(() =>
      expect(api.fetchDoctorRosterWeek).toHaveBeenCalledWith("2095-01-02"),
    );
  });
});
