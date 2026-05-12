import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DoctorAdminDoctorsPage } from "./doctor-admin-doctors-page";
import type { DoctorMe, DoctorProfile, User } from "@/types/api";

const fetchDoctorProfilesForAdminMock = vi.fn();
const fetchUsersMock = vi.fn();
const fetchAppointmentLookupsMock = vi.fn();
const fetchDoctorProfileModalitiesMock = vi.fn();
const createDoctorWithUserForAdminMock = vi.fn();
const createDoctorProfileForAdminMock = vi.fn();
const updateDoctorProfileForAdminMock = vi.fn();
const updateDoctorProfileModalitiesMock = vi.fn();
const resetDoctorUserTemporaryPasswordMock = vi.fn();
const forceDoctorUserPasswordChangeMock = vi.fn();

vi.mock("@/lib/api-hooks", () => ({
  fetchDoctorProfilesForAdmin: () => fetchDoctorProfilesForAdminMock(),
  fetchUsers: () => fetchUsersMock(),
  fetchAppointmentLookups: () => fetchAppointmentLookupsMock(),
  fetchDoctorProfileModalities: (...args: unknown[]) => fetchDoctorProfileModalitiesMock(...args),
  createDoctorWithUserForAdmin: (...args: unknown[]) => createDoctorWithUserForAdminMock(...args),
  createDoctorProfileForAdmin: (...args: unknown[]) => createDoctorProfileForAdminMock(...args),
  updateDoctorProfileForAdmin: (...args: unknown[]) => updateDoctorProfileForAdminMock(...args),
  updateDoctorProfileModalities: (...args: unknown[]) => updateDoctorProfileModalitiesMock(...args),
  resetDoctorUserTemporaryPassword: (...args: unknown[]) => resetDoctorUserTemporaryPasswordMock(...args),
  forceDoctorUserPasswordChange: (...args: unknown[]) => forceDoctorUserPasswordChangeMock(...args),
  inspectDoctorImport: vi.fn(),
  previewDoctorImport: vi.fn(),
  confirmDoctorImport: vi.fn(),
}));

const adminMe = {
  canManageDoctorProfiles: true,
} as DoctorMe;

const normalMe = {
  canManageDoctorProfiles: false,
} as DoctorMe;

const users: User[] = [
  {
    id: 10,
    username: "existing.doc",
    fullName: "Existing Doctor",
    role: "doctor",
    isActive: true,
    mustChangePassword: false,
    createdAt: null,
    updatedAt: null,
  },
  {
    id: 11,
    username: "new.profile",
    fullName: "New Profile",
    role: "doctor",
    isActive: true,
    mustChangePassword: false,
    createdAt: null,
    updatedAt: null,
  },
];

const profiles: DoctorProfile[] = [
  {
    id: 1,
    userId: 10,
    username: "existing.doc",
    fullName: "Existing Doctor",
    coreRole: "doctor",
    userActive: true,
    displayName: "Dr Existing",
    doctorRole: "specialist",
    active: true,
    canFinalizeReports: true,
    canAssignProtocols: false,
    canSupervise: false,
  },
];

function renderPage(me: DoctorMe = adminMe) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DoctorAdminDoctorsPage me={me} />
    </QueryClientProvider>
  );
}

describe("DoctorAdminDoctorsPage", () => {
  beforeEach(() => {
    fetchDoctorProfilesForAdminMock.mockResolvedValue(profiles);
    fetchUsersMock.mockResolvedValue({ users });
    fetchAppointmentLookupsMock.mockResolvedValue({ modalities: [{ id: 5, code: "CT", nameEn: "CT" }], examTypes: [] });
    fetchDoctorProfileModalitiesMock.mockResolvedValue([{ modalityId: 5, modalityCode: "CT", modalityName: "CT", canProtocol: false, canReport: true, canSupervise: false, active: true }]);
    createDoctorWithUserForAdminMock.mockResolvedValue({ user: users[1], profile: profiles[0], modalities: [] });
    createDoctorProfileForAdminMock.mockResolvedValue(profiles[0]);
    updateDoctorProfileForAdminMock.mockResolvedValue(profiles[0]);
    updateDoctorProfileModalitiesMock.mockResolvedValue([]);
    resetDoctorUserTemporaryPasswordMock.mockResolvedValue(users[0]);
    forceDoctorUserPasswordChangeMock.mockResolvedValue(users[0]);
    vi.clearAllMocks();
  });

  it("renders Create Doctor for admins and submits a new user plus profile", async () => {
    renderPage();

    fireEvent.change(screen.getByPlaceholderText("Username"), { target: { value: "fresh.doc" } });
    fireEvent.change(screen.getByPlaceholderText("Full name"), { target: { value: "Fresh Doctor" } });
    fireEvent.change(screen.getByPlaceholderText("Temporary password"), { target: { value: "Temp123!" } });
    const createModalityRow = (await screen.findByText("CT")).closest("tr")!;
    fireEvent.click(within(createModalityRow).getAllByRole("checkbox")[0]);
    fireEvent.click(screen.getByRole("button", { name: "Create doctor" }));

    await waitFor(() => expect(createDoctorWithUserForAdminMock).toHaveBeenCalled());
    expect(createDoctorWithUserForAdminMock.mock.calls[0][0]).toMatchObject({
      username: "fresh.doc",
      fullName: "Fresh Doctor",
      temporaryPassword: "Temp123!",
      doctorDisplayName: "Fresh Doctor",
      userActive: true,
      modalityPermissions: [{ modalityId: 5, active: true }],
    });
  });

  it("opens the edit form and saves role and capability changes", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const form = screen.getByText("Edit doctor profile: Dr Existing").closest("section")!;
    fireEvent.change(within(form).getByPlaceholderText("Display name"), { target: { value: "Dr Updated" } });
    fireEvent.change(within(form).getByDisplayValue("Specialist"), { target: { value: "consultant" } });
    fireEvent.click(within(form).getByLabelText("Can finalize reports"));
    fireEvent.click(within(form).getByLabelText("Can assign protocols"));
    fireEvent.click(within(form).getByLabelText("Can supervise"));
    fireEvent.click(within(form).getByRole("button", { name: "Save profile" }));

    await waitFor(() => expect(updateDoctorProfileForAdminMock).toHaveBeenCalledWith(1, {
      displayName: "Dr Updated",
      doctorRole: "consultant",
      active: true,
      canFinalizeReports: false,
      canAssignProtocols: true,
      canSupervise: true,
    }));
  });

  it("keeps existing profile creation and modality permission management working", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Modalities" }));
    await screen.findByText("Modality permissions: Dr Existing");
    const row = screen.getAllByText("CT").at(-1)!.closest("tr")!;
    fireEvent.click(within(row).getAllByRole("checkbox")[1]);
    await waitFor(() => expect(updateDoctorProfileModalitiesMock).toHaveBeenCalledWith(1, expect.arrayContaining([expect.objectContaining({ modalityId: 5, canProtocol: true })])));

    await screen.findByRole("option", { name: "New Profile (@new.profile)" });
    fireEvent.change(screen.getByDisplayValue("Select user"), { target: { value: "11" } });
    fireEvent.change(screen.getByPlaceholderText("Display name"), { target: { value: "New Profile" } });
    await waitFor(() => expect((screen.getByRole("button", { name: "Create profile" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Create profile" }));
    await waitFor(() => expect(createDoctorProfileForAdminMock).toHaveBeenCalledWith(expect.objectContaining({ userId: 11, displayName: "New Profile" })));
  });

  it("supports linked user temporary password actions from the edit panel", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByPlaceholderText("New temporary password"), { target: { value: "NewTemp123!" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset temporary password" }));
    await waitFor(() => expect(resetDoctorUserTemporaryPasswordMock).toHaveBeenCalledWith(10, "NewTemp123!"));

    fireEvent.click(screen.getByRole("button", { name: "Require password change" }));
    await waitFor(() => expect(forceDoctorUserPasswordChangeMock).toHaveBeenCalledWith(10));
  });

  it("does not render admin create or edit controls for normal doctors", () => {
    renderPage(normalMe);

    expect(screen.getByText("Doctor profile management is not available for this user.")).toBeTruthy();
    expect(screen.queryByText("Create Doctor")).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });
});
