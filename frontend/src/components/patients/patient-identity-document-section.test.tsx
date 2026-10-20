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

function renderSection(patientId = 7) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <PatientIdentityDocumentSection patientId={patientId} />
      </LanguageProvider>
    </QueryClientProvider>,
  );
  return { ...rendered, queryClient };
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

  it("confirmation resets when a newer identity document is loaded", async () => {
    fetchState
      .mockResolvedValueOnce({
        status: "pending",
        document: {
          id: 9,
          originalFilename: "national-id-9.pdf",
          mimeType: "application/pdf",
          uploadedAt: "2026-10-19T10:00:00.000Z",
          verifiedAt: null,
          verifiedByUserId: null,
          verifiedByName: null,
        },
      })
      .mockResolvedValueOnce({
        status: "pending",
        document: {
          id: 10,
          originalFilename: "national-id-10.pdf",
          mimeType: "application/pdf",
          uploadedAt: "2026-10-19T10:01:00.000Z",
          verifiedAt: null,
          verifiedByUserId: null,
          verifiedByName: null,
        },
      });

    const { queryClient } = renderSection(7);
    const verifyButton = await screen.findByRole("button", { name: "Verify Identity" });
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;

    fireEvent.click(checkbox);
    expect(verifyButton.hasAttribute("disabled")).toBe(false);

    await queryClient.invalidateQueries({ queryKey: ["patient-identity-document", 7] });
    await screen.findByText("national-id-10.pdf");

    await waitFor(() => {
      expect(checkbox.checked).toBe(false);
      expect(verifyButton.hasAttribute("disabled")).toBe(true);
    });

    fireEvent.click(checkbox);
    expect(verifyButton.hasAttribute("disabled")).toBe(false);
  });

  it("confirmation does not transfer between patients", async () => {
    fetchState.mockImplementation(async (patientId: number) => ({
      status: "pending",
      document: {
        id: patientId === 7 ? 9 : 11,
        originalFilename: `national-id-${patientId}.pdf`,
        mimeType: "application/pdf",
        uploadedAt: "2026-10-19T10:00:00.000Z",
        verifiedAt: null,
        verifiedByUserId: null,
        verifiedByName: null,
      },
    }));

    const rendered = renderSection(7);
    const verifyButton = await screen.findByRole("button", { name: "Verify Identity" });
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(verifyButton.hasAttribute("disabled")).toBe(false);

    rendered.rerender(
      <QueryClientProvider client={rendered.queryClient}>
        <LanguageProvider>
          <PatientIdentityDocumentSection patientId={8} />
        </LanguageProvider>
      </QueryClientProvider>,
    );

    await screen.findByText("national-id-8.pdf");
    const currentCheckbox = screen.getByRole("checkbox") as HTMLInputElement;
    const currentVerifyButton = screen.getByRole("button", { name: "Verify Identity" });
    await waitFor(() => {
      expect(currentCheckbox.checked).toBe(false);
      expect(currentVerifyButton.hasAttribute("disabled")).toBe(true);
    });
    expect(verifyDocument).not.toHaveBeenCalled();
  });

  it("invalidates appointment badge queries after verification", async () => {
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

    const { queryClient } = renderSection();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    fireEvent.click(await screen.findByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Verify Identity" }));

    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["registrations"] });
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["appointment-manage-modal"] });
    });
  });
});
