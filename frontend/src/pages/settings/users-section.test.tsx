import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "@/providers/language-provider-component";
import UsersSection from "./users-section";

const users = [
  { id: 1, username: "frontdesk", full_name: "Front Desk", role: "receptionist", is_active: true, can_request_scheduling_override: true, updated_at: "2026-08-01T10:00:00.000Z" },
  { id: 2, username: "drstone", full_name: "Dr Stone", role: "doctor", is_active: false, must_change_password: true },
  { id: 3, username: "supervisor", full_name: "Supervisor", role: "supervisor", is_active: true },
];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
let routeFailures: Record<string, string> = {};
let doctorProfiles: Array<{ userId: number; active: boolean }> = [];

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <QueryClientProvider client={client}>
          <UsersSection onReAuthRequired={vi.fn()} />
          <LocationProbe />
        </QueryClientProvider>
      </LanguageProvider>
    </MemoryRouter>,
  );
}

describe("UsersSection", () => {
  beforeEach(() => {
    localStorage.setItem("rispro-language", "en");
    routeFailures = {};
    doctorProfiles = [{ userId: 2, active: false }];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const failure = routeFailures[`${init?.method ?? "GET"} ${url}`];
      if (failure) return json({ message: failure }, 400);
      if (url === "/api/users" && !init?.method) return json({ users });
      if (url === "/api/doctor/profiles") return json({ profiles: doctorProfiles });
      if (url.includes("/identity")) return json({ user: users[0] });
      if (url.includes("/temporary-password")) return json({ user: users[0] });
      if (url.includes("/active")) return json({ user: users[0] });
      if (url.includes("/password")) return json({ user: users[0] });
      if (url.includes("scheduling-override-permission")) return json({ user: users[0] });
      if (url.match(/\/api\/users\/\d+$/) && init?.method === "DELETE") return json({ user: users[0] });
      if (url === "/api/users" && init?.method === "POST") return json({ user: users[0] }, 201);
      return json({ message: `Unexpected ${url}` }, 404);
    });
  });

  afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

  it("renders compact management data and filters by name, username, role, and status", async () => {
    renderSection();
    expect((await screen.findAllByText("Front Desk")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Dr Stone").length).toBeGreaterThan(0);
    expect(screen.queryByText("Doctor profiles and modality permissions are managed in Doctor Portal -> Admin -> Doctors.")).toBeNull();
    const search = screen.getByLabelText("Search users");
    await userEvent.type(search, "stone");
    expect(screen.queryByText("Front Desk")).toBeNull();
    await userEvent.clear(search);
    await userEvent.type(search, "frontdesk");
    expect(screen.getAllByText("Front Desk").length).toBeGreaterThan(0);
    await userEvent.clear(search);
    await userEvent.selectOptions(screen.getByLabelText("All roles"), "doctor");
    expect(screen.queryByText("Front Desk")).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText("All statuses"), "inactive");
    expect(screen.getAllByText("Dr Stone").length).toBeGreaterThan(0);
  });

  it("manages preserved and new user actions through the shared dialog", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderSection();
    await screen.findAllByText("Front Desk");
    await userEvent.click(screen.getAllByRole("button", { name: "Manage" })[0]!);
    expect(screen.getByRole("dialog")).toBeTruthy();
    await userEvent.click(screen.getByLabelText("Can request override approvals"));
    await userEvent.type(screen.getByLabelText("Direct password change"), "direct-password");
    await userEvent.click(screen.getByRole("button", { name: "Set password" }));
    await userEvent.type(screen.getByLabelText("Temporary password"), "temporary-password");
    await userEvent.click(screen.getByRole("button", { name: "Set temporary password" }));
    await userEvent.click(screen.getByRole("button", { name: "Deactivate account" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete user" }));
    await waitFor(() => expect(vi.mocked(globalThis.fetch).mock.calls.some(([url, init]) => String(url) === "/api/users/1/active" && (init as RequestInit).method === "PUT")).toBe(true));
    expect(vi.mocked(globalThis.fetch).mock.calls.some(([url]) => String(url) === "/api/users/1/temporary-password")).toBe(true);
    expect(confirm).toHaveBeenCalled();
  });

  it("keeps create-user workflow available in English", async () => {
    renderSection();
    await screen.findAllByText("Front Desk");
    await userEvent.click(screen.getByRole("button", { name: "Add User" }));
    await userEvent.type(screen.getByLabelText("Username"), "newuser");
    await userEvent.type(screen.getByLabelText("Full Name"), "New User");
    await userEvent.type(screen.getByLabelText("Password"), "safe-password");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(vi.mocked(globalThis.fetch).mock.calls.some(([url, init]) => String(url) === "/api/users" && (init as RequestInit).method === "POST")).toBe(true));
  });

  it("keeps an untouched create email synchronized with the username", async () => {
    const user = userEvent.setup();
    renderSection();
    await screen.findAllByText("Front Desk");
    await user.click(screen.getByRole("button", { name: "Add User" }));
    const username = screen.getByLabelText("Username");
    const email = screen.getByLabelText("Email");

    await user.type(username, "doctor@nccb.ly");
    expect((email as HTMLInputElement).value).toBe("doctor@nccb.ly");
    await user.clear(username);
    await user.type(username, "doctor.login");
    expect((email as HTMLInputElement).value).toBe("");
    await user.clear(username);
    await user.type(username, "another@nccb.ly");
    expect((email as HTMLInputElement).value).toBe("another@nccb.ly");
    await user.clear(email);
    await user.type(email, "manual@nccb.ly");
    await user.clear(username);
    await user.type(username, "final@nccb.ly");
    expect((email as HTMLInputElement).value).toBe("manual@nccb.ly");
  });

  it("uses role-aware Doctor Portal profile status and links unconfigured doctors to Doctors Directory", async () => {
    doctorProfiles = [];
    renderSection();
    expect((await screen.findAllByText("Needs configuration")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("No clinical profile").length).toBeGreaterThan(0);

    await userEvent.click(screen.getAllByRole("button", { name: "Manage" })[1]!);
    const dialog = screen.getByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Configure doctor profile" }),
    );
    expect(screen.getByTestId("location").textContent).toBe(
      "/doctor/doctors-directory?linkUserId=2",
    );
  });

  it("shows the Doctor Portal notice only when creating a doctor account", async () => {
    renderSection();
    await screen.findAllByText("Front Desk");
    await userEvent.click(screen.getByRole("button", { name: "Add User" }));
    await userEvent.selectOptions(screen.getByLabelText("Role"), "doctor");
    expect(
      screen.getByText(
        "Doctor accounts require a Doctor Portal profile. You can configure it after creating the account in Doctors Directory.",
      ),
    ).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText("Role"), "receptionist");
    expect(
      screen.queryByText(
        "Doctor accounts require a Doctor Portal profile. You can configure it after creating the account in Doctors Directory.",
      ),
    ).toBeNull();
  });

  it("shows active and inactive profiles for doctors", async () => {
    doctorProfiles = [{ userId: 2, active: true }];
    renderSection();
    expect((await screen.findAllByText("Active")).length).toBeGreaterThan(0);
    cleanup();

    doctorProfiles = [{ userId: 2, active: false }];
    renderSection();
    expect((await screen.findAllByText("Inactive")).length).toBeGreaterThan(0);
  });

  it("clears every create field, including password and role, when Cancel closes the dialog", async () => {
    renderSection();
    await screen.findAllByText("Front Desk");
    await userEvent.click(screen.getByRole("button", { name: "Add User" }));
    await userEvent.type(screen.getByLabelText("Username"), "discard-user");
    await userEvent.type(screen.getByLabelText("Full Name"), "Discard User");
    await userEvent.type(screen.getByLabelText("Password"), "discard-password");
    await userEvent.selectOptions(screen.getByLabelText("Role"), "doctor");
    await userEvent.click(screen.getAllByRole("button", { name: "Cancel" })[1]!);
    await userEvent.click(screen.getByRole("button", { name: "Add User" }));
    expect((screen.getByLabelText("Username") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Full Name") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Role") as HTMLSelectElement).value).toBe("receptionist");
  });

  it("renders create and manage mutation errors inside their open dialogs", async () => {
    routeFailures["POST /api/users"] = "Username is already in use.";
    renderSection();
    await screen.findAllByText("Front Desk");
    await userEvent.click(screen.getByRole("button", { name: "Add User" }));
    await userEvent.type(screen.getByLabelText("Username"), "duplicate");
    await userEvent.type(screen.getByLabelText("Full Name"), "Duplicate User");
    await userEvent.type(screen.getByLabelText("Password"), "safe-password");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Username is already in use.");
    await userEvent.click(screen.getAllByRole("button", { name: "Cancel" })[1]!);

    routeFailures["PUT /api/users/1/active"] = "You cannot deactivate your own account.";
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await userEvent.click(screen.getAllByRole("button", { name: "Manage" })[0]!);
    await userEvent.click(screen.getByRole("button", { name: "Deactivate account" }));
    expect((await screen.findByRole("alert")).textContent).toContain("You cannot deactivate your own account.");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("reactivates inactive users and clears sensitive drafts when the dialog closes", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderSection();
    await screen.findAllByText("Front Desk");
    await userEvent.click(screen.getAllByRole("button", { name: "Manage" })[0]!);
    const directPassword = screen.getByLabelText("Direct password change") as HTMLInputElement;
    await userEvent.type(directPassword, "discard-me");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.click(screen.getAllByRole("button", { name: "Manage" })[1]!);
    expect((screen.getByLabelText("Direct password change") as HTMLInputElement).value).toBe("");
    await userEvent.click(screen.getByRole("button", { name: "Reactivate account" }));
    await waitFor(() => expect(vi.mocked(globalThis.fetch).mock.calls.some(([url, init]) => String(url) === "/api/users/2/active" && (init as RequestInit).method === "PUT")).toBe(true));
  });

  it("keeps account identity read-only until editing, then pre-fills editable details without a role selector", async () => {
    renderSection();
    await screen.findAllByText("Front Desk");
    await userEvent.click(screen.getAllByRole("button", { name: "Manage" })[0]!);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByRole("textbox", { name: "Full Name" })).toBeNull();
    expect(within(dialog).queryByRole("textbox", { name: "Username" })).toBeNull();
    await userEvent.click(within(dialog).getByRole("button", { name: "Edit details" }));
    expect((within(dialog).getByRole("textbox", { name: "Full Name" }) as HTMLInputElement).value).toBe("Front Desk");
    expect((within(dialog).getByRole("textbox", { name: "Username" }) as HTMLInputElement).value).toBe("frontdesk");
    expect(within(dialog).queryByRole("combobox", { name: "Role" })).toBeNull();
    expect((within(dialog).getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("saves account identity, discards abandoned drafts, and shows duplicate errors inside Manage", async () => {
    renderSection();
    await screen.findAllByText("Front Desk");
    await userEvent.click(screen.getAllByRole("button", { name: "Manage" })[0]!);
    let dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Edit details" }));
    await userEvent.clear(within(dialog).getByRole("textbox", { name: "Username" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Username" }), "UpdatedUser");
    await userEvent.clear(within(dialog).getByRole("textbox", { name: "Full Name" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Full Name" }), "Updated User");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(vi.mocked(globalThis.fetch).mock.calls.some(([url, init]) => String(url) === "/api/users/1/identity" && (init as RequestInit).method === "PUT" && String((init as RequestInit).body) === JSON.stringify({ username: "UpdatedUser", email: "", fullName: "Updated User" }))).toBe(true));

    await userEvent.click(within(dialog).getByRole("button", { name: "Edit details" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Username" }), "discard");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel editing" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Edit details" }));
    expect((within(dialog).getByRole("textbox", { name: "Username" }) as HTMLInputElement).value).toBe("frontdesk");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel editing" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await userEvent.click(screen.getAllByRole("button", { name: "Manage" })[0]!);
    dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Edit details" }));
    routeFailures["PUT /api/users/1/identity"] = "A user with that username already exists.";
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Username" }), "duplicate");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    expect((await within(dialog).findByRole("alert")).textContent).toContain("A user with that username already exists.");
  });
});
