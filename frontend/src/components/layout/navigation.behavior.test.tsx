import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PageAccessRoute } from "@/components/auth/page-access-route";
import { NAV_ITEMS, SideNav, TopBar } from "./navigation";
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

    await userEvent.click(screen.getByText("Create appointment"));
    expect(onNavigate).toHaveBeenCalledWith("appointments");
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
      expect(screen.queryByText("Override Requests")).not.toBeNull();
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
      expect(screen.queryByText("Override Requests")).toBeNull();
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
    expect(screen.queryByText("Override Requests")).not.toBeNull();
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

    expect(screen.queryByText("Doctor home")).toBeNull();
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
    expect(screen.queryByText("Doctor home")).not.toBeNull();
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

    await userEvent.click(screen.getByRole("button", { name: /Toggle navigation/i }));
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

    await userEvent.click(screen.getByRole("button", { name: /Toggle navigation/i }));
    expect(onToggleCollapsed).toHaveBeenCalledTimes(2);
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

    expect(screen.queryByText("Register patient")).not.toBeNull();
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

    expect(screen.queryByText("Register patient")).toBeNull();
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
    expect(screen.queryByText("Doctor home")).toBeNull();
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
    expect(screen.queryByText("Doctor home")).not.toBeNull();
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
});
