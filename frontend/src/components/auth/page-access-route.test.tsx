import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { DEFAULT_PAGE_VISIBILITY_MATRIX } from "@/lib/page-visibility";
import { PageAccessRoute } from "./page-access-route";

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

describe("PageAccessRoute", () => {
  it("renders the page when the current settings allow the user's role", () => {
    render(
      <MemoryRouter initialEntries={["/patients"]}>
        <Routes>
          <Route
            path="/patients"
            element={
              <PageAccessRoute
                routeKey="patients"
                user={{ id: 1, username: "doc", fullName: "Doctor", role: "doctor" }}
                matrix={DEFAULT_PAGE_VISIBILITY_MATRIX}
                defaultLandingPath="/doctor"
              >
                <div>Patients page</div>
              </PageAccessRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.queryByText("Patients page")).not.toBeNull();
  });

  it("redirects direct URL access when the current settings deny the user's role", () => {
    render(
      <MemoryRouter initialEntries={["/patients"]}>
        <Routes>
          <Route
            path="/patients"
            element={
              <PageAccessRoute
                routeKey="patients"
                user={{ id: 2, username: "tech", fullName: "Tech", role: "modality_staff" }}
                matrix={DEFAULT_PAGE_VISIBILITY_MATRIX}
                defaultLandingPath="/queue"
              >
                <div>Patients page</div>
              </PageAccessRoute>
            }
          />
          <Route path="/queue" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.queryByText("Patients page")).toBeNull();
    expect(screen.getByTestId("location").textContent).toBe("/queue");
  });

  it("keeps super_admin settings access even if settings is unchecked", () => {
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <Routes>
          <Route
            path="/settings"
            element={
              <PageAccessRoute
                routeKey="settings"
                user={{ id: 3, username: "sa", fullName: "Super Admin", role: "super_admin" }}
                matrix={{ ...DEFAULT_PAGE_VISIBILITY_MATRIX, settings: [] }}
                defaultLandingPath="/dashboard"
              >
                <div>Settings page</div>
              </PageAccessRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.queryByText("Settings page")).not.toBeNull();
  });
});
