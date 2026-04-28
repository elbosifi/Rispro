import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DoctorPage from "./doctor-page";
import { LanguageProvider } from "@/providers/language-provider";

const fetchAppointmentsMock = vi.fn();
const fetchAppointmentLookupsMock = vi.fn();

vi.mock("@/lib/api-hooks", () => ({
  fetchAppointments: (...args: unknown[]) => fetchAppointmentsMock(...args),
  fetchAppointmentLookups: (...args: unknown[]) => fetchAppointmentLookupsMock(...args),
}));

vi.mock("@/components/appointments/appointment-editor", () => ({
  AppointmentEditor: () => <div data-testid="appointment-editor" />,
}));

vi.mock("@/components/documents/request-documents-panel", () => ({
  RequestDocumentsPanel: () => <div data-testid="request-documents-panel" />,
}));

function PrintPlaceholder() {
  const location = useLocation();
  return <div data-testid="print-page">{`${location.pathname}${location.search}`}</div>;
}

function renderDoctorPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <LanguageProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/doctor"]}>
          <Routes>
            <Route path="/doctor" element={<DoctorPage />} />
            <Route path="/print" element={<PrintPlaceholder />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </LanguageProvider>
  );
}

describe("DoctorPage print routing", () => {
  beforeEach(() => {
    localStorage.setItem("rispro-language", "en");
    fetchAppointmentsMock.mockResolvedValue([
      {
        id: 7,
        accessionNumber: "ACC-7",
        patientId: 1,
        arabicFullName: "Test Patient",
        modalityNameEn: "CT",
        examNameEn: "CT Head",
        appointmentDate: "2027-01-03",
        status: "scheduled",
        createdAt: "2027-01-01",
        updatedAt: "2027-01-01",
        notes: null,
      },
    ]);
    fetchAppointmentLookupsMock.mockResolvedValue({
      modalities: [{ id: 1, name: "CT", nameAr: "CT", nameEn: "CT", code: "CT", isActive: true }],
    });
  });

  it("direct prints a selected appointment", async () => {
    renderDoctorPage();

    await waitFor(() => {
      expect(screen.getByText("ACC-7")).toBeTruthy();
    });

    await userEvent.click(screen.getByText("ACC-7"));
    await userEvent.click(screen.getByRole("button", { name: "Print" }));

    await waitFor(() => {
      expect(screen.getByTestId("print-page").textContent).toBe("/print?appointmentId=7&autoprint=1");
    });
  });
});
