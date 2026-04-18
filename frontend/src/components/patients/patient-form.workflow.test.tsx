import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PatientForm from "@/components/patients/patient-form";
import { LanguageProvider } from "@/providers/language-provider";
import type { Patient } from "@/types/api";
import {
  createPatient,
  searchPatients,
  fetchNameDictionary,
  upsertNameDictionaryEntry,
  fetchPatientById,
  updatePatient,
  deletePatient
} from "@/lib/api-hooks";

vi.mock("@/lib/api-hooks", () => ({
  createPatient: vi.fn(),
  searchPatients: vi.fn(),
  fetchNameDictionary: vi.fn(),
  upsertNameDictionaryEntry: vi.fn(),
  fetchPatientById: vi.fn(),
  updatePatient: vi.fn(),
  deletePatient: vi.fn()
}));

function makePatient(overrides: Partial<Patient> = {}): Patient {
  return {
    id: 99,
    mrn: "MRN-99",
    nationalId: "123456789012",
    identifierType: "national_id",
    identifierValue: "123456789012",
    arabicFullName: "محمد علي حسن",
    englishFullName: "Mohamed Ali Hassan",
    ageYears: 30,
    demographicsEstimated: false,
    estimatedDateOfBirth: "1995-01-01",
    sex: "M",
    phone1: "0912345678",
    phone2: null,
    address: "benghazi",
    ...overrides
  };
}

function renderPatientForm(props: { mode: "create" | "edit"; patientId?: number }) {
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
          <PatientForm {...props} />
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>
  );
}

describe("PatientForm workflow hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("rispro-language", "en");
    vi.mocked(fetchNameDictionary).mockResolvedValue({ entries: [] } as any);
    vi.mocked(searchPatients).mockResolvedValue([]);
    vi.mocked(upsertNameDictionaryEntry).mockResolvedValue({ entry: { arabic_text: "محمد", english_text: "Mohamed" } } as any);
    vi.mocked(createPatient).mockResolvedValue(makePatient({ id: 100, arabicFullName: "مريض جديد", mrn: "MRN-100" }));
    vi.mocked(fetchPatientById).mockResolvedValue(makePatient({ id: 9, demographicsEstimated: true }));
    vi.mocked(updatePatient).mockResolvedValue(makePatient({ id: 9, demographicsEstimated: false }));
    vi.mocked(deletePatient).mockResolvedValue({ ok: true });
  });

  it("shows post-success modal with 3 actions after create", async () => {
    const user = userEvent.setup();
    renderPatientForm({ mode: "create" });

    await user.type(screen.getByLabelText(/Arabic Full Name/i), "مريض جديد");
    await user.selectOptions(screen.getByLabelText(/Sex/i), "M");
    await user.type(screen.getByLabelText(/Age \(years\)/i), "30");
    await user.type(screen.getByLabelText(/Phone 1/i), "0912345678");
    await user.click(screen.getByRole("button", { name: /Register Patient/i }));

    await waitFor(() => expect(screen.getByRole("heading", { name: /^Patient registered$/i })).toBeTruthy());
    expect(screen.getByRole("button", { name: /Create appointment for this patient/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Register another patient/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Close$/i })).toBeTruthy();
  });

  it("renders possible matches panel states and displays matches", async () => {
    const user = userEvent.setup();
    vi.mocked(searchPatients).mockResolvedValue([makePatient({ id: 77, arabicFullName: "مريض مطابق" })]);
    renderPatientForm({ mode: "create" });

    expect(screen.getByText(/Type at least 2 characters/i)).toBeTruthy();

    await user.type(screen.getByLabelText(/Phone 1/i), "09");

    await waitFor(() => expect(screen.getByText("مريض مطابق")).toBeTruthy());
  });

  it("blocks submit for missing sex, then missing DOB/age", async () => {
    const user = userEvent.setup();
    renderPatientForm({ mode: "create" });

    await user.type(screen.getByLabelText(/Arabic Full Name/i), "مريض");
    await user.type(screen.getByLabelText(/Phone 1/i), "0912345678");
    await user.click(screen.getByRole("button", { name: /Register Patient/i }));
    expect(await screen.findByText(/Sex is required/i)).toBeTruthy();

    await user.selectOptions(screen.getByLabelText(/Sex/i), "M");
    await user.click(screen.getByRole("button", { name: /Register Patient/i }));
    expect(await screen.findByText(/either Date of Birth or Age/i)).toBeTruthy();
  });

  it("uses Enter for sequential navigation and does not submit early", async () => {
    const user = userEvent.setup();
    renderPatientForm({ mode: "create" });

    const arabicInput = screen.getByLabelText(/Arabic Full Name/i);
    const englishInput = screen.getByLabelText(/English Full Name/i);
    arabicInput.focus();
    await user.keyboard("{Enter}");

    expect(document.activeElement).toBe(englishInput);
    expect(createPatient).not.toHaveBeenCalled();
  });

  it("enforces phone cap, uppercases passport id, and submits estimated flag", async () => {
    const user = userEvent.setup();
    renderPatientForm({ mode: "create" });

    await user.selectOptions(screen.getByLabelText(/Identifier Type/i), "passport");
    const passportInput = screen.getByLabelText(/Passport Number/i) as HTMLInputElement;
    await user.type(passportInput, "ab12cd");
    expect(passportInput.value).toBe("AB12CD");

    const phoneInput = screen.getByLabelText(/Phone 1/i) as HTMLInputElement;
    await user.type(phoneInput, "09123ab456789");
    expect(phoneInput.value).toBe("0912345678");

    await user.type(screen.getByLabelText(/Arabic Full Name/i), "مريض جديد");
    await user.selectOptions(screen.getByLabelText(/Sex/i), "M");
    await user.type(screen.getByLabelText(/Age \(years\)/i), "34");
    await user.click(screen.getByLabelText(/Estimated \(uncertain DOB\/age\)/i));
    await user.click(screen.getByRole("button", { name: /Register Patient/i }));

    await waitFor(() => expect(createPatient).toHaveBeenCalled());
    const payload = vi.mocked(createPatient).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.identifierValue).toBe("AB12CD");
    expect(payload.phone1).toBe("0912345678");
    expect(payload.demographicsEstimated).toBe(true);
  });

  it("allows editing estimated flag later in edit mode", async () => {
    const user = userEvent.setup();
    renderPatientForm({ mode: "edit", patientId: 9 });

    await waitFor(() => expect(screen.getByLabelText(/Estimated \(uncertain DOB\/age\)/i)).toBeTruthy());
    const estimated = screen.getByLabelText(/Estimated \(uncertain DOB\/age\)/i) as HTMLInputElement;
    expect(estimated.checked).toBe(true);

    await user.click(estimated);
    await user.click(screen.getByRole("button", { name: /Update Patient/i }));

    await waitFor(() => expect(updatePatient).toHaveBeenCalled());
    const updatePayload = vi.mocked(updatePatient).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(updatePayload.demographicsEstimated).toBe(false);
  });

  it("submits identifierType/identifierValue from the selected primary identifier row", async () => {
    const user = userEvent.setup();
    renderPatientForm({ mode: "create" });

    await user.selectOptions(screen.getByLabelText(/Identifier Type/i), "passport");
    await user.type(screen.getByLabelText(/Passport Number/i), "FIRST123");

    await user.click(screen.getByRole("button", { name: /Add identifier/i }));
    const identifierInputs = screen.getAllByPlaceholderText(/Identifier value/i) as HTMLInputElement[];
    await user.type(identifierInputs[1]!, "SECONDARY-PRIMARY");

    const primaryRadios = screen.getAllByLabelText(/Primary/i) as HTMLInputElement[];
    await user.click(primaryRadios[1]!);

    await user.type(screen.getByLabelText(/Arabic Full Name/i), "مريض جديد");
    await user.selectOptions(screen.getByLabelText(/Sex/i), "M");
    await user.type(screen.getByLabelText(/Age \(years\)/i), "30");
    await user.type(screen.getByLabelText(/Phone 1/i), "0912345678");
    await user.click(screen.getByRole("button", { name: /Register Patient/i }));

    await waitFor(() => expect(createPatient).toHaveBeenCalled());
    const payload = vi.mocked(createPatient).mock.calls[0]?.[0] as Record<string, any>;
    expect(payload.identifierType).toBe("other");
    expect(payload.identifierValue).toBe("SECONDARY-PRIMARY");
    expect(payload.identifiers.find((x: any) => x.isPrimary)?.value).toBe("SECONDARY-PRIMARY");
  });
});
