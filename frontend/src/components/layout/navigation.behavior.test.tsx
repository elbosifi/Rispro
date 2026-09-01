import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PageAccessRoute } from "@/components/auth/page-access-route";
import { MobileDrawer, SideNav, TopBar } from "./navigation";
import { APP_NAV_ITEMS as NAV_ITEMS } from "@/lib/route-registry";
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
    ShieldAlert: Icon,
  };
});

const matrixState: { value: unknown } = { value: DEFAULT_PAGE_VISIBILITY_MATRIX };
const recallSummaryState: { value: unknown } = { value: { pendingCount: 0, unseenPendingCount: 0 } };
const requestScanSummaryState: { value: { needsAttentionCount: number; latestProcessedAt: string | null; latestFailedAt: string | null } | undefined } = { value: undefined };

function requestScanSideNav() {
  return <SideNav currentRoute="dashboard" user={{ id: 1, username: "rec", fullName: "Reception", role: "receptionist" }} language="en" isRtl={false} onNavigate={() => {}} />;
}

function mockPointerMode(fine: boolean) {
  const matchMedia = vi.fn(() => ({
    matches: fine,
    media: "(pointer: fine)",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    onchange: null,
    dispatchEvent: vi.fn(),
  }));
  Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: matchMedia });
}

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual("@tanstack/react-query");
  return {
    ...actual,
    useQuery: (options: { queryKey?: unknown[]; enabled?: boolean }) => {
      if (options.enabled === false) return { data: undefined };
      if (options.queryKey?.[0] === "complementary-recalls" && options.queryKey[1] === "reception-summary") return { data: recallSummaryState.value };
      if (options.queryKey?.[0] === "request-scans" && options.queryKey[1] === "reception-summary") return { data: requestScanSummaryState.value };
      return { data: matrixState.value };
    },
  };
});

describe("Navigation governance", () => {
  it("places Authoritative Orthanc between PACS and MWL monitor for authorized users", async () => {
    matrixState.value = DEFAULT_PAGE_VISIBILITY_MATRIX;
    render(<SideNav currentRoute="authoritative.orthanc" user={{ id: 5, username: "sa", fullName: "Super Admin", role: "super_admin" }} language="en" isRtl={false} onNavigate={() => {}} />);
    const systems = screen.getByRole("button", { name: /Systems/ });
    if (systems.getAttribute("aria-expanded") === "false") await userEvent.click(systems);
    const labels = screen.getAllByRole("button").map((button) => button.getAttribute("aria-label"));
    const pacs = labels.indexOf("PACS");
    const orthanc = labels.indexOf("Authoritative Orthanc");
    const worklist = labels.indexOf("MWL monitor");
    expect(orthanc).toBeGreaterThan(-1);
    expect(pacs).toBeLessThan(orthanc);
    expect(orthanc).toBeLessThan(worklist);
  });

  it("does not expose Authoritative Orthanc navigation to unrelated roles", () => {
    matrixState.value = DEFAULT_PAGE_VISIBILITY_MATRIX;
    render(<SideNav currentRoute="dashboard" user={{ id: 2, username: "rec", fullName: "Reception", role: "receptionist" }} language="en" isRtl={false} onNavigate={() => {}} />);
    expect(screen.queryByRole("button", { name: "Authoritative Orthanc" })).toBeNull();
  });

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

  it("shows the workspace switcher beside the account control for authorized users", async () => {
    const onWorkspaceNavigate = vi.fn();
    render(
      <TopBar
        user={{ id: 1, username: "doc", fullName: "Doctor", role: "doctor" }}
        language="en"
        isRtl={false}
        canAccessDoctorWorkspace
        onWorkspaceNavigate={onWorkspaceNavigate}
        onUndo={() => {}}
        onRedo={() => {}}
        onToggleLanguage={() => {}}
        onLogout={() => {}}
        onMobileNavToggle={() => {}}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "Switch workspace: RISpro Core" }));
    expect(screen.getByRole("menuitem", { name: /RISpro Core/ })).toBeTruthy();
    await userEvent.click(screen.getByRole("menuitem", { name: "Doctor Workspace" }));
    expect(onWorkspaceNavigate).toHaveBeenCalledWith("/doctor/my-work");
  });

  it("keeps only menu and global search as the normal mobile controls", () => {
    const onMobileNavToggle = vi.fn();
    render(
      <TopBar
        user={{ id: 1, username: "rec", fullName: "Reception", role: "receptionist" }}
        language="en"
        isRtl={false}
        onUndo={() => {}}
        onRedo={() => {}}
        onToggleLanguage={() => {}}
        onLogout={() => {}}
        onMobileNavToggle={onMobileNavToggle}
      />
    );

    expect(screen.getByRole("button", { name: "Toggle navigation" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Toggle navigation" }).className).toContain("lg:hidden");
    expect(screen.getByRole("button", { name: "Search patients or registrations" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "History" }).parentElement?.className).toContain("hidden");
    expect(screen.queryByRole("button", { name: "Manage Security PIN" })).toBeNull();
    expect(screen.getByRole("button", { name: "Switch language to Arabic" }).parentElement?.className).toContain("hidden");
    fireEvent.click(screen.getByRole("button", { name: "Toggle navigation" }));
    expect(onMobileNavToggle).toHaveBeenCalledOnce();
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

  it("renders supplied menu actions in the primary mobile navigation area", () => {
    render(
      <MobileDrawer
        isOpen
        currentRoute="dashboard"
        user={{ id: 1, username: "rec", fullName: "Reception User", role: "receptionist" }}
        language="en"
        isRtl={false}
        onNavigate={() => {}}
        onClose={() => {}}
        onToggleLanguage={() => {}}
        onLogout={() => {}}
        menuActions={<button type="button">Notifications</button>}
      />
    );

    const notifications = screen.getByRole("button", { name: "Notifications" });
    const dashboard = screen.getByRole("button", { name: "Dashboard" });
    const frontDesk = screen.getByRole("button", { name: "Front desk" });
    expect(Boolean(notifications.compareDocumentPosition(dashboard) & Node.DOCUMENT_POSITION_PRECEDING)).toBe(true);
    expect(Boolean(frontDesk.compareDocumentPosition(notifications) & Node.DOCUMENT_POSITION_PRECEDING)).toBe(true);
  });

  it("uses the grouped navigation model in the mobile drawer", () => {
    matrixState.value = DEFAULT_PAGE_VISIBILITY_MATRIX;
    render(
      <MobileDrawer
        isOpen
        currentRoute="dashboard"
        user={{ id: 5, username: "sa", fullName: "Super", role: "super_admin" }}
        language="en"
        isRtl={false}
        onNavigate={() => {}}
        onClose={() => {}}
        onToggleLanguage={() => {}}
        onLogout={() => {}}
      />
    );

    for (const label of ["New", "Front desk", "Clinical workflow", "Reporting", "Administration", "Systems"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: "Dashboard" })).toBeTruthy();
  });

  it("keeps mobile quick actions permission-filtered and closes after navigation", async () => {
    matrixState.value = DEFAULT_PAGE_VISIBILITY_MATRIX;
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    render(
      <MobileDrawer
        isOpen
        currentRoute="dashboard"
        user={{ id: 1, username: "rec", fullName: "Reception", role: "receptionist" }}
        language="en"
        isRtl={false}
        onNavigate={onNavigate}
        onClose={onClose}
        onToggleLanguage={() => {}}
        onLogout={() => {}}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "New" }));
    expect(screen.getByRole("menuitem", { name: "New patient" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "New appointment" })).toBeTruthy();
    await userEvent.click(screen.getByRole("menuitem", { name: "New appointment" }));
    expect(onNavigate).toHaveBeenCalledWith("appointments");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps administration entries inside the mobile Administration group", async () => {
    matrixState.value = DEFAULT_PAGE_VISIBILITY_MATRIX;
    render(
      <MobileDrawer
        isOpen
        currentRoute="dashboard"
        user={{ id: 5, username: "sa", fullName: "Super", role: "super_admin" }}
        language="en"
        isRtl={false}
        onNavigate={() => {}}
        onClose={() => {}}
        onToggleLanguage={() => {}}
        onLogout={() => {}}
      />
    );

    const administration = screen.getByRole("button", { name: "Administration" });
    if (administration.getAttribute("aria-expanded") === "false") await userEvent.click(administration);
    for (const label of ["Override requests", "Scheduling policy", "Patient merge", "Name dictionary"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
  });

  it("uses the same page visibility model for desktop and mobile navigation", () => {
    matrixState.value = { ...DEFAULT_PAGE_VISIBILITY_MATRIX, statistics: [] };
    const user = { id: 5, username: "sa", fullName: "Super", role: "super_admin" } as const;
    const { unmount } = render(<SideNav currentRoute="dashboard" user={user} language="en" isRtl={false} onNavigate={() => {}} />);
    expect(screen.queryByRole("button", { name: "Statistics" })).toBeNull();
    unmount();
    render(<MobileDrawer isOpen currentRoute="dashboard" user={user} language="en" isRtl={false} onNavigate={() => {}} onClose={() => {}} onToggleLanguage={() => {}} onLogout={() => {}} />);
    expect(screen.queryByRole("button", { name: "Statistics" })).toBeNull();
  });

  it("uses inherited RTL direction and logical row classes in the mobile drawer", () => {
    matrixState.value = DEFAULT_PAGE_VISIBILITY_MATRIX;
    render(
      <MobileDrawer
        isOpen
        currentRoute="patients"
        user={{ id: 5, username: "sa", fullName: "مستخدم", role: "super_admin" }}
        language="ar"
        isRtl
        onNavigate={() => {}}
        onClose={() => {}}
        onToggleLanguage={() => {}}
        onLogout={() => {}}
      />
    );

    const drawerPanel = screen.getByRole("dialog").querySelector('[dir="rtl"]');
    const patients = screen.getByRole("button", { name: "المرضى" });
    expect(drawerPanel?.getAttribute("dir")).toBe("rtl");
    expect(patients.className).toContain("text-start");
    expect(patients.className).not.toContain("flex-row-reverse");
    expect(patients.querySelector(".start-0")).toBeTruthy();
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

  it("does not render Doctor Workspace in the sidebar for doctor users", () => {
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
    expect(screen.queryByText("Doctor workspace")).toBeNull();
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

  it("keeps the collapsed expand control fixed outside the scrolling navigation region", () => {
    matrixState.value = DEFAULT_PAGE_VISIBILITY_MATRIX;
    render(
      <SideNav
        currentRoute="dashboard"
        user={{ id: 3, username: "tech", fullName: "Tech", role: "modality_staff" }}
        language="en"
        isRtl={false}
        collapsed
        onToggleCollapsed={() => {}}
        onNavigate={() => {}}
      />
    );

    const control = screen.getByRole("button", { name: "Expand navigation" });
    expect(control.getAttribute("aria-expanded")).toBe("false");
    expect(control.closest("nav")?.querySelector("#desktop-sidebar-navigation")?.contains(control)).toBe(false);
    expect(control.parentElement?.className).toContain("justify-end");
  });

  it("opens a delayed fine-pointer preview without changing the persisted collapse state", () => {
    vi.useFakeTimers();
    mockPointerMode(true);
    const onToggleCollapsed = vi.fn();
    render(
      <SideNav
        currentRoute="pacs.remap"
        user={{ id: 5, username: "sa", fullName: "Super", role: "super_admin" }}
        language="en"
        isRtl={false}
        collapsed
        onToggleCollapsed={onToggleCollapsed}
        onNavigate={() => {}}
      />
    );

    const rail = screen.getByTestId("desktop-sidebar-rail");
    fireEvent.mouseEnter(rail);
    act(() => vi.advanceTimersByTime(249));
    expect(screen.queryByTestId("desktop-sidebar-preview")).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId("desktop-sidebar-preview")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Menu" }).className).toContain("motion-reduce:transition-none");
    expect(screen.getByTestId("desktop-sidebar-preview").className).toContain("start-full");
    expect(screen.getByTestId("desktop-sidebar-preview").className).toContain("motion-reduce:transition-none");
    expect(screen.getAllByText("PACS remap").length).toBeGreaterThanOrEqual(2);
    expect(onToggleCollapsed).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("does not flicker on incidental hover and closes after leaving the rail", () => {
    vi.useFakeTimers();
    mockPointerMode(true);
    render(
      <SideNav
        currentRoute="dashboard"
        user={{ id: 5, username: "sa", fullName: "Super", role: "super_admin" }}
        language="en"
        isRtl={false}
        collapsed
        onToggleCollapsed={() => {}}
        onNavigate={() => {}}
      />
    );

    const rail = screen.getByTestId("desktop-sidebar-rail");
    fireEvent.mouseEnter(rail);
    fireEvent.mouseLeave(rail);
    act(() => vi.advanceTimersByTime(500));
    expect(screen.queryByTestId("desktop-sidebar-preview")).toBeNull();
    fireEvent.mouseEnter(rail);
    act(() => vi.advanceTimersByTime(250));
    const preview = screen.getByTestId("desktop-sidebar-preview");
    fireEvent.mouseLeave(rail);
    act(() => vi.advanceTimersByTime(300));
    fireEvent.mouseEnter(preview);
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByTestId("desktop-sidebar-preview")).toBeTruthy();
    fireEvent.mouseLeave(preview);
    act(() => vi.advanceTimersByTime(400));
    expect(screen.queryByTestId("desktop-sidebar-preview")).toBeNull();
    vi.useRealTimers();
  });

  it("opens the preview from keyboard focus and closes it with Escape", () => {
    mockPointerMode(false);
    render(
      <SideNav
        currentRoute="dashboard"
        user={{ id: 5, username: "sa", fullName: "Super", role: "super_admin" }}
        language="en"
        isRtl={false}
        collapsed
        onToggleCollapsed={() => {}}
        onNavigate={() => {}}
      />
    );

    fireEvent.focusIn(screen.getByRole("button", { name: "Patients" }));
    expect(screen.getByTestId("desktop-sidebar-preview")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("desktop-sidebar-preview")).toBeNull();
  });

  it("does not use hover preview for coarse pointers and mirrors the RTL rail", () => {
    vi.useFakeTimers();
    mockPointerMode(false);
    const { unmount } = render(
      <SideNav
        currentRoute="dashboard"
        user={{ id: 5, username: "sa", fullName: "Super", role: "super_admin" }}
        language="en"
        isRtl={false}
        collapsed
        onToggleCollapsed={() => {}}
        onNavigate={() => {}}
      />
    );
    fireEvent.mouseEnter(screen.getByTestId("desktop-sidebar-rail"));
    act(() => vi.advanceTimersByTime(500));
    expect(screen.queryByTestId("desktop-sidebar-preview")).toBeNull();
    unmount();
    mockPointerMode(true);
    render(
      <SideNav
        currentRoute="pacs.remap"
        user={{ id: 5, username: "sa", fullName: "مدير", role: "super_admin" }}
        language="ar"
        isRtl
        collapsed
        onToggleCollapsed={() => {}}
        onNavigate={() => {}}
      />
    );
    const rail = screen.getByTestId("desktop-sidebar-rail");
    expect(screen.getByRole("button", { name: "توسيع قائمة التنقل" }).parentElement?.className).toContain("justify-start");
    fireEvent.mouseEnter(rail);
    act(() => vi.advanceTimersByTime(250));
    expect(screen.getByTestId("desktop-sidebar-preview").className).toContain("end-full");
    vi.useRealTimers();
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
    expect(screen.queryByText("Doctor workspace")).toBeNull();
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
      incidents: [],
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

  it("renders the Request Scans needs-attention count as a red badge", () => {
    matrixState.value = DEFAULT_PAGE_VISIBILITY_MATRIX;
    recallSummaryState.value = { pendingCount: 0, unseenPendingCount: 0 };
    requestScanSummaryState.value = { needsAttentionCount: 6, latestProcessedAt: null, latestFailedAt: "2026-08-30T08:20:00.000Z" };
    render(requestScanSideNav());

    const requestScans = screen.getByRole("button", { name: "Request Scans" });
    const badge = requestScans.querySelector("span.rounded-full.bg-red-600");
    expect(badge?.textContent).toBe("6");
    expect(badge?.getAttribute("aria-label")).toBe("Request Scans: 6");
  });

  it("does not render a Request Scans badge when no jobs need attention", () => {
    matrixState.value = DEFAULT_PAGE_VISIBILITY_MATRIX;
    recallSummaryState.value = { pendingCount: 0, unseenPendingCount: 0 };
    requestScanSummaryState.value = { needsAttentionCount: 0, latestProcessedAt: null, latestFailedAt: null };
    render(requestScanSideNav());

    expect(screen.getByRole("button", { name: "Request Scans" }).querySelector("span.rounded-full.bg-red-600")).toBeNull();
  });

  it("establishes the initial Request Scans summary as a non-flashing baseline", () => {
    matrixState.value = DEFAULT_PAGE_VISIBILITY_MATRIX;
    recallSummaryState.value = { pendingCount: 0, unseenPendingCount: 0 };
    requestScanSummaryState.value = { needsAttentionCount: 3, latestProcessedAt: "2026-08-30T08:00:00.000Z", latestFailedAt: "2026-08-30T08:05:00.000Z" };
    render(requestScanSideNav());

    const requestScans = screen.getByRole("button", { name: "Request Scans" });
    expect(requestScans.getAttribute("data-event-flash")).toBeNull();
    expect(requestScans.querySelector("span.rounded-full.bg-red-600")?.textContent).toBe("3");
  });

  it("briefly flashes Request Scans green for a newly processed Reception scan", () => {
    vi.useFakeTimers();
    try {
      matrixState.value = DEFAULT_PAGE_VISIBILITY_MATRIX;
      recallSummaryState.value = { pendingCount: 0, unseenPendingCount: 0 };
      requestScanSummaryState.value = { needsAttentionCount: 0, latestProcessedAt: "2026-08-30T08:00:00.000Z", latestFailedAt: null };
      const { rerender } = render(requestScanSideNav());
      requestScanSummaryState.value = { needsAttentionCount: 0, latestProcessedAt: "2026-08-30T08:10:00.000Z", latestFailedAt: null };
      rerender(requestScanSideNav());

      expect(screen.getByRole("button", { name: "Request Scans" }).getAttribute("data-event-flash")).toBe("success");
      act(() => vi.advanceTimersByTime(2_500));
      expect(screen.getByRole("button", { name: "Request Scans" }).getAttribute("data-event-flash")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("briefly flashes Request Scans red for a newly failed Reception scan and retains its badge", () => {
    matrixState.value = DEFAULT_PAGE_VISIBILITY_MATRIX;
    recallSummaryState.value = { pendingCount: 0, unseenPendingCount: 0 };
    requestScanSummaryState.value = { needsAttentionCount: 1, latestProcessedAt: null, latestFailedAt: "2026-08-30T08:00:00.000Z" };
    const { rerender } = render(requestScanSideNav());
    requestScanSummaryState.value = { needsAttentionCount: 2, latestProcessedAt: null, latestFailedAt: "2026-08-30T08:10:00.000Z" };
    rerender(requestScanSideNav());

    const requestScans = screen.getByRole("button", { name: "Request Scans" });
    expect(requestScans.getAttribute("data-event-flash")).toBe("attention");
    expect(requestScans.querySelector("span.rounded-full.bg-red-600")?.textContent).toBe("2");
  });

  it("detects a new failed Request Scan even when the needs-attention count is unchanged", () => {
    matrixState.value = DEFAULT_PAGE_VISIBILITY_MATRIX;
    recallSummaryState.value = { pendingCount: 0, unseenPendingCount: 0 };
    requestScanSummaryState.value = { needsAttentionCount: 4, latestProcessedAt: null, latestFailedAt: "2026-08-30T08:00:00.000Z" };
    const { rerender } = render(requestScanSideNav());
    requestScanSummaryState.value = { needsAttentionCount: 4, latestProcessedAt: null, latestFailedAt: "2026-08-30T08:10:00.000Z" };
    rerender(requestScanSideNav());

    expect(screen.getByRole("button", { name: "Request Scans" }).getAttribute("data-event-flash")).toBe("attention");
  });

  it("prioritizes a Request Scans red flash when processed and failed timestamps both advance", () => {
    matrixState.value = DEFAULT_PAGE_VISIBILITY_MATRIX;
    recallSummaryState.value = { pendingCount: 0, unseenPendingCount: 0 };
    requestScanSummaryState.value = { needsAttentionCount: 1, latestProcessedAt: "2026-08-30T08:00:00.000Z", latestFailedAt: "2026-08-30T08:00:00.000Z" };
    const { rerender } = render(requestScanSideNav());
    requestScanSummaryState.value = { needsAttentionCount: 2, latestProcessedAt: "2026-08-30T08:10:00.000Z", latestFailedAt: "2026-08-30T08:10:00.000Z" };
    rerender(requestScanSideNav());

    expect(screen.getByRole("button", { name: "Request Scans" }).getAttribute("data-event-flash")).toBe("attention");
  });

  it("keeps Additional Imaging navigation badges and attentionPulse available", () => {
    matrixState.value = DEFAULT_PAGE_VISIBILITY_MATRIX;
    recallSummaryState.value = { pendingCount: 2, unseenPendingCount: 1 };
    requestScanSummaryState.value = undefined;
    render(requestScanSideNav());

    const additionalImaging = screen.getByRole("button", { name: "Additional Imaging Requests" });
    expect(additionalImaging.getAttribute("data-attention-pulse")).toBe("true");
    expect(additionalImaging.querySelector("span.rounded-full.bg-red-600")?.textContent).toBe("2");
    expect(screen.getByText("+")).toBeTruthy();
  });

  it("shows a persistent operational attention indicator independently of the booking badge", () => {
    matrixState.value = DEFAULT_PAGE_VISIBILITY_MATRIX;
    recallSummaryState.value = { pendingCount: 0, unseenPendingCount: 0, dueTodayCount: 0, overdueCount: 2, followUpDueCount: 1 };
    requestScanSummaryState.value = undefined;
    render(requestScanSideNav());

    const additionalImaging = screen.getByRole("button", { name: "Additional Imaging Requests" });
    expect(screen.getByLabelText("2 overdue · 1 follow-up due").textContent).toBe("!");
    expect(additionalImaging.getAttribute("data-attention-pulse")).toBe("false");
    expect(additionalImaging.querySelector("span.rounded-full.bg-red-600")).toBeNull();
  });

  it("renders the same Request Scans badge in the MobileDrawer", () => {
    matrixState.value = DEFAULT_PAGE_VISIBILITY_MATRIX;
    recallSummaryState.value = { pendingCount: 0, unseenPendingCount: 0 };
    requestScanSummaryState.value = { needsAttentionCount: 6, latestProcessedAt: null, latestFailedAt: null };
    render(<MobileDrawer isOpen currentRoute="dashboard" user={{ id: 1, username: "rec", fullName: "Reception", role: "receptionist" }} language="en" isRtl={false} onNavigate={() => {}} onClose={() => {}} onToggleLanguage={() => {}} onLogout={() => {}} />);

    expect(screen.getByRole("button", { name: "Request Scans" }).querySelector("span.rounded-full.bg-red-600")?.textContent).toBe("6");
  });

  it("mirrors active accent and collapse edge in RTL", () => {
    matrixState.value = DEFAULT_PAGE_VISIBILITY_MATRIX;
    render(<SideNav currentRoute="pacs.remap" user={{ id: 5, username: "sa", fullName: "Super", role: "super_admin" }} language="ar" isRtl collapsed={false} onToggleCollapsed={() => {}} onNavigate={() => {}} />);
    const active = screen.getByRole("button", { name: "إعادة ربط PACS" });
    expect(active.querySelector("[aria-hidden='true']")?.className).toContain("start-0");
    expect(screen.getByRole("button", { name: "طي قائمة التنقل" })).toBeTruthy();
    expect(screen.getByText("سير العمل السريري")).toBeTruthy();
  });
});
