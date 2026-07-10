import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PageAccessRoute } from "@/components/auth/page-access-route";
import { NAV_ITEMS, MobileDrawer, SideNav, TopBar } from "./navigation";
import { DEFAULT_PAGE_VISIBILITY_MATRIX, type PageVisibilityMatrix } from "@/lib/page-visibility";

vi.mock("lucide-react", () => {
  const Icon = () => null;
  return {
    LayoutGrid: Icon,
    Users: Icon,
    GitMerge: Icon,
    BookOpenText: Icon,
    CalendarDays: Icon,
    ClipboardList: Icon,
    ListOrdered: Icon,
    Monitor: Icon,
    UserCheck: Icon,
    Printer: Icon,
    BarChart3: Icon,
    Database: Icon,
    Settings: Icon,
    History: Icon,
    Menu: Icon,
    X: Icon,
    Undo2: Icon,
    Redo2: Icon,
    Languages: Icon,
    LogOut: Icon,
    Search: Icon,
    Loader2: Icon,
    UserRound: Icon,
    ChevronLeft: Icon,
    ChevronRight: Icon,
    Plus: Icon,
    ChevronDown: Icon,
    Globe2: Icon,
  };
});

const matrixState: { value: unknown } = { value: DEFAULT_PAGE_VISIBILITY_MATRIX };

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual("@tanstack/react-query");
  return {
    ...actual,
    useQuery: () => ({ data: matrixState.value }),
  };
});

describe("Navigation governance", () => {
  it("does not include V3 create route in NAV_ITEMS", () => {
    expect(NAV_ITEMS.map((item) => item.route)).not.toContain("v3.appointments.create");
  });

  it("does not render V3 create nav entry for receptionist users", () => {
    matrixState.value = DEFAULT_PAGE_VISIBILITY_MATRIX;
    render(
      <SideNav
        currentRoute="appointments"
        user={{ id: 1, username: "rec", fullName: "Reception", role: "receptionist" }}
        language="en"
        isRtl={false}
        onNavigate={() => {}}
      />
    );

    expect(screen.queryByText("Create appointment (V3)")).toBeNull();
  });

  it("keeps receptionist appointment navigation on the appointments route", async () => {
    matrixState.value = DEFAULT_PAGE_VISIBILITY_MATRIX;
    const onNavigate = vi.fn();
    render(
      <SideNav
        currentRoute="dashboard"
        user={{ id: 1, username: "rec", fullName: "Reception", role: "receptionist" }}
        language="en"
        isRtl={false}
        onNavigate={onNavigate}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "New" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "New appointment" }));
    expect(onNavigate).toHaveBeenCalledWith("appointments");
  });

  it("keeps quick actions distinct and permission-filtered", async () => {
    matrixState.value = { ...DEFAULT_PAGE_VISIBILITY_MATRIX, patients: [] };
    render(
      <SideNav
        currentRoute="dashboard"
        user={{ id: 1, username: "rec", fullName: "Reception", role: "receptionist" }}
        language="en"
        isRtl={false}
        onNavigate={() => {}}
      />
    );

    const newButton = screen.getByRole("button", { name: "New" });
    expect(newButton.className).toContain("border");
    await userEvent.click(newButton);
    expect(screen.queryByRole("menuitem", { name: "New patient" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "New appointment" })).toBeTruthy();
  });

  it("keeps both quick-action routes available when authorized", async () => {
    const onNavigate = vi.fn();
    matrixState.value = DEFAULT_PAGE_VISIBILITY_MATRIX;
    render(<SideNav currentRoute="dashboard" user={{ id: 5, username: "sa", fullName: "Super", role: "super_admin" }} language="en" isRtl={false} onNavigate={onNavigate} />);
    await userEvent.click(screen.getByRole("button", { name: "New" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "New patient" }));
    expect(onNavigate).toHaveBeenCalledWith("patients.new");
  });

  it("renders top-bar extra actions without adding navigation entries", () => {
    render(
      <TopBar
        user={{ id: 1, username: "rec", fullName: "Reception", role: "receptionist" }}
        language="en"
        isRtl={false}
        extraActions={<button type="button">Override requests</button>}
        onUndo={() => {}}
        onRedo={() => {}}
        onToggleLanguage={() => {}}
        onLogout={() => {}}
        onMobileNavToggle={() => {}}
      />
    );

    expect(screen.getByRole("button", { name: "Override requests" })).toBeTruthy();
    expect(NAV_ITEMS.some((item) => item.route === "scheduling.override.requests")).toBe(true);
  });

  it("keeps only menu and global search as the normal mobile controls", () => {
    render(
      <TopBar
        user={{ id: 1, username: "rec", fullName: "Reception", role: "receptionist" }}
        language="en"
        isRtl={false}
        onUndo={() => {}}
        onRedo={() => {}}
        onToggleLanguage={() => {}}
        onLogout={() => {}}
        onMobileNavToggle={() => {}}
      />
    );

    expect(screen.getByRole("button", { name: "Toggle navigation" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Search patients or registrations" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "History" }).parentElement?.className).toContain("hidden");
    expect(screen.queryByRole("button", { name: "Manage Security PIN" })).toBeNull();
    expect(screen.getByRole("button", { name: "Switch language to Arabic" }).className).toContain("hidden");
  });

  it("places the localized page identity at the start and keeps the global search separate", () => {
    render(
      <TopBar
        user={{ id: 1, username: "sa", fullName: "Sam User", role: "super_admin" }}
        language="en"
        isRtl={false}
        pageTitle="Patients"
        onUndo={() => {}}
        onRedo={() => {}}
        onToggleLanguage={() => {}}
        onLogout={() => {}}
        onMobileNavToggle={() => {}}
      />
    );

    expect(screen.getByText("Patients")).toBeTruthy();
    expect(screen.queryByText("SUPER_ADMIN")).toBeNull();
    expect(screen.getByRole("button", { name: "Search patients or registrations" })).toBeTruthy();
    expect(screen.queryByText("Patients")?.closest("header")?.querySelector(".rounded-full")).toBeNull();
  });

  it("uses a readable role and functional account menu actions", async () => {
    const onSettings = vi.fn();
    const onLogout = vi.fn();
    render(
      <TopBar
        user={{ id: 1, username: "sa", fullName: "Sam User", role: "super_admin" }}
        language="en"
        isRtl={false}
        accountMenuActions={<button type="button" role="menuitem">Manage Security PIN</button>}
        canAccessSettings
        onSettings={onSettings}
        onUndo={() => {}}
        onRedo={() => {}}
        onToggleLanguage={() => {}}
        onLogout={onLogout}
        onMobileNavToggle={() => {}}
      />
    );

    expect(screen.getByText("Super administrator")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Open account menu" }));
    expect(screen.getByRole("menuitem", { name: "Manage Security PIN" })).toBeTruthy();
    await userEvent.click(screen.getByRole("menuitem", { name: "Settings" }));
    expect(onSettings).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "Open account menu" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(onLogout).toHaveBeenCalledOnce();
  });

  it("keeps history and language controls accessible on desktop", async () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const onToggleLanguage = vi.fn();
    render(
      <TopBar
        user={{ id: 1, username: "rec", fullName: "Reception", role: "receptionist" }}
        language="en"
        isRtl={false}
        onUndo={onUndo}
        onRedo={onRedo}
        onToggleLanguage={onToggleLanguage}
        onLogout={() => {}}
        onMobileNavToggle={() => {}}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "History" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "History" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Redo" }));
    expect(onRedo).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "Switch language to Arabic" }));
    expect(onToggleLanguage).toHaveBeenCalledOnce();
  });

  it("mirrors the top-bar shell for RTL without changing the search contract", () => {
    render(
      <TopBar
        user={{ id: 1, username: "sa", fullName: "مستخدم", role: "super_admin" }}
        language="ar"
        isRtl
        pageTitle="المرضى"
        onUndo={() => {}}
        onRedo={() => {}}
        onToggleLanguage={() => {}}
        onLogout={() => {}}
        onMobileNavToggle={() => {}}
      />
    );

    const header = screen.getByRole("banner");
    expect(header.getAttribute("dir")).toBe("rtl");
    expect(screen.getByText("المرضى")).toBeTruthy();
    expect(screen.getByRole("button", { name: "البحث عن المرضى أو التسجيلات" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "فتح قائمة الحساب" })).toBeTruthy();
  });

  it("renders signed-in account actions in the mobile drawer", async () => {
    const onToggleLanguage = vi.fn();
    const onLogout = vi.fn();
    render(
      <MobileDrawer
        isOpen
        currentRoute="dashboard"
        user={{ id: 1, username: "rec", fullName: "Reception User", role: "receptionist" }}
        language="en"
        isRtl={false}
        onNavigate={() => {}}
        onClose={() => {}}
        onToggleLanguage={onToggleLanguage}
        onLogout={onLogout}
        accountActions={<button type="button">Manage Security PIN</button>}
      />
    );

    expect(screen.getByText("Reception User")).toBeTruthy();
    expect(screen.getByText("receptionist")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "العربية" }));
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onToggleLanguage).toHaveBeenCalledOnce();
    expect(onLogout).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Manage Security PIN" })).toBeTruthy();
  });

  it("shows Override Requests nav for receptionist, supervisor, and superadmin by default", () => {
    matrixState.value = DEFAULT_PAGE_VISIBILITY_MATRIX;
    for (const role of ["receptionist", "supervisor", "super_admin"] as const) {
      const { unmount } = render(
        <SideNav
          currentRoute="dashboard"
          user={{ id: 1, username: role, fullName: role, role }}
          language="en"
          isRtl={false}
          onNavigate={() => {}}
        />
      );
      expect(screen.queryByText("Override requests")).not.toBeNull();
      unmount();
    }
  });

  it("hides Override Requests nav for non-configured roles by default", () => {
    matrixState.value = DEFAULT_PAGE_VISIBILITY_MATRIX;
    for (const role of ["doctor", "modality_staff", "administrative"] as const) {
      const { unmount } = render(
        <SideNav
          currentRoute="dashboard"
          user={{ id: 1, username: role, fullName: role, role }}
          language="en"
          isRtl={false}
          onNavigate={() => {}}
        />
      );
      expect(screen.queryByText("Override requests")).toBeNull();
      unmount();
    }
  });

  it("shows Override Requests when page visibility config grants access", () => {
    matrixState.value = {
      ...DEFAULT_PAGE_VISIBILITY_MATRIX,
      "scheduling.override.requests": ["doctor"],
    };
    render(
      <SideNav
        currentRoute="dashboard"
        user={{ id: 2, username: "doc", fullName: "Doctor", role: "doctor" }}
        language="en"
        isRtl={false}
        onNavigate={() => {}}
      />
    );
    expect(screen.queryByText("Override requests")).not.toBeNull();
  });

  it("guards Override Requests route with page access config", () => {
    const user = { id: 2, username: "doc", fullName: "Doctor", role: "doctor" } as const;
    const matrix: PageVisibilityMatrix = {
      ...DEFAULT_PAGE_VISIBILITY_MATRIX,
      "scheduling.override.requests": ["doctor"],
    };
    render(
      <MemoryRouter initialEntries={["/scheduling/override-requests"]}>
        <Routes>
          <Route
            path="/scheduling/override-requests"
            element={
              <PageAccessRoute routeKey="scheduling.override.requests" user={user} matrix={matrix} defaultLandingPath="/doctor">
                <div>Override Requests Page</div>
              </PageAccessRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText("Override Requests Page")).toBeTruthy();
  });

  it("receptionist does not see doctor/modality/statistics/settings by default", () => {
    matrixState.value = DEFAULT_PAGE_VISIBILITY_MATRIX;
    render(
      <SideNav
        currentRoute="dashboard"
        user={{ id: 1, username: "rec", fullName: "Reception", role: "receptionist" }}
        language="en"
        isRtl={false}
        onNavigate={() => {}}
      />
    );

    expect(screen.queryByText("Doctor workspace")).toBeNull();
    expect(screen.queryByText("Modality board")).toBeNull();
    expect(screen.queryByText("Statistics")).toBeNull();
    expect(screen.queryByText("Settings")).toBeNull();
  });

  it("doctor sees doctor page by default", () => {
    matrixState.value = DEFAULT_PAGE_VISIBILITY_MATRIX;
    render(
      <SideNav
        currentRoute="dashboard"
        user={{ id: 2, username: "doc", fullName: "Doctor", role: "doctor" }}
        language="en"
        isRtl={false}
        onNavigate={() => {}}
      />
    );
    expect(screen.queryByText("Doctor workspace")).not.toBeNull();
  });

  it("modality_staff sees modality page by default", () => {
    matrixState.value = DEFAULT_PAGE_VISIBILITY_MATRIX;
    render(
      <SideNav
        currentRoute="dashboard"
        user={{ id: 3, username: "tech", fullName: "Tech", role: "modality_staff" }}
        language="en"
        isRtl={false}
        onNavigate={() => {}}
      />
    );
    expect(screen.queryByText("Modality board")).not.toBeNull();
  });

  it("renders a desktop sidebar collapse toggle", async () => {
    matrixState.value = DEFAULT_PAGE_VISIBILITY_MATRIX;
    const onToggleCollapsed = vi.fn();
    const { rerender } = render(
      <SideNav
        currentRoute="modality"
        user={{ id: 3, username: "tech", fullName: "Tech", role: "modality_staff" }}
        language="en"
        isRtl={false}
        collapsed={false}
        onToggleCollapsed={onToggleCollapsed}
        onNavigate={() => {}}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "Collapse navigation" }));
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);

    rerender(
      <SideNav
        currentRoute="modality"
        user={{ id: 3, username: "tech", fullName: "Tech", role: "modality_staff" }}
        language="en"
        isRtl={false}
        collapsed
        onToggleCollapsed={onToggleCollapsed}
        onNavigate={() => {}}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "Expand navigation" }));
    expect(onToggleCollapsed).toHaveBeenCalledTimes(2);
  });

  it("uses the intentional legacy fallback label and keeps Settings in Administration", () => {
    matrixState.value = DEFAULT_PAGE_VISIBILITY_MATRIX;
    render(
      <SideNav
        currentRoute="settings"
        user={{ id: 5, username: "sa", fullName: "Super", role: "super_admin" }}
        language="en"
        isRtl={false}
        onNavigate={() => {}}
      />
    );

    expect(screen.queryByText("Other")).toBeNull();
    expect(screen.getByText("Legacy / fallback")).toBeTruthy();
    expect(screen.getByText("Settings")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Administration" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps Legacy Reception restricted and avoids mixed locale labels", () => {
    matrixState.value = DEFAULT_PAGE_VISIBILITY_MATRIX;
    const { unmount } = render(
      <SideNav
        currentRoute="legacy"
        user={{ id: 1, username: "rec", fullName: "Reception", role: "receptionist" }}
        language="en"
        isRtl={false}
        onNavigate={() => {}}
      />
    );
    expect(screen.queryByText("Legacy Reception")).toBeNull();
    unmount();

    render(
      <SideNav
        currentRoute="legacy"
        user={{ id: 5, username: "sa", fullName: "Super", role: "super_admin" }}
        language="ar"
        isRtl
        onNavigate={() => {}}
      />
    );
    expect(screen.getByText("النظام السابق / الاحتياطي")).toBeTruthy();
    expect(screen.queryByText("Legacy / fallback")).toBeNull();
  });

  it("shows Patients when the fetched matrix grants modality_staff access", () => {
    matrixState.value = {
      ...DEFAULT_PAGE_VISIBILITY_MATRIX,
      patients: ["modality_staff", "super_admin"],
    };
    render(
      <SideNav
        currentRoute="dashboard"
        user={{ id: 9, username: "tech2", fullName: "Tech2", role: "modality_staff" }}
        language="en"
        isRtl={false}
        onNavigate={() => {}}
      />
    );

    expect(screen.queryByText("Patients")).not.toBeNull();
  });

  it("hides Patients when the fetched matrix excludes modality_staff", () => {
    matrixState.value = {
      ...DEFAULT_PAGE_VISIBILITY_MATRIX,
      patients: ["receptionist", "supervisor", "doctor", "super_admin"],
    };
    render(
      <SideNav
        currentRoute="dashboard"
        user={{ id: 10, username: "tech3", fullName: "Tech3", role: "modality_staff" }}
        language="en"
        isRtl={false}
        onNavigate={() => {}}
      />
    );

    expect(screen.queryByText("Patients")).toBeNull();
  });

  it("administrative sees statistics by default", () => {
    matrixState.value = DEFAULT_PAGE_VISIBILITY_MATRIX;
    render(
      <SideNav
        currentRoute="dashboard"
        user={{ id: 4, username: "adm", fullName: "Admin", role: "administrative" }}
        language="en"
        isRtl={false}
        onNavigate={() => {}}
      />
    );
    expect(screen.queryByText("Statistics")).not.toBeNull();
  });

  it("super_admin sees settings by default", () => {
    matrixState.value = DEFAULT_PAGE_VISIBILITY_MATRIX;
    render(
      <SideNav
        currentRoute="dashboard"
        user={{ id: 5, username: "sa", fullName: "Super", role: "super_admin" }}
        language="en"
        isRtl={false}
        onNavigate={() => {}}
      />
    );
    expect(screen.queryByText("Settings")).not.toBeNull();
  });

  it("saved config changes navigation visibility", () => {
    matrixState.value = {
      ...DEFAULT_PAGE_VISIBILITY_MATRIX,
      doctor: ["doctor", "super_admin"],
      statistics: ["super_admin"],
    };
    render(
      <SideNav
        currentRoute="dashboard"
        user={{ id: 6, username: "sup", fullName: "Supervisor", role: "supervisor" }}
        language="en"
        isRtl={false}
        onNavigate={() => {}}
      />
    );
    expect(screen.queryByText("Doctor workspace")).toBeNull();
    expect(screen.queryByText("Statistics")).toBeNull();
  });

  it("failed or missing config falls back to defaults", () => {
    matrixState.value = undefined;
    render(
      <SideNav
        currentRoute="dashboard"
        user={{ id: 7, username: "doc", fullName: "Doctor", role: "doctor" }}
        language="en"
        isRtl={false}
        onNavigate={() => {}}
      />
    );
    expect(screen.queryByText("Doctor workspace")).not.toBeNull();
  });

  it("settings access cannot be removed from super_admin", () => {
    matrixState.value = {
      ...DEFAULT_PAGE_VISIBILITY_MATRIX,
      settings: [],
    };
    render(
      <SideNav
        currentRoute="dashboard"
        user={{ id: 8, username: "sa2", fullName: "Super2", role: "super_admin" }}
        language="en"
        isRtl={false}
        onNavigate={() => {}}
      />
    );
    expect(screen.queryByText("Settings")).not.toBeNull();
  });

  it("places PACS remap in Clinical workflow and auto-expands the active group", () => {
    matrixState.value = DEFAULT_PAGE_VISIBILITY_MATRIX;
    render(
      <SideNav
        currentRoute="pacs.remap"
        user={{ id: 5, username: "sa", fullName: "Super", role: "super_admin" }}
        language="en"
        isRtl={false}
        onNavigate={() => {}}
      />
    );

    expect(screen.getByText("Clinical workflow")).toBeTruthy();
    expect(screen.queryByText("Overview")).toBeNull();
    expect(screen.getByText("PACS remap")).toBeTruthy();
    expect(screen.getByRole("button", { name: "PACS remap" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "Clinical workflow" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("hides empty groups and keeps administration and systems collapsed by default", () => {
    matrixState.value = {
      ...DEFAULT_PAGE_VISIBILITY_MATRIX,
      "scheduling.override.requests": [],
      "v2.appointments.admin": [],
      "patients.merge": [],
      "name.dictionary": [],
      pacs: [],
      "pacs.remap": [],
      "worklist.monitor": [],
      legacy: [],
      settings: [],
    };
    const { unmount: unmountReception } = render(
      <SideNav
        currentRoute="dashboard"
        user={{ id: 1, username: "rec", fullName: "Reception", role: "receptionist" }}
        language="en"
        isRtl={false}
        onNavigate={() => {}}
      />
    );

    expect(screen.queryByText("Administration")).toBeNull();
    expect(screen.queryByText("Systems")).toBeNull();
    unmountReception();

    matrixState.value = DEFAULT_PAGE_VISIBILITY_MATRIX;
    const { unmount } = render(
      <SideNav
        currentRoute="dashboard"
        user={{ id: 5, username: "sa", fullName: "Super", role: "super_admin" }}
        language="en"
        isRtl={false}
        onNavigate={() => {}}
      />
    );
    expect(screen.getByRole("button", { name: "Administration" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: "Systems" }).getAttribute("aria-expanded")).toBe("false");
    unmount();
  });

  it("keeps collapsed links usable with accessible labels and active state", () => {
    matrixState.value = DEFAULT_PAGE_VISIBILITY_MATRIX;
    render(
      <SideNav
        currentRoute="pacs.remap"
        user={{ id: 5, username: "sa", fullName: "Super", role: "super_admin" }}
        language="en"
        isRtl={false}
        collapsed
        onNavigate={() => {}}
      />
    );

    const item = screen.getByRole("button", { name: "PACS remap" });
    expect(item.getAttribute("title")).toBe("PACS remap");
    expect(item.getAttribute("aria-current")).toBe("page");
    expect(screen.queryByText("Clinical workflow")).toBeNull();
  });

  it("mirrors active accent and collapse edge in RTL", () => {
    matrixState.value = DEFAULT_PAGE_VISIBILITY_MATRIX;
    render(<SideNav currentRoute="pacs.remap" user={{ id: 5, username: "sa", fullName: "Super", role: "super_admin" }} language="ar" isRtl collapsed={false} onToggleCollapsed={() => {}} onNavigate={() => {}} />);
    const active = screen.getByRole("button", { name: "إعادة ربط PACS" });
    expect(active.querySelector("[aria-hidden='true']")?.className).toContain("right-0");
    expect(screen.getByRole("button", { name: "طي القائمة" })).toBeTruthy();
    expect(screen.getByText("سير العمل السريري")).toBeTruthy();
  });
});
