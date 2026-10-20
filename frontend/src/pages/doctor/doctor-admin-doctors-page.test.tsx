import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DoctorAdminDoctorsPage } from "./doctor-admin-doctors-page";
import { LanguageProvider } from "@/providers/language-provider-component";
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
const inspectDoctorImportMock = vi.fn();
const previewDoctorImportMock = vi.fn();
const confirmDoctorImportMock = vi.fn();

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
  inspectDoctorImport: (...args: unknown[]) => inspectDoctorImportMock(...args),
  previewDoctorImport: (...args: unknown[]) => previewDoctorImportMock(...args),
  confirmDoctorImport: (...args: unknown[]) => confirmDoctorImportMock(...args),
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
    email: "existing@nccb.ly",
    fullName: "Existing Doctor",
    englishName: "Existing Doctor English",
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
  {
    id: 12,
    username: "second.profile",
    fullName: "Second Profile",
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
    email: "existing@nccb.ly",
    fullName: "Existing Doctor",
    englishName: "Existing Doctor English",
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
  localStorage.setItem("rispro-language", "en");
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const makePage = () => (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider><DoctorAdminDoctorsPage me={me} advanced={options.advanced} /></LanguageProvider>
    </QueryClientProvider>
  );
  const rendered = render(makePage());
  return { ...rendered, rerenderPage: () => rendered.rerender(makePage()) };
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
    inspectDoctorImportMock.mockResolvedValue({ workbook: { format: "csv", columns: ["username", "full_name"], rowCount: 1, missingColumns: [] } });
    previewDoctorImportMock.mockResolvedValue({ rows: [{ rowNumber: 1, values: { username: "fresh.doc" }, action: "create", errors: [] }], canConfirm: true });
    confirmDoctorImportMock.mockResolvedValue({ createdUsers: 1, updatedUsers: 0, createdProfiles: 1, updatedProfiles: 0, disabledProfiles: 0, modalityPermissionsUpdated: 0, skippedRows: 0, failedRows: [] });
    vi.clearAllMocks();
  });

  it("opens Link existing mode for a requested unlinked user without creating a profile", async () => {
    window.history.replaceState({}, "", "/doctor/doctors-directory?linkUserId=11");
    renderPage();

    const drawer = await screen.findByRole("dialog", { name: "Create doctor" });
    expect(within(drawer).getByRole("button", { name: "Link existing RISpro user" }).getAttribute("aria-pressed")).toBe("true");
    expect((within(drawer).getByLabelText("Select user") as HTMLSelectElement).value).toBe("11");
    expect(within(drawer).getByLabelText("Display name")).toHaveProperty("value", "New Profile");
    expect(createDoctorProfileForAdminMock).not.toHaveBeenCalled();
  });

  it("does not reopen a dismissed deep-link drawer", async () => {
    window.history.replaceState({}, "", "/doctor/doctors-directory?linkUserId=11");
    renderPage();

    const drawer = await screen.findByRole("dialog", { name: "Create doctor" });
    fireEvent.click(within(drawer).getByRole("button", { name: "Close" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Create doctor" })).toBeNull());
  });

  it("opens the newly requested user when the deep-link changes", async () => {
    window.history.replaceState({}, "", "/doctor/doctors-directory?linkUserId=11");
    const rendered = renderPage();
    await screen.findByRole("dialog", { name: "Create doctor" });

    window.history.replaceState({}, "", "/doctor/doctors-directory?linkUserId=12");
    rendered.rerenderPage();

    const drawer = await screen.findByRole("dialog", { name: "Create doctor" });
    expect((within(drawer).getByLabelText("Select user") as HTMLSelectElement).value).toBe("12");
    expect(within(drawer).getByLabelText("Display name")).toHaveProperty("value", "Second Profile");
  });

  it.each(["invalid", "10"])(
    "does not open or select a user for an invalid or already-linked linkUserId (%s)",
    async (linkUserId) => {
      window.history.replaceState({}, "", `/doctor/doctors-directory?linkUserId=${linkUserId}`);
      renderPage();

      await screen.findByRole("button", { name: "Edit" });
      expect(screen.queryByRole("dialog", { name: "Create doctor" })).toBeNull();
      expect(screen.getByRole("button", { name: "Create doctor" })).toBeTruthy();
      expect(createDoctorProfileForAdminMock).not.toHaveBeenCalled();
    },
  );

  it("keeps creation fields out of the directory and opens them from Create doctor", async () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "Doctors" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Doctor directory" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create doctor" })).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Username" })).toBeNull();
    expect(screen.queryByLabelText("Temporary password")).toBeNull();
    expect(screen.queryByText("Modality permissions")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Create doctor" }));
    const drawer = await screen.findByRole("dialog", { name: "Create doctor" });
    expect(within(drawer).getByLabelText("Username")).toBeTruthy();
    expect(within(drawer).getByLabelText("Email")).toBeTruthy();
    expect(within(drawer).getByLabelText("Arabic Name")).toBeTruthy();
    expect(within(drawer).getByLabelText("English Name")).toBeTruthy();
    expect(within(drawer).getByLabelText("Temporary password")).toBeTruthy();
    expect(within(drawer).getByRole("combobox", { name: "Core role" })).toBeTruthy();
    expect(within(drawer).getByRole("combobox", { name: "Doctor role" })).toBeTruthy();
    expect(await within(drawer).findByRole("checkbox", { name: "CT Active" })).toBeTruthy();
    expect(within(drawer).getByRole("checkbox", { name: "CT Protocol" })).toBeTruthy();
    expect(within(drawer).getByRole("checkbox", { name: "CT Report" })).toBeTruthy();
    expect(within(drawer).getByRole("checkbox", { name: "CT Supervise" })).toBeTruthy();
  });

  it("submits the existing account, profile and modality payload", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Create doctor" }));
    const drawer = await screen.findByRole("dialog", { name: "Create doctor" });

    fireEvent.change(within(drawer).getByLabelText("Username"), { target: { value: "fresh.doc" } });
    fireEvent.change(within(drawer).getByLabelText("Email"), { target: { value: "fresh@example.org" } });
    fireEvent.change(within(drawer).getByLabelText("Arabic Name"), { target: { value: "Fresh Doctor" } });
    fireEvent.change(within(drawer).getByLabelText("English Name"), { target: { value: "Fresh Doctor English" } });
    fireEvent.change(within(drawer).getByLabelText("Temporary password"), { target: { value: "Temp123!" } });
    fireEvent.change(within(drawer).getByRole("combobox", { name: "Core role" }), { target: { value: "supervisor" } });
    fireEvent.change(within(drawer).getByRole("combobox", { name: "Doctor role" }), { target: { value: "resident" } });
    await within(drawer).findByRole("checkbox", { name: "CT Active" });
    fireEvent.click(within(drawer).getByLabelText("Profile active"));
    fireEvent.click(within(drawer).getByLabelText("Can assign protocols"));
    fireEvent.click(within(drawer).getByLabelText("Can supervise"));
    for (const permission of ["Active", "Protocol", "Report", "Supervise"]) {
      fireEvent.click(within(drawer).getByRole("checkbox", { name: `CT ${permission}` }));
    }
    fireEvent.click(within(drawer).getByRole("button", { name: "Create doctor" }));

    await waitFor(() => expect(createDoctorWithUserForAdminMock).toHaveBeenCalled());
    expect(createDoctorWithUserForAdminMock.mock.calls[0][0]).toMatchObject({
      username: "fresh.doc",
      email: "fresh@example.org",
      fullName: "Fresh Doctor",
      englishName: "Fresh Doctor English",
      temporaryPassword: "Temp123!",
      coreRole: "supervisor",
      doctorRole: "resident",
      doctorDisplayName: "",
      userActive: true,
      doctorProfileActive: false,
      canFinalizeReports: true,
      canAssignProtocols: false,
      canSupervise: true,
      modalityPermissions: [{ modalityId: 5, active: true, canProtocol: true, canReport: true, canSupervise: true }],
    });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Create doctor" })).toBeNull());
    expect(screen.getByText("Doctor user and profile created.")).toBeTruthy();
    await waitFor(() => expect(fetchDoctorProfilesForAdminMock).toHaveBeenCalledTimes(2));
    expect(fetchUsersMock).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "Create doctor" }));
    const reopenedDrawer = await screen.findByRole("dialog", { name: "Create doctor" });
    expect(within(reopenedDrawer).getByLabelText("Username")).toHaveProperty("value", "");
    expect(within(reopenedDrawer).getByLabelText("Temporary password")).toHaveProperty("value", "");
    expect((within(reopenedDrawer).getByRole("checkbox", { name: "CT Active" }) as HTMLInputElement).checked).toBe(false);
  });

  it("closes without creating when the creation drawer is cancelled", async () => {
    renderPage();
    const createAction = screen.getByRole("button", { name: "Create doctor" });
    fireEvent.click(createAction);
    const drawer = await screen.findByRole("dialog", { name: "Create doctor" });
    fireEvent.change(within(drawer).getByLabelText("Username"), { target: { value: "draft.doc" } });
    fireEvent.click(within(drawer).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Create doctor" })).toBeNull());
    expect(createDoctorWithUserForAdminMock).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(createAction));
  });

  it("keeps entered account details and the drawer open after a create error", async () => {
    createDoctorWithUserForAdminMock.mockRejectedValueOnce(new Error("A user with that username already exists."));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Create doctor" }));
    const drawer = await screen.findByRole("dialog", { name: "Create doctor" });
    fireEvent.change(within(drawer).getByLabelText("Username"), { target: { value: "duplicate.doc" } });
    fireEvent.change(within(drawer).getByLabelText("Arabic Name"), { target: { value: "Entered Doctor" } });
    fireEvent.change(within(drawer).getByLabelText("Temporary password"), { target: { value: "Temp123!" } });
    fireEvent.click(within(drawer).getByRole("button", { name: "Create doctor" }));

    expect((await within(drawer).findByRole("alert")).textContent).toContain("already exists");
    expect(screen.getByRole("dialog", { name: "Create doctor" })).toBeTruthy();
    expect(within(drawer).getByLabelText("Username")).toHaveProperty("value", "duplicate.doc");
    expect(within(drawer).getByLabelText("Arabic Name")).toHaveProperty("value", "Entered Doctor");
    expect(within(drawer).getByLabelText("Temporary password")).toHaveProperty("value", "Temp123!");
  });

  it("explains core roles, doctor profile permissions, and modality permissions in create and edit", async () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Create doctor" }));
    const createDrawer = await screen.findByRole("dialog", { name: "Create doctor" });
    expect(within(createDrawer).getByRole("combobox", { name: "Core role" })).toBeTruthy();
    expect(within(createDrawer).getByRole("option", { name: "Doctor" })).toBeTruthy();
    expect(within(createDrawer).getByRole("option", { name: "Supervisor" })).toBeTruthy();
    expect(within(createDrawer).getByText(/Doctor: Standard RISpro doctor account\./)).toBeTruthy();
    expect(within(createDrawer).getByText(/Supervisor: RISpro administrative and scheduling privileges/)).toBeTruthy();
    expect(within(createDrawer).getByText("Clinical grade used for roster eligibility and validation; not a security role.")).toBeTruthy();
    expect(within(createDrawer).getByText("Enables clinical Doctor Portal access independently of login account status.")).toBeTruthy();
    expect(within(createDrawer).getByText("Allows eligible reporting assignments and manual finalization of assigned completed cases.")).toBeTruthy();
    expect(within(createDrawer).getByText("Enables Doctor Protocol workflows, subject to relevant modality permissions.")).toBeTruthy();
    expect(within(createDrawer).getByText(/Enables Doctor Portal supervision, such as roster and Reporting Board management/)).toBeTruthy();
    expect(within(createDrawer).getByText("Enables this modality permission record.")).toBeTruthy();
    expect(within(createDrawer).getByText("Authorizes protocoling for this modality.")).toBeTruthy();
    expect(within(createDrawer).getByText("Makes the doctor eligible for reporting assignments in this modality.")).toBeTruthy();
    expect(within(createDrawer).getByText(/Enables directed overbooking approval eligibility for this modality/)).toBeTruthy();

    fireEvent.click(within(createDrawer).getByRole("button", { name: "Cancel" }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const drawer = screen.getByRole("dialog", { name: "Manage doctor: Existing Doctor English" });
    expect(within(drawer).getByRole("combobox", { name: "Core role" })).toBeTruthy();
    expect(within(drawer).getByText("Doctor: Standard RISpro doctor account.")).toBeTruthy();
    expect(within(drawer).getByText(/Supervisor: RISpro administrative and scheduling privileges/)).toBeTruthy();

    fireEvent.click(within(drawer).getByRole("tab", { name: "Doctor profile" }));
    expect(within(drawer).getByText("Clinical grade used for roster eligibility and validation; not a security role.")).toBeTruthy();
    expect(within(drawer).getByText("Enables clinical Doctor Portal access independently of login account status.")).toBeTruthy();
    expect(within(drawer).getByText("Allows eligible reporting assignments and manual finalization of assigned completed cases.")).toBeTruthy();
    expect(within(drawer).getByText("Enables Doctor Protocol workflows, subject to relevant modality permissions.")).toBeTruthy();
    expect(within(drawer).getByText(/Enables Doctor Portal supervision, such as roster and Reporting Board management/)).toBeTruthy();

    fireEvent.click(within(drawer).getByRole("tab", { name: "Modalities" }));
    await within(drawer).findByText("Enables this modality permission record.");
    expect(within(drawer).getByText("Authorizes protocoling for this modality.")).toBeTruthy();
    expect(within(drawer).getByText("Makes the doctor eligible for reporting assignments in this modality.")).toBeTruthy();
    expect(within(drawer).getByText(/Enables directed overbooking approval eligibility for this modality/)).toBeTruthy();
  });

  it.each([
    [false, "Enable clinical supervision", true],
    [true, "Disable clinical supervision", false],
  ] as const)("uses the clinical-supervision quick action label and only toggles that profile field", async (currentValue, label, nextValue) => {
    fetchDoctorProfilesForAdminMock.mockResolvedValue([{ ...profiles[0], canSupervise: currentValue }]);
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: label }));
    await waitFor(() => expect(updateDoctorProfileForAdminMock).toHaveBeenCalledWith(1, { canSupervise: nextValue }));
  });

  it("hides doctor import and export controls in the default directory", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "Doctor directory" })).toBeTruthy();
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
    expect(screen.getByRole("heading", { name: "Doctor directory" })).toBeTruthy();
    expect(screen.getByText("Download CSV template")).toBeTruthy();
    expect(screen.getByText("Download XLSX template")).toBeTruthy();
    expect(screen.getByText("Export CSV")).toBeTruthy();
    expect(screen.getByText("Export XLSX")).toBeTruthy();
    expect(screen.getByText("Import CSV/XLSX")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Preview import" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirm import" })).toBeTruthy();
  });

  it("keeps advanced doctor import, preview, confirm and export actions working", async () => {
    renderPage(adminMe, { advanced: true });
    const file = new File(["username,full_name\nfresh.doc,Fresh Doctor"], "doctors.csv", { type: "text/csv" });
    fireEvent.change(screen.getByLabelText("Import CSV/XLSX"), { target: { files: [file] } });

    await screen.findByText(/CSV file: 1 rows, 2 columns/);
    expect(inspectDoctorImportMock.mock.calls[0][0]).toMatchObject({ format: "csv", fileName: "doctors.csv" });
    const payload = inspectDoctorImportMock.mock.calls[0][0];
    fireEvent.click(screen.getByRole("button", { name: "Preview import" }));
    await waitFor(() => expect(previewDoctorImportMock.mock.calls[0]?.[0]).toEqual(payload));
    await screen.findByText("Row 1: create");
    fireEvent.click(screen.getByRole("button", { name: "Confirm import" }));
    await waitFor(() => expect(confirmDoctorImportMock.mock.calls[0]?.[0]).toEqual(payload));
    await screen.findByText(/Import complete: 1 users created, 0 users updated/);

    expect(screen.getByRole("link", { name: "Download CSV template" }).getAttribute("href")).toBe("/api/doctor/admin/doctors/import/template?format=csv");
    expect(screen.getByRole("link", { name: "Download XLSX template" }).getAttribute("href")).toBe("/api/doctor/admin/doctors/import/template?format=xlsx");
    expect(screen.getByRole("link", { name: "Export CSV" }).getAttribute("href")).toBe("/api/doctor/admin/doctors/export?format=csv");
    expect(screen.getByRole("link", { name: "Export XLSX" }).getAttribute("href")).toBe("/api/doctor/admin/doctors/export?format=xlsx");
  });

  it("opens the drawer on Account without automatically opening Modalities and saves profile changes", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const drawer = screen.getByRole("dialog", { name: "Manage doctor: Existing Doctor English" });
    expect(within(drawer).getByRole("button", { name: "Close" })).toBeTruthy();
    expect(within(drawer).getByRole("tab", { name: "Account" }).getAttribute("aria-selected")).toBe("true");
    expect(within(drawer).getByRole("tab", { name: "Modalities" }).getAttribute("aria-selected")).toBe("false");
    expect(screen.queryByText("Edit doctor profile: Existing Doctor English")).toBeNull();
    fireEvent.click(within(drawer).getByRole("tab", { name: "Doctor profile" }));
    const form = within(drawer).getByRole("region", { name: "Doctor profile" });
    expect(within(form).queryByPlaceholderText("Display name")).toBeNull();
    fireEvent.change(within(form).getByDisplayValue("Specialist"), { target: { value: "consultant" } });
    fireEvent.click(within(form).getByLabelText("Can finalize reports"));
    fireEvent.click(within(form).getByLabelText("Can assign protocols"));
    fireEvent.click(within(form).getByLabelText("Can supervise"));
    fireEvent.click(within(form).getByRole("button", { name: "Save profile" }));

    await waitFor(() => expect(updateDoctorProfileForAdminMock).toHaveBeenCalledWith(1, {
      displayName: "Dr Existing",
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
    const drawer = await screen.findByRole("dialog", { name: "Manage doctor: Existing Doctor English" });
    expect(within(drawer).getByRole("tab", { name: "Modalities" }).getAttribute("aria-selected")).toBe("true");
    const row = screen.getAllByText("CT").at(-1)!.closest("tr")!;
    await waitFor(() => expect((within(row).getAllByRole("checkbox")[0] as HTMLInputElement).checked).toBe(true));
    expect((within(row).getAllByRole("checkbox")[2] as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(row).getAllByRole("checkbox")[1]);
    expect((within(row).getAllByRole("checkbox")[1] as HTMLInputElement).checked).toBe(true);
    await waitFor(() => expect(updateDoctorProfileModalitiesMock).toHaveBeenCalledWith(1, expect.arrayContaining([expect.objectContaining({ modalityId: 5, canProtocol: true })])));

    fireEvent.click(within(drawer).getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Create doctor" }));
    const createDrawer = await screen.findByRole("dialog", { name: "Create doctor" });
    fireEvent.click(within(createDrawer).getByRole("button", { name: "Link existing RISpro user" }));
    fireEvent.change(within(createDrawer).getByLabelText("Select user"), { target: { value: "11" } });
    fireEvent.change(within(createDrawer).getByLabelText("Display name"), { target: { value: "New Profile" } });
    await waitFor(() => expect((within(createDrawer).getByRole("button", { name: "Create profile" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(within(createDrawer).getByRole("button", { name: "Create profile" }));
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
    const drawer = screen.getByRole("dialog", { name: "Manage doctor: Existing Doctor English" });
    expect(within(drawer).getByLabelText("Email")).toHaveProperty("value", "existing@nccb.ly");
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: " Updated.Doc " } });
    fireEvent.change(within(drawer).getByLabelText("Arabic Name"), { target: { value: "Updated Doctor" } });
    fireEvent.change(within(drawer).getByLabelText("English Name"), { target: { value: "Updated Doctor English" } });
    fireEvent.click(screen.getByRole("button", { name: "Save account" }));
    await waitFor(() => expect(updateDoctorLinkedUserForAdminMock).toHaveBeenCalledWith(10, { username: " Updated.Doc ", email: "existing@nccb.ly", fullName: "Updated Doctor", englishName: "Updated Doctor English", coreRole: "doctor", active: true }));
  });

  it("preserves the profile response email while the linked user query is still loading", async () => {
    fetchUsersMock.mockReturnValue(new Promise<{ users: User[] }>(() => {}));
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const drawer = screen.getByRole("dialog", { name: "Manage doctor: Existing Doctor English" });
    expect(within(drawer).getByLabelText("Email")).toHaveProperty("value", "existing@nccb.ly");
    fireEvent.click(within(drawer).getByRole("button", { name: "Save account" }));

    await waitFor(() => expect(updateDoctorLinkedUserForAdminMock).toHaveBeenCalledWith(10, {
      username: "existing.doc",
      email: "existing@nccb.ly",
      fullName: "Existing Doctor",
      englishName: "Existing Doctor English",
      coreRole: "doctor",
      active: true,
    }));
  });

  it("auto-fills only an untouched create email and preserves manual edits or clears", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Create doctor" }));
    const drawer = await screen.findByRole("dialog", { name: "Create doctor" });
    const username = within(drawer).getByLabelText("Username");
    const email = within(drawer).getByLabelText("Email");
    fireEvent.change(username, { target: { value: "doctor@nccb.ly" } });
    expect(email).toHaveProperty("value", "doctor@nccb.ly");
    fireEvent.change(username, { target: { value: "doctor.login" } });
    expect(email).toHaveProperty("value", "");
    fireEvent.change(username, { target: { value: "changed@nccb.ly" } });
    expect(email).toHaveProperty("value", "changed@nccb.ly");
    fireEvent.change(email, { target: { value: "" } });
    fireEvent.change(username, { target: { value: "another@nccb.ly" } });
    expect(email).toHaveProperty("value", "");
    fireEvent.change(username, { target: { value: "doctor.login" } });
    expect(email).toHaveProperty("value", "");
  });

  it("keeps duplicate username errors visible and the drawer open", async () => {
    updateDoctorLinkedUserForAdminMock.mockRejectedValueOnce(new Error("A user with that username already exists."));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Save account" }));
    expect((await screen.findByRole("alert")).textContent).toContain("already exists");
    expect(screen.getByRole("dialog", { name: "Manage doctor: Existing Doctor English" })).toBeTruthy();
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
