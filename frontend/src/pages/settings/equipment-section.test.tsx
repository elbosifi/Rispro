import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import EquipmentSection from "./equipment-section";
import { LanguageProvider } from "@/providers/language-provider-component";

const api = vi.hoisted(() => ({ fetchEquipment: vi.fn(), fetchDicomDevices: vi.fn(), createEquipment: vi.fn(), updateEquipment: vi.fn(), deactivateEquipment: vi.fn() }));
const catalog = vi.hoisted(() => ({ fetchModalitiesSettings: vi.fn() }));
vi.mock("@/lib/api-hooks", () => api);
vi.mock("@/lib/api/catalog", () => catalog);

const activeEquipment = { id: 1, name: "MRI A", equipment_type: "MRI", modality_id: 4, modality_code: "MRI", vendor: "GE", model: "X", serial_number: "SN-1", location: "Room 1", dicom_device_id: 7, dicom_device_name: "MRI AE", field_strength: "1.5T", is_active: true };

function view(onReAuthRequired = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { onReAuthRequired, ...render(<LanguageProvider><QueryClientProvider client={client}><EquipmentSection onReAuthRequired={onReAuthRequired} /></QueryClientProvider></LanguageProvider>) };
}

function setDefaults(equipment = [activeEquipment]) {
  api.fetchEquipment.mockImplementation(async () => ({ equipment }));
  api.fetchDicomDevices.mockResolvedValue({ devices: [{ id: 7, deviceName: "MRI AE", modalityAeTitle: "MR1" }] });
  catalog.fetchModalitiesSettings.mockResolvedValue({ modalities: [{ id: 4, code: "MRI", name_en: "MRI" }, { id: 5, code: "CT", name_en: "CT" }] });
  api.createEquipment.mockResolvedValue({ equipment: activeEquipment });
  api.updateEquipment.mockResolvedValue({ equipment: activeEquipment });
  api.deactivateEquipment.mockResolvedValue({ equipment: activeEquipment });
}

afterEach(() => vi.clearAllMocks());

describe("EquipmentSection", () => {
  it("renders the equipment list and its linked registry details", async () => {
    setDefaults(); view();
    expect(await screen.findByText("MRI A")).toBeTruthy();
    expect(screen.getAllByText("MRI")).toHaveLength(2);
    for (const text of ["GE", "X", "Room 1", "MRI AE", "Active"]) expect(screen.getByText(text)).toBeTruthy();
  });

  it("creates Equipment with the selected modality and DICOM identity", async () => {
    setDefaults([]); view();
    fireEvent.click(await screen.findByText("Add Equipment"));
    fireEvent.change(screen.getByLabelText("name"), { target: { value: "CT 1" } });
    fireEvent.change(screen.getByLabelText("Equipment type"), { target: { value: "CT" } });
    fireEvent.change(screen.getByLabelText("Linked RIS modality"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("DICOM identity"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("CT slice / detector specification"), { target: { value: "128 slice" } });
    fireEvent.click(screen.getByText("Create"));
    await waitFor(() => expect(api.createEquipment).toHaveBeenCalledWith(expect.objectContaining({ name: "CT 1", equipmentType: "CT", modalityId: "5", dicomDeviceId: "7", ctSliceDetectorSpecification: "128 slice" })));
  });

  it("populates the edit form and submits the changed payload", async () => {
    setDefaults(); view();
    fireEvent.click(await screen.findByText("Edit"));
    expect((screen.getByLabelText("name") as HTMLInputElement).value).toBe("MRI A");
    expect((screen.getByLabelText("Linked RIS modality") as HTMLSelectElement).value).toBe("4");
    expect((screen.getByLabelText("DICOM identity") as HTMLSelectElement).value).toBe("7");
    fireEvent.change(screen.getByLabelText("location"), { target: { value: "Room 2" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(api.updateEquipment).toHaveBeenCalledWith(1, expect.objectContaining({ name: "MRI A", location: "Room 2", modalityId: "4", dicomDeviceId: "7" })));
  });

  it("deactivates the selected equipment record", async () => {
    setDefaults(); view();
    fireEvent.click(await screen.findByText("Deactivate"));
    await waitFor(() => expect(api.deactivateEquipment.mock.calls[0]?.[0]).toBe(1));
  });

  it("requests inactive Equipment when Show inactive is toggled", async () => {
    setDefaults(); view();
    await screen.findByText("MRI A");
    fireEvent.click(screen.getByLabelText("Show inactive"));
    await waitFor(() => expect(api.fetchEquipment).toHaveBeenLastCalledWith(true));
  });

  it("shows MRI and CT fields only for their respective equipment types", async () => {
    setDefaults([]); view();
    fireEvent.click(await screen.findByText("Add Equipment"));
    expect(screen.getByLabelText("CT slice / detector specification")).toBeTruthy();
    expect(screen.queryByLabelText("Field strength")).toBeNull();
    fireEvent.change(screen.getByLabelText("Equipment type"), { target: { value: "MRI" } });
    expect(screen.getByLabelText("Field strength")).toBeTruthy();
    expect(screen.queryByLabelText("CT slice / detector specification")).toBeNull();
    fireEvent.change(screen.getByLabelText("Equipment type"), { target: { value: "WORKSTATION" } });
    expect(screen.queryByLabelText("Field strength")).toBeNull();
    expect(screen.queryByLabelText("CT slice / detector specification")).toBeNull();
  });

  it("renders the existing re-authentication prompt and invokes its callback", async () => {
    setDefaults(); api.fetchEquipment.mockRejectedValueOnce(new Error("Recent supervisor re-authentication is required."));
    const { onReAuthRequired } = view();
    await screen.findByText("يلزم إعادة تحقق المشرف");
    fireEvent.click(screen.getByRole("button", { name: "إعادة التحقق" }));
    expect(onReAuthRequired).toHaveBeenCalledWith(["equipment"]);
  });
});
