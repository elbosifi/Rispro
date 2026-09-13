import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequestIrReferralModal } from "./request-ir-referral-modal";
import { EnglishLanguageScope } from "@/providers/language-provider-component";

const api = vi.hoisted(() => ({ doctors: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/api/ir-referrals", () => ({ fetchAssignableIrDoctors: api.doctors, createIrReferral: api.create }));
vi.mock("@/lib/toast", () => ({ pushToast: vi.fn() }));

const patient = { id: 41, englishFullName: "IR Patient", arabicFullName: null, mrn: "MRN-41" } as never;
function renderModal(onCreated = vi.fn()) { const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); return render(<EnglishLanguageScope><QueryClientProvider client={client}><RequestIrReferralModal patient={patient} onClose={vi.fn()} onCreated={onCreated} /></QueryClientProvider></EnglishLanguageScope>); }

beforeEach(() => { vi.clearAllMocks(); api.doctors.mockResolvedValue([{ id: 8, displayName: "Dr IR", fullName: null, englishName: "Dr IR", username: "ir.doctor" }]); api.create.mockResolvedValue({ id: 91 }); });

describe("RequestIrReferralModal", () => {
  it("locks the selected patient, requires a procedure and IR doctor, and creates with ready-notification preference", async () => {
    const onCreated = vi.fn(); renderModal(onCreated);
    expect(screen.getByText("IR Patient")).toBeTruthy();
    const create = screen.getByRole("button", { name: "Create IR Consultation" }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    await screen.findByRole("option", { name: "Dr IR" });
    fireEvent.change(screen.getByLabelText("Assign IR doctor"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("Requested procedure / consultation reason"), { target: { value: "Biopsy consultation" } });
    expect(create.disabled).toBe(false);
    fireEvent.click(screen.getByLabelText("Notify assigned doctor when referral is ready for review"));
    fireEvent.click(create);
    await waitFor(() => expect(api.create).toHaveBeenCalledWith({ patientId: 41, requestedProcedure: "Biopsy consultation", clinicalIndication: null, assignedDoctorId: 8, notifyAssignedDoctor: false }));
    expect(onCreated).toHaveBeenCalledWith(91);
  });
});
