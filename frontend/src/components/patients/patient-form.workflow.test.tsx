import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PatientForm from "@/components/patients/patient-form";
import { LanguageProvider } from "@/providers/language-provider-component";
import type { Patient } from "@/types/api";
import type { DictionaryEntry, PersistedDictionaryEntry } from "@/lib/name-generation";
import type { PatientNotAllowedNameWord } from "@/lib/api-hooks";
import {
  createPatient,
  searchPatients,
  fetchNameDictionary,
  fetchPatientNotAllowedNameWords,
  upsertNameDictionaryEntry,
  fetchPatientById,
  fetchPatientMrnPreview,
  fetchPatientIdentifierTypes,
  fetchSettings,
  updatePatient,
  deletePatient
} from "@/lib/api-hooks";

const authMock = vi.hoisted(() => ({
  user: { role: "receptionist" }
}));

vi.mock("@/lib/api-hooks", () => ({
  createPatient: vi.fn(),
  searchPatients: vi.fn(),
  fetchNameDictionary: vi.fn(),
  fetchPatientNotAllowedNameWords: vi.fn(),
  upsertNameDictionaryEntry: vi.fn(),
  fetchPatientById: vi.fn(),
  fetchPatientMrnPreview: vi.fn(),
  fetchPatientIdentifierTypes: vi.fn(),
  fetchSettings: vi.fn(),
  updatePatient: vi.fn(),
  deletePatient: vi.fn()
}));

vi.mock("@/providers/auth-provider", () => ({
  useAuth: () => ({
    user: authMock.user,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
    reAuth: vi.fn(),
    changePassword: vi.fn()
  })
}));

function makePatient(overrides: Partial<Patient> = {}): Patient {
  return {
    id: 99,
    mrn: "MRN-99",
    nationalId: "123456789012",
    identifierType: "national_id",
    identifierValue: "123456789012",
    category: "non_oncology",
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

function withPersistedDictionaryIds(response: {
  entries: Array<Pick<DictionaryEntry, "arabicText" | "englishText">>;
}): { entries: PersistedDictionaryEntry[]; meta: Record<string, unknown> } {
  return {
    entries: response.entries.map((entry, index) => ({ id: index + 1, ...entry })),
    meta: {},
  };
}

function withNotAllowedNameWordMetadata(response: {
  entries: Array<Omit<PatientNotAllowedNameWord, "createdAt" | "updatedAt">>;
}): { entries: PatientNotAllowedNameWord[]; meta: Record<string, unknown> } {
  return {
    entries: response.entries.map((entry) => ({ ...entry, createdAt: null, updatedAt: null })),
    meta: {},
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
    authMock.user = { role: "receptionist" };
    localStorage.setItem("rispro-language", "en");
    vi.mocked(fetchNameDictionary).mockResolvedValue(withPersistedDictionaryIds({
      entries: [
        { arabicText: "مريض", englishText: "Patient" },
        { arabicText: "جديد", englishText: "New" },
        { arabicText: "ثالث", englishText: "Third" },
        { arabicText: "مطابق", englishText: "Match" },
        { arabicText: "محمد", englishText: "Mohamed" },
        { arabicText: "علي", englishText: "Ali" },
        { arabicText: "حسن", englishText: "Hassan" }
      ]
    }));
    vi.mocked(fetchPatientNotAllowedNameWords).mockResolvedValue(withNotAllowedNameWordMetadata({ entries: [{ id: 1, arabicText: "عبد", normalizedArabicText: "عبد", isActive: true }] }));
    vi.mocked(searchPatients).mockResolvedValue([]);
    vi.mocked(upsertNameDictionaryEntry).mockResolvedValue({ entry: { arabic_text: "محمد", english_text: "Mohamed" } });
    vi.mocked(fetchPatientMrnPreview).mockResolvedValue({ mrn: "000123" });
    vi.mocked(fetchPatientIdentifierTypes).mockResolvedValue([]);
    vi.mocked(fetchSettings).mockResolvedValue({ national_id_required: "optional" });
    vi.mocked(createPatient).mockResolvedValue(makePatient({ id: 100, arabicFullName: "مريض جديد ثالث", mrn: "MRN-100" }));
    vi.mocked(fetchPatientById).mockResolvedValue(makePatient({ id: 9, demographicsEstimated: true }));
    vi.mocked(updatePatient).mockResolvedValue(makePatient({ id: 9, demographicsEstimated: false }));
    vi.mocked(deletePatient).mockResolvedValue({ ok: true });
  });

  it("shows post-success modal with 3 actions after create", async () => {
    const user = userEvent.setup();
    renderPatientForm({ mode: "create" });

    await user.type(screen.getByLabelText(/Arabic Full Name/i), "مريض جديد ثالث");
    await user.selectOptions(screen.getByLabelText(/Patient Category/i), "oncology");
    await user.selectOptions(screen.getByLabelText(/Sex/i), "M");
    await user.type(screen.getByLabelText(/Age \(years\)/i), "30");
    await user.type(screen.getByLabelText(/Phone 1/i), "0912345678");
    await user.click(screen.getByRole("button", { name: /Register Patient/i }));

    await waitFor(() => expect(screen.getByRole("heading", { name: /^Patient registered$/i })).toBeTruthy());
    expect(screen.getByRole("button", { name: /Create appointment for this patient/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Register another patient/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Close$/i })).toBeTruthy();
  });

  it("hides the large possible matches panel until candidates exist", async () => {
    const user = userEvent.setup();
    renderPatientForm({ mode: "create" });

    expect(screen.queryByText(/Possible Duplicates/i)).toBeNull();

    await user.type(screen.getByLabelText(/Phone 1/i), "09");

    await waitFor(() => expect(screen.getByText(/No possible matches found/i)).toBeTruthy());
    expect(screen.queryByText(/Possible Duplicates/i)).toBeNull();
  });

  it("displays possible duplicate candidates when matches exist", async () => {
    const user = userEvent.setup();
    vi.mocked(searchPatients).mockResolvedValue([makePatient({ id: 77, arabicFullName: "مريض مطابق" })]);
    renderPatientForm({ mode: "create" });

    expect(screen.queryByText(/Possible Duplicates/i)).toBeNull();

    await user.type(screen.getByLabelText(/Phone 1/i), "09");

    await waitFor(() => expect(screen.getByText(/Possible Duplicates/i)).toBeTruthy());
    await waitFor(() => expect(screen.getByText("مريض مطابق")).toBeTruthy());
  });

  it("shows a read-only auto-generated MRN preview on create", async () => {
    renderPatientForm({ mode: "create" });

    expect(await screen.findByText(/Auto-generated MRN:/i)).toBeTruthy();
    expect(await screen.findByText("000123")).toBeTruthy();
  });

  it("blocks submit for missing sex, then missing DOB/age", async () => {
    const user = userEvent.setup();
    renderPatientForm({ mode: "create" });

    await user.type(screen.getByLabelText(/Arabic Full Name/i), "مريض جديد ثالث");
    await user.type(screen.getByLabelText(/Phone 1/i), "0912345678");
    await user.selectOptions(screen.getByLabelText(/Patient Category/i), "oncology");
    await user.click(screen.getByRole("button", { name: /Register Patient/i }));
    expect(await screen.findByText(/Sex is required/i)).toBeTruthy();

    await user.selectOptions(screen.getByLabelText(/Sex/i), "M");
    await user.click(screen.getByRole("button", { name: /Register Patient/i }));
    expect(await screen.findByText(/either Date of Birth or Age/i)).toBeTruthy();
  });

  it("blocks submit when Arabic full name contains a not-allowed word", async () => {
    const user = userEvent.setup();
    renderPatientForm({ mode: "create" });

    await user.type(screen.getByLabelText(/Arabic Full Name/i), "محمد عبد الله");
    await user.selectOptions(screen.getByLabelText(/Patient Category/i), "oncology");
    await user.selectOptions(screen.getByLabelText(/Sex/i), "M");
    await user.type(screen.getByLabelText(/Age \(years\)/i), "30");
    await user.type(screen.getByLabelText(/Phone 1/i), "0912345678");
    await user.click(screen.getByRole("button", { name: /Register Patient/i }));

    expect(await screen.findByText(/Arabic name contains a not-allowed word: عبد/i)).toBeTruthy();
    expect(createPatient).not.toHaveBeenCalled();
  });

  it("blocks registering when Arabic full name has fewer than 3 names", async () => {
    const user = userEvent.setup();
    renderPatientForm({ mode: "create" });

    await user.type(screen.getByLabelText(/Arabic Full Name/i), "محمد علي");
    await user.selectOptions(screen.getByLabelText(/Sex/i), "M");
    await user.type(screen.getByLabelText(/Age \(years\)/i), "28");
    await user.type(screen.getByLabelText(/Phone 1/i), "0912345678");
    await user.click(screen.getByRole("button", { name: /Register Patient/i }));

    expect(await screen.findByText(/at least 3 names before registering/i)).toBeTruthy();
    expect(createPatient).not.toHaveBeenCalled();
  });

  it("blocks registering when patient category is not selected", async () => {
    const user = userEvent.setup();
    renderPatientForm({ mode: "create" });

    await user.type(screen.getByLabelText(/Arabic Full Name/i), "محمد علي حسن");
    await user.selectOptions(screen.getByLabelText(/Sex/i), "M");
    await user.type(screen.getByLabelText(/Age \(years\)/i), "28");
    await user.type(screen.getByLabelText(/Phone 1/i), "0912345678");
    await user.click(screen.getByRole("button", { name: /Register Patient/i }));

    expect(await screen.findByText(/Patient category is required/i)).toBeTruthy();
    expect(createPatient).not.toHaveBeenCalled();
  });

  it("shows category required state and focuses category when the unset badge is clicked", async () => {
    const user = userEvent.setup();
    renderPatientForm({ mode: "create" });

    expect(screen.getByText(/Category is required/i)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Category is required/i }));

    expect(document.activeElement).toBe(screen.getByLabelText(/Patient Category/i));
  });

  it("marks frontend-enforced required fields", async () => {
    vi.mocked(fetchSettings).mockResolvedValue({ national_id_required: "required_with_confirmation" });
    renderPatientForm({ mode: "create" });

    expect(screen.getByText(/Arabic Full Name \*/i)).toBeTruthy();
    expect(await screen.findByText(/Primary identifier \*/i)).toBeTruthy();
    expect(screen.getByText(/Sex \*/i)).toBeTruthy();
    expect(screen.getByText(/Patient Category \*/i)).toBeTruthy();
    expect(screen.getByText(/Phone 1 \*/i)).toBeTruthy();
    expect(screen.getByText(/Enter date of birth or age/i)).toBeTruthy();
  });

  it("treats required_with_confirmation as requiring the primary identifier on the frontend", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchSettings).mockResolvedValue({ national_id_required: "required_with_confirmation" });
    renderPatientForm({ mode: "create" });

    await user.type(screen.getByLabelText(/Arabic Full Name/i), "مريض جديد ثالث");
    await user.selectOptions(screen.getByLabelText(/Patient Category/i), "oncology");
    await user.selectOptions(screen.getByLabelText(/Sex/i), "M");
    await user.type(screen.getByLabelText(/Age \(years\)/i), "30");
    await user.type(screen.getByLabelText(/Phone 1/i), "0912345678");
    await user.click(screen.getByRole("button", { name: /Register Patient/i }));

    expect(await screen.findByText(/Primary identifier is required/i)).toBeTruthy();
    expect(createPatient).not.toHaveBeenCalled();
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

  it("uses Enter for sequential navigation in edit mode and does not submit early", async () => {
    const user = userEvent.setup();
    renderPatientForm({ mode: "edit", patientId: 9 });

    await waitFor(() => expect(screen.getByLabelText(/Arabic Full Name/i)).toBeTruthy());
    const arabicInput = screen.getByLabelText(/Arabic Full Name/i);
    const phone2Input = screen.getByLabelText(/Phone 2/i);

    arabicInput.focus();
    await user.keyboard("{Enter}");

    expect(document.activeElement).toBe(phone2Input);
    expect(updatePatient).not.toHaveBeenCalled();
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

    await user.type(screen.getByLabelText(/Arabic Full Name/i), "مريض جديد ثالث");
    await user.selectOptions(screen.getByLabelText(/Patient Category/i), "oncology");
    await user.selectOptions(screen.getByLabelText(/Sex/i), "M");
    await user.type(screen.getByLabelText(/Age \(years\)/i), "34");
    await user.click(screen.getByLabelText(/Estimated \(uncertain DOB\/age\)/i));
    await user.click(screen.getByRole("button", { name: /Register Patient/i }));

    await waitFor(() => expect(createPatient).toHaveBeenCalled());
    const payload = vi.mocked(createPatient).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.identifierValue).toBe("AB12CD");
    expect(payload.phone1).toBe("0912345678");
    expect(payload.demographicsEstimated).toBe(true);
    expect(payload.category).toBe("oncology");
  });

  it("allows editing estimated flag later in edit mode", async () => {
    const user = userEvent.setup();
    renderPatientForm({ mode: "edit", patientId: 9 });

    await waitFor(() => expect(screen.getByLabelText(/Estimated \(uncertain DOB\/age\)/i)).toBeTruthy());
    const estimated = screen.getByLabelText(/Estimated \(uncertain DOB\/age\)/i) as HTMLInputElement;
    expect(estimated.checked).toBe(true);

    await user.click(estimated);
    await user.selectOptions(screen.getByLabelText(/Patient Category/i), "oncology");
    await user.click(screen.getByRole("button", { name: /Update Patient/i }));

    await waitFor(() => expect(updatePatient).toHaveBeenCalled());
    const updatePayload = vi.mocked(updatePatient).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(updatePayload.demographicsEstimated).toBe(false);
    expect(updatePayload.category).toBe("oncology");
  });

  it("shows delete only to super_admin in edit mode", async () => {
    renderPatientForm({ mode: "edit", patientId: 9 });

    await waitFor(() => expect(screen.getByRole("button", { name: /Update Patient/i })).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Delete Patient/i })).toBeNull();

    authMock.user = { role: "super_admin" };
    renderPatientForm({ mode: "edit", patientId: 9 });

    expect(await screen.findByRole("button", { name: /Delete Patient/i })).toBeTruthy();
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

    await user.type(screen.getByLabelText(/Arabic Full Name/i), "مريض جديد ثالث");
    await user.selectOptions(screen.getByLabelText(/Patient Category/i), "oncology");
    await user.selectOptions(screen.getByLabelText(/Sex/i), "M");
    await user.type(screen.getByLabelText(/Age \(years\)/i), "30");
    await user.type(screen.getByLabelText(/Phone 1/i), "0912345678");
    await user.click(screen.getByRole("button", { name: /Register Patient/i }));

    await waitFor(() => expect(createPatient).toHaveBeenCalled());
    const payload = vi.mocked(createPatient).mock.calls[0]?.[0];
    expect(payload?.identifierType).toBe("other");
    expect(payload?.identifierValue).toBe("SECONDARY-PRIMARY");
    expect(payload?.identifiers?.find((identifier) => identifier.isPrimary)?.value).toBe("SECONDARY-PRIMARY");
  });

  it("auto-derives sex and birth year when primary identifier is a valid national ID", async () => {
    const user = userEvent.setup();
    renderPatientForm({ mode: "create" });

    const nationalIdInput = screen.getByLabelText(/National ID/i) as HTMLInputElement;
    await user.clear(nationalIdInput);
    await user.type(nationalIdInput, "119900123456");

    await waitFor(() => {
      const sexSelect = screen.getByLabelText(/Sex/i) as HTMLSelectElement;
      expect(sexSelect.value).toBe("M");
    });

    const dobInput = screen.getByPlaceholderText(/dd\/mm\/yyyy/i) as HTMLInputElement;
    expect(dobInput.value).toBe("01/01/1990");
  });

  it("shows confirmation and visually masks the primary National ID when a valid National ID is typed manually", async () => {
    const user = userEvent.setup();
    renderPatientForm({ mode: "create" });

    const nationalIdInput = screen.getByLabelText(/National ID/i) as HTMLInputElement;
    await user.type(nationalIdInput, "119900123456");

    expect(screen.getByLabelText(/National ID Confirmation/i)).toBeTruthy();
    expect(nationalIdInput.type).toBe("text");
    expect(nationalIdInput.getAttribute("style")).toContain("color: transparent");
  });

  it("shows neither confirmation success nor mismatch text while confirmation is empty", async () => {
    const user = userEvent.setup();
    renderPatientForm({ mode: "create" });

    await user.type(screen.getByLabelText(/National ID/i), "119900123456");

    expect(screen.queryByText(/^National ID confirmed$/i)).toBeNull();
    expect(screen.queryByText(/^National ID does not match$/i)).toBeNull();
  });

  it("blocks submit when manually typed National ID confirmation mismatches", async () => {
    const user = userEvent.setup();
    renderPatientForm({ mode: "create" });

    await user.type(screen.getByLabelText(/National ID/i), "119900123456");
    await user.type(screen.getByLabelText(/National ID Confirmation/i), "119900123455");
    expect(screen.getByText(/^National ID does not match$/i)).toBeTruthy();
    await user.type(screen.getByLabelText(/Arabic Full Name/i), "مريض جديد ثالث");
    await user.selectOptions(screen.getByLabelText(/Patient Category/i), "oncology");
    await user.type(screen.getByLabelText(/Phone 1/i), "0912345678");
    await user.click(screen.getByRole("button", { name: /Register Patient/i }));

    expect(await screen.findByText(/National ID confirmation does not match/i)).toBeTruthy();
    expect(createPatient).not.toHaveBeenCalled();
  });

  it("submits when manually typed National ID confirmation matches", async () => {
    const user = userEvent.setup();
    renderPatientForm({ mode: "create" });

    await user.type(screen.getByLabelText(/National ID/i), "119900123456");
    await user.type(screen.getByLabelText(/National ID Confirmation/i), "119900123456");
    expect(screen.getByText(/^National ID confirmed$/i)).toBeTruthy();
    await user.type(screen.getByLabelText(/Arabic Full Name/i), "مريض جديد ثالث");
    await user.selectOptions(screen.getByLabelText(/Patient Category/i), "oncology");
    await user.type(screen.getByLabelText(/Phone 1/i), "0912345678");
    await user.click(screen.getByRole("button", { name: /Register Patient/i }));

    await waitFor(() => expect(createPatient).toHaveBeenCalled());
    const payload = vi.mocked(createPatient).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.nationalIdConfirmation).toBe("119900123456");
  });

  it("submits a pasted valid National ID without manual confirmation", async () => {
    const user = userEvent.setup();
    renderPatientForm({ mode: "create" });

    const nationalIdInput = screen.getByLabelText(/National ID/i) as HTMLInputElement;
    fireEvent.paste(nationalIdInput, {
      clipboardData: { getData: () => "119-900-123-456" }
    });

    expect(nationalIdInput.value).toBe("119900123456");
    expect(screen.queryByLabelText(/National ID Confirmation/i)).toBeNull();
    expect(screen.getByText(/National ID confirmed from pasted value/i)).toBeTruthy();

    await user.type(screen.getByLabelText(/Arabic Full Name/i), "مريض جديد ثالث");
    await user.selectOptions(screen.getByLabelText(/Patient Category/i), "oncology");
    await user.type(screen.getByLabelText(/Phone 1/i), "0912345678");
    await user.click(screen.getByRole("button", { name: /Register Patient/i }));

    await waitFor(() => expect(createPatient).toHaveBeenCalled());
    const payload = vi.mocked(createPatient).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.nationalIdConfirmation).toBe("119900123456");
  });

  it("requires confirmation again when a pasted National ID is manually edited", async () => {
    const user = userEvent.setup();
    renderPatientForm({ mode: "create" });

    const nationalIdInput = screen.getByLabelText(/National ID/i) as HTMLInputElement;
    fireEvent.paste(nationalIdInput, {
      clipboardData: { getData: () => "119900123456" }
    });
    await user.type(nationalIdInput, "{backspace}7");

    expect(screen.getByLabelText(/National ID Confirmation/i)).toBeTruthy();

    await user.type(screen.getByLabelText(/Arabic Full Name/i), "مريض جديد ثالث");
    await user.selectOptions(screen.getByLabelText(/Patient Category/i), "oncology");
    await user.type(screen.getByLabelText(/Phone 1/i), "0912345678");
    await user.click(screen.getByRole("button", { name: /Register Patient/i }));

    expect(await screen.findByText(/Please confirm the national ID/i)).toBeTruthy();
    expect(createPatient).not.toHaveBeenCalled();
  });

  it("still blocks paste into the National ID confirmation field", async () => {
    const user = userEvent.setup();
    renderPatientForm({ mode: "create" });

    await user.type(screen.getByLabelText(/National ID/i), "119900123456");
    const confirmationInput = screen.getByLabelText(/National ID Confirmation/i) as HTMLInputElement;
    fireEvent.paste(confirmationInput, {
      clipboardData: { getData: () => "119900123456" }
    });

    expect(confirmationInput.value).toBe("");
  });

  it("keeps confirmation tied to the selected primary National ID and clears when primary changes", async () => {
    const user = userEvent.setup();
    renderPatientForm({ mode: "create" });

    await user.click(screen.getByRole("button", { name: /Add identifier/i }));
    const identifierTypes = screen.getAllByLabelText(/Identifier Type/i) as HTMLSelectElement[];
    const nationalIdInputs = screen.getAllByLabelText(/National ID/i) as HTMLInputElement[];

    await user.type(nationalIdInputs[0]!, "119900123456");
    expect(screen.getByText(/Confirm the primary National ID above/i)).toBeTruthy();
    await user.type(screen.getByLabelText(/National ID Confirmation/i), "119900123456");
    expect(screen.getByText(/^National ID confirmed$/i)).toBeTruthy();

    await user.selectOptions(identifierTypes[1]!, "passport");
    const primaryRadios = screen.getAllByLabelText(/Primary/i) as HTMLInputElement[];
    await user.click(primaryRadios[1]!);

    expect(screen.queryByLabelText(/National ID Confirmation/i)).toBeNull();
    await user.click(primaryRadios[0]!);
    expect(screen.getByLabelText(/National ID Confirmation/i)).toBeTruthy();
    expect((screen.getByLabelText(/National ID Confirmation/i) as HTMLInputElement).value).toBe("");
  });

  it("blocks submit when auto-generated English transliteration has unresolved Arabic tokens", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchNameDictionary).mockResolvedValue(withPersistedDictionaryIds({
      entries: [
        { arabicText: "محمد", englishText: "Mohamed" },
        { arabicText: "حسن", englishText: "Hassan" }
      ]
    }));
    renderPatientForm({ mode: "create" });

    await user.type(screen.getByLabelText(/Arabic Full Name/i), "محمد زيد حسن");
    await user.tab();
    await user.selectOptions(screen.getByLabelText(/Patient Category/i), "oncology");
    await user.selectOptions(screen.getByLabelText(/Sex/i), "M");
    await user.type(screen.getByLabelText(/Age \(years\)/i), "30");
    await user.type(screen.getByLabelText(/Phone 1/i), "0912345678");
    await user.click(screen.getByRole("button", { name: /Register Patient/i }));

    expect(await screen.findByText(/Cannot use auto-generated English name/i)).toBeTruthy();
    expect(createPatient).not.toHaveBeenCalled();
  });

  it("allows save after manual English-name correction even when transliteration has unresolved tokens", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchNameDictionary).mockResolvedValue(withPersistedDictionaryIds({
      entries: [
        { arabicText: "محمد", englishText: "Mohamed" },
        { arabicText: "حسن", englishText: "Hassan" }
      ]
    }));
    renderPatientForm({ mode: "create" });

    await user.type(screen.getByLabelText(/Arabic Full Name/i), "محمد زيد حسن");
    await user.type(screen.getByLabelText(/English Full Name/i), "Mohamed Zaid Hassan");
    await user.selectOptions(screen.getByLabelText(/Patient Category/i), "oncology");
    await user.selectOptions(screen.getByLabelText(/Sex/i), "M");
    await user.type(screen.getByLabelText(/Age \(years\)/i), "30");
    await user.type(screen.getByLabelText(/Phone 1/i), "0912345678");
    await user.click(screen.getByRole("button", { name: /Register Patient/i }));

    await waitFor(() => expect(createPatient).toHaveBeenCalled());
    const payload = vi.mocked(createPatient).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.englishFullName).toBe("Mohamed Zaid Hassan");
    expect(payload.autoGenerateEnglish).toBe(false);
  });
});
