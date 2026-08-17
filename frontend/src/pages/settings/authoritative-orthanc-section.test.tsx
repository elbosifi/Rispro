import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AuthoritativeOrthancSection from "./authoritative-orthanc-section";
import { api } from "@/lib/api-client";

vi.mock("@/lib/api-client", () => ({ api: vi.fn() }));
const settings = { enabled: true, autoExportClinicalDocuments: true, autoRouteEnabled: false, autoRouteDestinationKey: "", autoRouteDestinationKeys: [] as string[], baseUrl: "http://orthanc:8042", username: "rispro", timeoutSeconds: 10, verifyTls: true, displayName: "Primary", passwordConfigured: true };
const modalities = [{ key: "PACS_A", aet: "PACS_AE", host: "10.0.0.10", port: 104, isDefault: true }, { key: "PACS_B", aet: "PACS_B", host: "10.0.0.11", port: 11112, isDefault: false }];
function renderSection(onReAuthRequired = vi.fn()) { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AuthoritativeOrthancSection onReAuthRequired={onReAuthRequired} /></QueryClientProvider>); }

describe("AuthoritativeOrthancSection", () => {
  it("links configuration to the dedicated Operations page", async () => {
    renderSection();
    const link = await screen.findByRole("link", { name: "Open Authoritative Orthanc Operations" });
    expect(link.getAttribute("href")).toBe("/systems/authoritative-orthanc");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api).mockImplementation(async (path: string, options?: RequestInit) => {
      if (path.endsWith("/settings") && !options?.method) return { settings };
      if (path.endsWith("/settings") && options?.method === "PUT") return { settings };
      if (path.endsWith("/pacs/orthanc-modalities")) return { modalities };
      if (path.endsWith("/test")) return { connected: true, system: { name: "Authoritative", version: "1.12.4", apiVersion: "19" }, testedAt: "2026-07-27T10:00:00.000Z" };
      if (path.includes("patient-identity-reconciliations")) return {jobs:[{id:1,requested_at:"2026-08-18T10:00:00Z",study_date:"20240102",accession_number:"ACC-1",study_instance_uid:"1.2.3",old_patient_id:"OLD",new_patient_id:"NEW",operator_name:"Supervisor",operation_type:"reconcile",status:"completed",failure_code:null,reversed_by_job_id:null}],total:1};
      throw new Error(`Unexpected ${path}`);
    });
  });

  it("shows reconciliation history and exposes reversal only for effective completed jobs",async()=>{const user=userEvent.setup();renderSection();await user.click(await screen.findByRole("button",{name:"Patient Identity Reconciliation"}));expect(await screen.findByText("ACC-1")).toBeTruthy();await user.click(screen.getByRole("button",{name:"Reverse"}));expect(screen.getByRole("dialog").textContent).toContain("current Patient ID NEW back to OLD");});

  it("sends reconciliation history search to the bounded admin endpoint",async()=>{const user=userEvent.setup();renderSection();await user.click(await screen.findByRole("button",{name:"Patient Identity Reconciliation"}));await user.type(await screen.findByRole("textbox",{name:"Search reconciliation history"}),"OLD-9");await waitFor(()=>expect(vi.mocked(api).mock.calls.some(([path])=>String(path).includes("search=OLD-9")&&String(path).includes("limit=50"))).toBe(true));});

  it("does not expose reversal for pending, failed, reversed, or manual-review jobs", async () => {
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path.endsWith("/settings")) return { settings };
      if (path.endsWith("/pacs/orthanc-modalities")) return { modalities };
      if (path.includes("patient-identity-reconciliations")) return {jobs:[
        {id:1,requested_at:"2026-08-18T10:00:00Z",study_date:null,accession_number:"PENDING",study_instance_uid:"1.pending",old_patient_id:"OLD-1",new_patient_id:"NEW",operator_name:"Supervisor",operation_type:"reconcile",status:"processing",failure_code:null,reversed_by_job_id:null},
        {id:2,requested_at:"2026-08-18T10:01:00Z",study_date:null,accession_number:"FAILED",study_instance_uid:"1.failed",old_patient_id:"OLD-2",new_patient_id:"NEW",operator_name:"Supervisor",operation_type:"reverse",status:"failed",failure_code:"PATIENT_IDENTITY_RECONCILIATION_MANUAL_REVIEW_REQUIRED",reversed_by_job_id:null},
        {id:3,requested_at:"2026-08-18T10:02:00Z",study_date:null,accession_number:"REVERSED",study_instance_uid:"1.reversed",old_patient_id:"OLD-3",new_patient_id:"NEW",operator_name:"Supervisor",operation_type:"reconcile",status:"completed",failure_code:null,reversed_by_job_id:4},
      ],total:3};
      throw new Error(`Unexpected ${path}`);
    });
    const user=userEvent.setup();renderSection();await user.click(await screen.findByRole("button",{name:"Patient Identity Reconciliation"}));
    expect(await screen.findByText("Manual review required")).toBeTruthy();
    expect(screen.queryByRole("button",{name:"Reverse"})).toBeNull();
  });

  it("submits a confirmed reversal and refreshes reconciliation history", async () => {
    const user=userEvent.setup();renderSection();await user.click(await screen.findByRole("button",{name:"Patient Identity Reconciliation"}));
    await user.click(await screen.findByRole("button",{name:"Reverse"}));
    await user.click(within(screen.getByRole("dialog")).getByRole("button",{name:"Reverse reconciliation"}));
    await waitFor(()=>expect(vi.mocked(api)).toHaveBeenCalledWith("/integrations/authoritative-orthanc/operations/patient-identity-reconciliations/1/reverse",{method:"POST"}));
    await waitFor(()=>expect(vi.mocked(api).mock.calls.filter(([path])=>String(path).includes("patient-identity-reconciliations")).length).toBeGreaterThanOrEqual(3));
  });

  it("saves the automatic PACS export setting and retains it while the connection is disabled", async () => {
    const user = userEvent.setup(); renderSection();
    const autoExport = await screen.findByRole("checkbox", { name: "Automatically send approved scanned documents to PACS" });
    expect((autoExport as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByRole("checkbox", { name: "Enable Orthanc connection" }));
    expect((autoExport as HTMLInputElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Save" }));
    const saveCall = await waitFor(() => vi.mocked(api).mock.calls.find(([path, options]) => path.endsWith("/settings") && options?.method === "PUT"));
    expect(JSON.parse(String(saveCall?.[1]?.body))).toEqual(expect.objectContaining({ enabled: false, autoExportClinicalDocuments: true }));
  });

  it("renders safe settings, retains an empty password field, and shows compact connection details", async () => {
    const user = userEvent.setup(); renderSection();
    expect(await screen.findByText("Authoritative Orthanc")).toBeTruthy();
    expect(screen.getByText(/export approved scanned clinical documents as DICOM Secondary Capture series/i)).toBeTruthy();
    expect(screen.getByText(/does not upload original modality images or create a replacement study/i)).toBeTruthy();
    expect(screen.queryByText(/Read-only connection foundation/i)).toBeNull();
    expect((screen.getByPlaceholderText("Configured - leave empty to retain") as HTMLInputElement).value).toBe("");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(vi.mocked(api)).toHaveBeenCalledWith("/integrations/authoritative-orthanc/settings", expect.objectContaining({ method: "PUT" })));
    expect(JSON.stringify(vi.mocked(api).mock.calls)).not.toContain("secret");
    await user.click(screen.getByRole("button", { name: "Test Connection" }));
    expect((await screen.findByRole("status")).textContent).toContain("Authoritative");
    expect(screen.getByRole("status").textContent).toContain("1.12.4");
  });

  it("enables stable-series routing and adds multiple existing PACS destinations", async () => {
    const user = userEvent.setup(); renderSection();
    const destination = await screen.findByRole("combobox", { name: "Add auto-routing destination" });
    expect((destination as HTMLSelectElement).disabled).toBe(true);
    await user.click(screen.getByRole("checkbox", { name: "Enable stable-series auto-routing" }));
    expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
    await user.selectOptions(destination, "PACS_A");
    await user.click(screen.getByRole("button", { name: "Add destination" }));
    await user.selectOptions(destination, "PACS_B");
    await user.click(screen.getByRole("button", { name: "Add destination" }));
    expect(screen.getByRole("list", { name: "Selected auto-routing destinations" }).textContent).toContain("PACS_A");
    expect(screen.getByRole("list", { name: "Selected auto-routing destinations" }).textContent).toContain("PACS_B");
    await user.click(screen.getByRole("button", { name: "Save" }));
    const saveCall = await waitFor(() => vi.mocked(api).mock.calls.find(([path, options]) => path.endsWith("/settings") && options?.method === "PUT"));
    expect(JSON.parse(String(saveCall?.[1]?.body))).toEqual(expect.objectContaining({ autoRouteEnabled: true, autoRouteDestinationKey: "PACS_A", autoRouteDestinationKeys: ["PACS_A", "PACS_B"] }));
  });

  it("offers the existing supervisor re-authentication flow when PACS destinations are protected", async () => {
    const onReAuthRequired = vi.fn();
    vi.mocked(api).mockImplementation(async (path: string, options?: RequestInit) => {
      if (path.endsWith("/settings") && !options?.method) return { settings };
      if (path.endsWith("/pacs/orthanc-modalities")) throw new Error("Recent supervisor re-authentication is required.");
      throw new Error(`Unexpected ${path}`);
    });
    const user = userEvent.setup(); renderSection(onReAuthRequired);
    await user.click(await screen.findByRole("button", { name: "Re-authenticate" }));
    expect(onReAuthRequired).toHaveBeenCalledWith(["pacs", "orthanc-modalities"]);
  });
});
