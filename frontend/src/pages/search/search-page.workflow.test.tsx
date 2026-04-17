import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SearchPage from "@/pages/search/search-page";
import { LanguageProvider } from "@/providers/language-provider";
import type { Patient } from "@/types/api";
import { searchPatients, updatePatient, deletePatient } from "@/lib/api-hooks";

vi.mock("@/lib/api-hooks", () => ({
  searchPatients: vi.fn(),
  updatePatient: vi.fn(),
  deletePatient: vi.fn()
}));

function makePatient(overrides: Partial<Patient> = {}): Patient {
  return {
    id: 9,
    mrn: "MRN-9",
    nationalId: "123456789012",
    identifierType: "national_id",
    identifierValue: "123456789012",
    arabicFullName: "محمد علي حسن",
    englishFullName: "Mohamed Ali Hassan",
    ageYears: 31,
    demographicsEstimated: true,
    estimatedDateOfBirth: "1994-01-01",
    sex: "M",
    phone1: "0912345678",
    phone2: null,
    address: "benghazi",
    ...overrides
  };
}

function renderSearchPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <MemoryRouter>
          <SearchPage />
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>
  );
}

describe("Search page secondary patient edit hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("rispro-language", "en");
    vi.mocked(searchPatients).mockResolvedValue([makePatient()]);
    vi.mocked(updatePatient).mockImplementation(async (_id, payload) => makePatient(payload));
    vi.mocked(deletePatient).mockResolvedValue({ ok: true });
  });

  it("enforces required fields, caps phone at 10 digits, and allows editing Estimated flag", async () => {
    const user = userEvent.setup();
    renderSearchPage();

    await user.type(screen.getByPlaceholderText(/Search by Name/i), "محمد");
    await user.click(screen.getByRole("button", { name: /Search/i }));

    const patientName = await screen.findByText("محمد علي حسن");
    const patientRowButton = patientName.closest("button");
    expect(patientRowButton).toBeTruthy();
    await user.click(patientRowButton as HTMLButtonElement);
    await user.click(screen.getByRole("button", { name: /Edit/i }));

    const estimatedCheckbox = await screen.findByLabelText(/Estimated \(uncertain DOB\/age\)/i);
    expect((estimatedCheckbox as HTMLInputElement).checked).toBe(true);
    await user.click(estimatedCheckbox);

    const sexSelect = screen.getByLabelText(/^Sex$/i) as HTMLSelectElement;
    expect(sexSelect.hasAttribute("required")).toBe(true);
    await user.clear(screen.getByLabelText(/^Age$/i));
    await user.clear(screen.getByLabelText(/DOB \(dd\/mm\/yyyy\)/i, { selector: "input[type='text']" }));
    await user.click(screen.getByRole("button", { name: /Save/i }));
    expect(await screen.findByText(/either Date of Birth or Age/i)).toBeTruthy();
    expect(updatePatient).not.toHaveBeenCalled();

    const phoneInput = screen.getByLabelText(/^Phone$/i) as HTMLInputElement;
    await user.clear(phoneInput);
    await user.type(phoneInput, "09123ab456789");
    expect(phoneInput.value).toBe("0912345678");

    await user.type(screen.getByLabelText(/^Age$/i), "35");
    await user.click(screen.getByRole("button", { name: /Save/i }));

    await waitFor(() => expect(updatePatient).toHaveBeenCalled());
    const payload = vi.mocked(updatePatient).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload.demographicsEstimated).toBe(false);
    expect(payload.phone1).toBe("0912345678");
  });
});
