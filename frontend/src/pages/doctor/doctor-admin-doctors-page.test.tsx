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
const updateDoctorLinkedUserForAdminMock = vi.fn();
const setDoctorIdentityActiveMock = vi.fn();

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
  updateDoctorLinkedUserForAdmin: (...args: unknown[]) => updateDoctorLinkedUserForAdminMock(...args),
  setDoctorIdentityActive: (...args: unknown[]) => setDoctorIdentityActiveMock(...args),
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
  },
  {
    id: 11,
    username: "new.profile",
    fullName: "New Profile",
    role: "doctor",
    isActive: true,
    mustChangePassword: false,
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

function renderPage(me: DoctorMe = adminMe, options: { advanced?: boolean } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DoctorAdminDoctorsPage me={me} advanced={options.advanced} />
    </QueryClientProvider>
  );
}

describe("DoctorAdminDoctorsPage", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/doctor/doctors-directory");
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
    updateDoctorLinkedUserForAdminMock.mockResolvedValue({ user: users[0], profile: profiles[0] });
    setDoctorIdentityActiveMock.mockResolvedValue({ user: users[0], profile: profiles[0] });
    vi.clearAllMocks();
  });

  it("preselects a requested unlinked user without creating a profile", async () => {
    window.history.replaceState({}, "", "/doctor/doctors-directory?linkUserId=11");
    renderPage();

    const select = await screen.findByDisplayValue(
      "New Profile (new.profile) - doctor - user active",
    );
    expect((select as HTMLSelectElement).value).toBe("11");
    expect((screen.getByPlaceholderText("Display name") as HTMLInputElement).value).toBe(
      "New Profile",
    );
    expect(createDoctorProfileForAdminMock).not.toHaveBeenCalled();
  });

  it.each(["invalid", "10"])(
    "leaves the existing link form unchanged for an invalid or linked linkUserId (%s)",
    async (linkUserId) => {
      window.history.replaceState({}, "", `/doctor/doctors-directory?linkUserId=${linkUserId}`);
      renderPage();

      const select = await screen.findByDisplayValue("Select user");
      expect((select as HTMLSelectElement).value).toBe("");
      expect((screen.getByPlaceholderText("Display name") as HTMLInputElement).value).toBe("");
      expect(createDoctorProfileForAdminMock).not.toHaveBeenCalled();
    },
  );

  it("clearly labels account creation and submits a new user plus profile", async () => {
    renderPage();

    fireEvent.change(screen.getByPlaceholderText("Username"), { target: { value: "fresh.doc" } });
    fireEvent.change(screen.getByPlaceholderText("Full name"), { target: { value: "Fresh Doctor" } });
    fireEvent.change(screen.getByPlaceholderText("Temporary password"), { target: { value: "Temp123!" } });
    const createModalityRow = (await screen.findByText("CT")).closest("tr")!;
    fireEvent.click(within(createModalityRow).getAllByRole("checkbox")[0]);
    expect(screen.getByRole("heading", { name: "Create login account and doctor profile" })).toBeTruthy();
    expect(screen.getByText(/Creates new RISpro credentials/)).toBeTruthy();
    expect(screen.getByText("Link existing RISpro user to doctor profile")).toBeTruthy();
    expect(screen.getByText(/No new login credentials are created/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create login account and doctor profile" }));

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

  it("hides doctor import and export controls in the default directory", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "Create login account and doctor profile" })).toBeTruthy();
    expect(screen.queryByText("Doctor CSV/XLSX import and export")).toBeNull();
    expect(screen.queryByText("Download CSV template")).toBeNull();
    expect(screen.queryByText("Download XLSX template")).toBeNull();
    expect(screen.queryByText("Export CSV")).toBeNull();
    expect(screen.queryByText("Export XLSX")).toBeNull();
    expect(screen.queryByText("Import CSV/XLSX")).toBeNull();
    expect(screen.queryByRole("button", { name: "Preview import" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirm import" })).toBeNull();
  });

  it("shows doctor import and export controls in advanced mode", async () => {
    renderPage(adminMe, { advanced: true });

    expect(await screen.findByText("Doctor CSV/XLSX import and export")).toBeTruthy();
    expect(screen.getByText("Download CSV template")).toBeTruthy();
    expect(screen.getByText("Download XLSX template")).toBeTruthy();
    expect(screen.getByText("Export CSV")).toBeTruthy();
    expect(screen.getByText("Export XLSX")).toBeTruthy();
    expect(screen.getByText("Import CSV/XLSX")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Preview import" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirm import" })).toBeTruthy();
  });

  it("opens the drawer on Account without automatically opening Modalities and saves profile changes", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const drawer = screen.getByRole("dialog", { name: "Manage doctor: Dr Existing" });
    expect(within(drawer).getByRole("button", { name: "Close" })).toBeTruthy();
    expect(within(drawer).getByRole("tab", { name: "Account" }).getAttribute("aria-selected")).toBe("true");
    expect(within(drawer).getByRole("tab", { name: "Modalities" }).getAttribute("aria-selected")).toBe("false");
    expect(screen.queryByText("Edit doctor profile: Dr Existing")).toBeNull();
    fireEvent.click(within(drawer).getByRole("tab", { name: "Doctor profile" }));
    const form = within(drawer).getByRole("region", { name: "Doctor profile" });
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
    const drawer = await screen.findByRole("dialog", { name: "Manage doctor: Dr Existing" });
    expect(within(drawer).getByRole("tab", { name: "Modalities" }).getAttribute("aria-selected")).toBe("true");
    const row = screen.getAllByText("CT").at(-1)!.closest("tr")!;
    await waitFor(() => expect((within(row).getAllByRole("checkbox")[0] as HTMLInputElement).checked).toBe(true));
    expect((within(row).getAllByRole("checkbox")[2] as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(row).getAllByRole("checkbox")[1]);
    expect((within(row).getAllByRole("checkbox")[1] as HTMLInputElement).checked).toBe(true);
    await waitFor(() => expect(updateDoctorProfileModalitiesMock).toHaveBeenCalledWith(1, expect.arrayContaining([expect.objectContaining({ modalityId: 5, canProtocol: true })])));

    await screen.findByRole("option", { name: "New Profile (new.profile) - doctor - user active" });
    fireEvent.change(screen.getByDisplayValue("Select user"), { target: { value: "11" } });
    fireEvent.change(screen.getByPlaceholderText("Display name"), { target: { value: "New Profile" } });
    await waitFor(() => expect((screen.getByRole("button", { name: "Create profile" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Create profile" }));
    await waitFor(() => expect(createDoctorProfileForAdminMock).toHaveBeenCalledWith(expect.objectContaining({ userId: 11, displayName: "New Profile" })));
  });

  it("supports linked user temporary password actions from the edit panel", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("tab", { name: "Security" }));
    fireEvent.change(screen.getByPlaceholderText("New temporary password"), { target: { value: "NewTemp123!" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset temporary password" }));
    await waitFor(() => expect(resetDoctorUserTemporaryPasswordMock).toHaveBeenCalledWith(10, "NewTemp123!"));

    fireEvent.click(screen.getByRole("button", { name: "Require password change" }));
    await waitFor(() => expect(forceDoctorUserPasswordChangeMock).toHaveBeenCalledWith(10));

  });

  it("displays usernames without an at-sign and submits account identity fields", async () => {
    renderPage();

    expect(await screen.findByText("existing.doc")).toBeTruthy();
    expect(screen.queryByText("@existing.doc")).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: " Updated.Doc " } });
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Updated Doctor" } });
    fireEvent.click(screen.getByRole("button", { name: "Save account" }));
    await waitFor(() => expect(updateDoctorLinkedUserForAdminMock).toHaveBeenCalledWith(10, { username: " Updated.Doc ", fullName: "Updated Doctor", coreRole: "doctor", active: true }));
  });

  it("keeps duplicate username errors visible and the drawer open", async () => {
    updateDoctorLinkedUserForAdminMock.mockRejectedValueOnce(new Error("A user with that username already exists."));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Save account" }));
    expect((await screen.findByRole("alert")).textContent).toContain("already exists");
    expect(screen.getByRole("dialog", { name: "Manage doctor: Dr Existing" })).toBeTruthy();
  });

  it("confirms complete deactivation and keeps failures visible without changing the row", async () => {
    setDoctorIdentityActiveMock.mockRejectedValueOnce(new Error("Protected account cannot be deactivated."));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Deactivate doctor" }));
    expect(screen.getByText(/deactivate the login account and doctor profile/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(setDoctorIdentityActiveMock).toHaveBeenCalledWith(10, false));
    expect((await screen.findByRole("alert")).textContent).toContain("Protected account");
    expect(screen.getByRole("button", { name: "Deactivate doctor" })).toBeTruthy();
  });

  it("reactivates the linked account and profile together", async () => {
    const inactive = { ...profiles[0], active: false, userActive: false };
    fetchDoctorProfilesForAdminMock.mockResolvedValue([inactive]);
    setDoctorIdentityActiveMock.mockResolvedValue({ user: { ...users[0], isActive: true }, profile: profiles[0] });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Reactivate doctor" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(setDoctorIdentityActiveMock).toHaveBeenCalledWith(10, true));
  });

  it("does not render admin create or edit controls for normal doctors", () => {
    renderPage(normalMe);

    expect(screen.getByText("Doctor profile management is not available for this user.")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Create login account and doctor profile" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });
});
