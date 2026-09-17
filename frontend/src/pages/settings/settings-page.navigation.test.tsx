import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "@/providers/language-provider-component";
import SettingsPage from "./settings-page";

let role: "supervisor" | "super_admin" = "super_admin";

vi.mock("@/providers/auth-provider", () => ({
  useAuth: () => ({ user: { id: 1, role, username: "settings-test", fullName: "Settings Test" } }),
}));

vi.mock("./sonicdicom-reports-section", () => ({ default: () => <div>SonicDICOM section content</div> }));
vi.mock("./system-diagnostics-section", () => ({ default: () => <div>System diagnostics section content</div> }));

function NavigationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="location-probe">{location.search}</output>
      <button type="button" data-testid="history-back" onClick={() => navigate(-1)}>Back</button>
      <button type="button" data-testid="history-forward" onClick={() => navigate(1)}>Forward</button>
    </>
  );
}

function renderSettings(initialEntries = ["/settings"]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <LanguageProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={initialEntries}>
          <Routes>
            <Route path="/settings" element={<><SettingsPage /><NavigationProbe /></>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </LanguageProvider>,
  );
}

describe("SettingsPage navigation", () => {
  beforeEach(() => {
    localStorage.setItem("rispro-language", "en");
    document.documentElement.lang = "en";
    document.documentElement.dir = "ltr";
  });

  it("opens the menu by default and makes selected sections URL-authoritative with browser history", async () => {
    role = "super_admin";
    const user = userEvent.setup();
    renderSettings(["/settings?source=navigation"]);

    expect(screen.getByText("Options")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /SonicDICOM Reports/ }));
    await waitFor(() => {
      expect(screen.getByText("SonicDICOM section content")).toBeTruthy();
      expect(screen.getByTestId("location-probe").textContent).toBe("?source=navigation&section=sonicdicom_reports");
    });

    await user.click(screen.getByTestId("history-back"));
    await waitFor(() => {
      expect(screen.getByText("Options")).toBeTruthy();
      expect(screen.getByTestId("location-probe").textContent).toBe("?source=navigation");
    });

    await user.click(screen.getByTestId("history-forward"));
    await waitFor(() => expect(screen.getByText("SonicDICOM section content")).toBeTruthy());
  });

  it("opens direct section links, and the in-page Back button removes only section", async () => {
    role = "super_admin";
    const user = userEvent.setup();
    renderSettings(["/settings?section=system_diagnostics&source=operations"]);

    expect(await screen.findByText("System diagnostics section content")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Back.*Settings/ }));
    await waitFor(() => {
      expect(screen.getByText("Options")).toBeTruthy();
      expect(screen.getByTestId("location-probe").textContent).toBe("?source=operations");
    });
  });

  it("sanitizes invalid and unauthorized direct section links to the Settings menu", async () => {
    role = "super_admin";
    const invalid = renderSettings(["/settings?section=not_real&source=operations"]);
    await waitFor(() => {
      expect(screen.getByText("Options")).toBeTruthy();
      expect(screen.getByTestId("location-probe").textContent).toBe("?source=operations");
    });
    invalid.unmount();

    role = "supervisor";
    renderSettings(["/settings?section=system_diagnostics&source=operations"]);
    await waitFor(() => {
      expect(screen.getByText("Options")).toBeTruthy();
      expect(screen.queryByText("System diagnostics section content")).toBeNull();
      expect(screen.getByTestId("location-probe").textContent).toBe("?source=operations");
    });
    expect(screen.queryByRole("button", { name: /System Diagnostics/ })).toBeNull();
  });
});
