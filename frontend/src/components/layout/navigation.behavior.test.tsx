import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NAV_ITEMS, SideNav } from "./navigation";

vi.mock("lucide-react", () => {
  const Icon = () => null;
  return {
    LayoutGrid: Icon,
    Users: Icon,
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
  };
});

describe("Navigation governance", () => {
  it("does not include V3 create route in NAV_ITEMS", () => {
    expect(NAV_ITEMS.some((item) => item.route === "v3.appointments.create")).toBe(false);
  });

  it("does not render V3 create nav entry for receptionist users", () => {
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
});
