import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "@/providers/language-provider-component";
import { PatientIdentityDocumentSection } from "./patient-identity-document-section";

const { fetchState, verifyDocument, revokeDocument, currentUser } = vi.hoisted(() => ({
  fetchState: vi.fn(),
  verifyDocument: vi.fn(),
  revokeDocument: vi.fn(),
  currentUser: { role: "receptionist" as string },
}));

vi.mock("@/providers/auth-provider", () => ({
  useAuth: () => ({ user: currentUser }),
}));
vi.mock("@/lib/api/patient-identity-documents", () => ({
  fetchPatientIdentityDocument: fetchState,
  uploadPatientIdentityDocument: vi.fn(),
  verifyPatientIdentityDocument: verifyDocument,
  revokePatientIdentityDocument: revokeDocument,
}));
vi.mock("@/lib/toast", () => ({ pushToast: vi.fn() }));

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <PatientIdentityDocumentSection patientId={7} />
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

describe("PatientIdentityDocumentSection", () => {
  afterEach(() => {
    cleanup();
    localStorage.removeItem("rispro-language");
  });

  beforeEach(() => {
    localStorage.setItem("rispro-language", "en");
    currentUser.role = "receptionist";
    fetchState.mockReset();
    verifyDocument.mockReset();
    revokeDocument.mockReset();
  });

  it("requires the confirmation checkbox before verification", async () => {
    fetchState.mockResolvedValue({
      status: "pending",
      document: {
        id: 9,
        originalFilename: "national-id.pdf",
        mimeType: "application/pdf",
        uploadedAt: "2026-10-19T10:00:00.000Z",
        verifiedAt: null,
        verifiedByUserId: null,
        verifiedByName: null,
      },
    });
    verifyDocument.mockResolvedValue({ status: "verified", document: null });

    renderSection();
    const verifyButton = await screen.findByRole("button", { name: "Verify Identity" });
    expect(verifyButton.hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(verifyButton.hasAttribute("disabled")).toBe(false);
    fireEvent.click(verifyButton);
    await waitFor(() => expect(verifyDocument).toHaveBeenCalledWith(7, 9));
  });

  it("does not show revoke to receptionists", async () => {
    fetchState.mockResolvedValue({
      status: "verified",
      document: {
        id: 9,
        originalFilename: "national-id.pdf",
        mimeType: "application/pdf",
        uploadedAt: "2026-10-19T10:00:00.000Z",
        verifiedAt: "2026-10-19T10:05:00.000Z",
        verifiedByUserId: 3,
        verifiedByName: "Supervisor",
      },
    });

    renderSection();
    await screen.findByRole("img", { name: "Verified identity" });
    expect(screen.queryByRole("button", { name: "Revoke Verification" })).toBeNull();
  });

  it("shows revoke to supervisors", async () => {
    currentUser.role = "supervisor";
    fetchState.mockResolvedValue({
      status: "verified",
      document: {
        id: 9,
        originalFilename: "national-id.pdf",
        mimeType: "application/pdf",
        uploadedAt: "2026-10-19T10:00:00.000Z",
        verifiedAt: "2026-10-19T10:05:00.000Z",
        verifiedByUserId: 3,
        verifiedByName: "Supervisor",
      },
    });

    renderSection();
    expect(await screen.findByRole("button", { name: "Revoke Verification" })).toBeTruthy();
  });
});
