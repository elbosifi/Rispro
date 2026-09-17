import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/shared/Button";
import { Input } from "@/components/shared/Input";
import { createEquipment, deactivateEquipment, fetchDicomDevices, fetchEquipment, saveEquipmentDicomIdentity, updateEquipment } from "@/lib/api-hooks";
import { fetchModalitiesSettings } from "@/lib/api/catalog";
import { ReAuthPrompt } from "./settings-section-helpers";

const TYPES = ["CT", "MRI", "MAMMOGRAPHY", "ULTRASOUND", "XRAY", "WORKSTATION", "PACS_IT", "INJECTOR", "PRINTER", "OTHER"];
const empty = { name: "", equipmentType: "CT", modalityId: "", vendor: "", model: "", serialNumber: "", location: "", fieldStrength: "", ctSliceDetectorSpecification: "", notes: "", isActive: true };
const emptyDicom = { deviceName: "", modalityAeTitle: "", scheduledStationAeTitle: "", stationName: "", stationLocation: "", sourceIp: "", mwlEnabled: true, isActive: true };
type Form = typeof empty;
type DicomForm = typeof emptyDicom;
type RecordValue = Record<string, unknown>;

const value = (item: RecordValue, camel: string, snake: string) => item[camel] ?? item[snake];
const asText = (value: unknown) => String(value ?? "");
function errorMessage(error: unknown) { return error instanceof Error ? error.message : "Unable to save Equipment."; }

function Field({ id, label, hint, required, children }: { id: string; label: string; hint?: string; required?: boolean; children: ReactNode }) {
  return <div className="space-y-1.5">
    <label htmlFor={id} data-required={required || undefined} className="block text-sm font-medium text-foreground">
      {label}
    </label>
    {children}
    {hint ? <p className="text-xs leading-4 text-muted-foreground">{hint}</p> : null}
  </div>;
}

export default function EquipmentSection({ onReAuthRequired }: { onReAuthRequired: (key: string[]) => void }) {
  const queryClient = useQueryClient();
  const [showInactive, setShowInactive] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [dicomForm, setDicomForm] = useState<DicomForm>({ ...emptyDicom });
  const [dicomExpanded, setDicomExpanded] = useState(false);
  const [linkId, setLinkId] = useState("");

  const equipment = useQuery({ queryKey: ["equipment", showInactive], queryFn: () => fetchEquipment(showInactive) });
  const allEquipment = useQuery({ queryKey: ["equipment", "all"], queryFn: () => fetchEquipment(true) });
  const modalities = useQuery({ queryKey: ["modalities", "equipment"], queryFn: () => fetchModalitiesSettings(false) });
  const devices = useQuery({ queryKey: ["dicom-devices"], queryFn: fetchDicomDevices });
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ["equipment"] }), queryClient.invalidateQueries({ queryKey: ["dicom-devices"] })]);
  const close = () => { setForm(null); setEditing(null); setDicomExpanded(false); setLinkId(""); };
  const save = useMutation({
    mutationFn: () => editing === null ? createEquipment(form as RecordValue) : updateEquipment(editing, form as RecordValue),
    onSuccess: ({ equipment: saved }) => {
      if (editing === null) {
        setEditing(Number(saved.id));
        setForm({ ...empty, ...saved, modalityId: asText(value(saved, "modalityId", "modality_id")), equipmentType: asText(value(saved, "equipmentType", "equipment_type")) });
      }
      refresh();
    },
  });
  const saveDicom = useMutation({ mutationFn: () => saveEquipmentDicomIdentity(editing!, dicomForm as RecordValue), onSuccess: () => { refresh(); setDicomExpanded(false); } });
  const linkDicom = useMutation({ mutationFn: () => saveEquipmentDicomIdentity(editing!, { existingDicomDeviceId: linkId }), onSuccess: () => { refresh(); setLinkId(""); } });
  const deactivate = useMutation({ mutationFn: deactivateEquipment, onSuccess: refresh });
  const errors = [equipment.error, modalities.error, devices.error, save.error, saveDicom.error, linkDicom.error].filter(Boolean);
  const reauth = errors.find((error) => error instanceof Error && (/re-authentication|403/i).test(error.message));

  if (reauth) return <ReAuthPrompt onReAuthRequired={() => onReAuthRequired(["equipment"])} />;

  const startEdit = (item: RecordValue) => {
    const identity = value(item, "dicomIdentity", "dicom_identity") as RecordValue | null;
    setEditing(Number(item.id));
    setForm({
      name: asText(item.name),
      equipmentType: asText(value(item, "equipmentType", "equipment_type")),
      modalityId: asText(value(item, "modalityId", "modality_id")),
      vendor: asText(item.vendor),
      model: asText(item.model),
      serialNumber: asText(value(item, "serialNumber", "serial_number")),
      location: asText(item.location),
      fieldStrength: asText(value(item, "fieldStrength", "field_strength")),
      ctSliceDetectorSpecification: asText(value(item, "ctSliceDetectorSpecification", "ct_slice_detector_specification")),
      notes: asText(item.notes),
      isActive: Boolean(value(item, "isActive", "is_active")),
    });
    setDicomForm(identity ? {
      deviceName: asText(identity.deviceName),
      modalityAeTitle: asText(identity.modalityAeTitle),
      scheduledStationAeTitle: asText(identity.scheduledStationAeTitle),
      stationName: asText(identity.stationName),
      stationLocation: asText(identity.stationLocation),
      sourceIp: asText(identity.sourceIp),
      mwlEnabled: Boolean(identity.mwlEnabled),
      isActive: Boolean(identity.isActive),
    } : { ...emptyDicom, deviceName: asText(item.name) });
    setDicomExpanded(Boolean(identity));
    setLinkId("");
  };

  const usedDeviceIds = new Set((allEquipment.data?.equipment ?? []).map((item) => Number(value(item, "dicomDeviceId", "dicom_device_id"))).filter(Boolean));
  const compatibleDevices = (devices.data?.devices ?? []).filter((device) => String(device.modalityId) === form?.modalityId && !usedDeviceIds.has(device.id));

  return <div className="space-y-4">
    {errors.length > 0 && !reauth ? <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{errorMessage(errors[0])}</div> : null}
    <div className="flex items-center justify-between gap-3">
      <label className="text-sm"><input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Show inactive</label>
      <Button variant="secondary" size="sm" className="text-xs" onClick={() => { setEditing(null); setForm({ ...empty }); setDicomForm({ ...emptyDicom }); setDicomExpanded(false); }}>Add Equipment</Button>
    </div>
    {form ? <div className="space-y-5 rounded-xl border border-border bg-muted/20 p-4">
      <section>
        <h4 className="mb-3 font-semibold">Equipment details</h4>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Field id="equipment-name" label="Equipment name" hint="Required. Display name used in the equipment registry." required>
            <Input id="equipment-name" placeholder="e.g. CT-1-GE" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
          </Field>
          <Field id="equipment-vendor" label="Manufacturer / Vendor" hint="The scanner manufacturer or supplier.">
            <Input id="equipment-vendor" placeholder="e.g. GE Healthcare" value={form.vendor} onChange={e => setForm({ ...form, vendor: e.target.value })} />
          </Field>
          <Field id="equipment-model" label="Model" hint="The manufacturer model name or number.">
            <Input id="equipment-model" placeholder="e.g. Revolution EVO" value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} />
          </Field>
          <Field id="equipment-serial-number" label="Serial number" hint="Scanner serial number or local asset number.">
            <Input id="equipment-serial-number" placeholder="e.g. scanner serial / asset number" value={form.serialNumber} onChange={e => setForm({ ...form, serialNumber: e.target.value })} />
          </Field>
          <Field id="equipment-location" label="Location" hint="Department, room, or other physical location.">
            <Input id="equipment-location" placeholder="e.g. Radiology Department - CT Room 1" value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} />
          </Field>
          <Field id="equipment-notes" label="Notes" hint="Optional operational or maintenance note.">
            <Input id="equipment-notes" placeholder="Optional note" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          </Field>
          <Field id="equipment-type" label="Equipment type" hint="Choose the physical equipment category.">
            <select id="equipment-type" className="input-premium" value={form.equipmentType} onChange={e => setForm({ ...form, equipmentType: e.target.value })}>{TYPES.map(t => <option key={t}>{t}</option>)}</select>
          </Field>
          <Field id="equipment-modality" label="Linked RIS modality" hint="This must match the modality used by appointments before DICOM is configured.">
            <select id="equipment-modality" className="input-premium" value={form.modalityId} onChange={e => setForm({ ...form, modalityId: e.target.value })}><option value="">No linked modality</option>{modalities.data?.modalities.map(m => <option key={m.id} value={m.id}>{m.name_en} - {m.code}</option>)}</select>
          </Field>
          {form.equipmentType === "MRI" ? <Field id="equipment-field-strength" label="Field strength" hint="For example, 1.5T or 3T.">
            <Input id="equipment-field-strength" placeholder="e.g. 1.5T" value={form.fieldStrength} onChange={e => setForm({ ...form, fieldStrength: e.target.value })} />
          </Field> : null}
          {form.equipmentType === "CT" ? <Field id="equipment-ct-specification" label="CT slice / detector specification" hint="For example, 64-slice or 128-slice.">
            <Input id="equipment-ct-specification" placeholder="e.g. 128-slice" value={form.ctSliceDetectorSpecification} onChange={e => setForm({ ...form, ctSliceDetectorSpecification: e.target.value })} />
          </Field> : null}
          <label className="flex items-center gap-2 self-end pb-1 text-sm"><input aria-label="Equipment active" type="checkbox" checked={form.isActive} onChange={e => setForm({ ...form, isActive: e.target.checked })} /> Active</label>
        </div>
        <div className="mt-4 flex gap-2"><Button disabled={!form.name.trim() || save.isPending} onClick={() => save.mutate()}>{editing === null ? "Create Equipment" : "Save Equipment"}</Button><Button variant="secondary" onClick={close}>Cancel</Button></div>
      </section>
      {editing !== null ? <section className="border-t border-border pt-5">
        <div className="flex items-center justify-between gap-3">
          <div><h4 className="font-semibold">DICOM identity</h4><p className="text-sm text-muted-foreground">{value((equipment.data?.equipment ?? []).find((item) => Number(item.id) === editing) ?? {}, "dicomDeviceId", "dicom_device_id") ? "Configured" : "Not configured"}</p></div>
          <Button variant="secondary" size="sm" onClick={() => setDicomExpanded(!dicomExpanded)}>{dicomExpanded ? "Hide DICOM identity" : "Configure DICOM"}</Button>
        </div>
        {!form.modalityId ? <p className="mt-3 text-sm text-amber-700">Select a linked RIS modality before configuring a DICOM identity.</p> : null}
        {dicomExpanded && form.modalityId ? <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Field id="dicom-device-name" label="Device name" hint="Required. Administrative display name for this scanner, e.g. CT-1-GE." required>
            <Input id="dicom-device-name" value={dicomForm.deviceName} onChange={e => setDicomForm({ ...dicomForm, deviceName: e.target.value })} required />
          </Field>
          <Field id="dicom-modality-ae-title" label="Modality AE Title" hint="Required. Exact AE Title configured on the scanner; it is saved in uppercase." required>
            <Input id="dicom-modality-ae-title" dir="ltr" value={dicomForm.modalityAeTitle} onChange={e => setDicomForm({ ...dicomForm, modalityAeTitle: e.target.value })} required />
          </Field>
          <Field id="dicom-scheduled-station-ae-title" label="Scheduled Station AE Title" hint="Used for Modality Worklist matching. Leave blank to use the Modality AE Title.">
            <Input id="dicom-scheduled-station-ae-title" dir="ltr" value={dicomForm.scheduledStationAeTitle} placeholder="Same as Modality AE Title" onChange={e => setDicomForm({ ...dicomForm, scheduledStationAeTitle: e.target.value })} />
          </Field>
          <Field id="dicom-station-name" label="Station name" hint="DICOM Station Name or scanner console name, if configured.">
            <Input id="dicom-station-name" value={dicomForm.stationName} placeholder="e.g. CT Room 1" onChange={e => setDicomForm({ ...dicomForm, stationName: e.target.value })} />
          </Field>
          <Field id="dicom-station-location" label="Station location" hint="DICOM station location or physical room label.">
            <Input id="dicom-station-location" value={dicomForm.stationLocation} placeholder="e.g. Radiology Department" onChange={e => setDicomForm({ ...dicomForm, stationLocation: e.target.value })} />
          </Field>
          <Field id="dicom-source-ip" label="Source IP" hint="Scanner IP address, if you want to record it for identification.">
            <Input id="dicom-source-ip" dir="ltr" value={dicomForm.sourceIp} placeholder="e.g. 192.168.1.50" onChange={e => setDicomForm({ ...dicomForm, sourceIp: e.target.value })} />
          </Field>
          <label className="flex items-start gap-2 self-start text-sm">
            <input type="checkbox" checked={dicomForm.mwlEnabled} onChange={e => setDicomForm({ ...dicomForm, mwlEnabled: e.target.checked })} />
            <span><span className="font-medium">MWL enabled</span><span className="mt-1 block text-xs leading-4 text-muted-foreground">Allow this scanner to receive Modality Worklist appointments.</span></span>
          </label>
          <label className="flex items-start gap-2 self-start text-sm">
            <input type="checkbox" checked={dicomForm.isActive} onChange={e => setDicomForm({ ...dicomForm, isActive: e.target.checked })} />
            <span><span className="font-medium">DICOM identity active</span><span className="mt-1 block text-xs leading-4 text-muted-foreground">Keep enabled while this scanner is in service.</span></span>
          </label>
          <div className="md:col-span-2 xl:col-span-3"><Button disabled={saveDicom.isPending || !dicomForm.deviceName || !dicomForm.modalityAeTitle} onClick={() => saveDicom.mutate()}>Save DICOM identity</Button></div>
        </div> : null}
        {!dicomExpanded && !value((equipment.data?.equipment ?? []).find((item) => Number(item.id) === editing) ?? {}, "dicomDeviceId", "dicom_device_id") && compatibleDevices.length > 0 ? <div className="mt-4 flex flex-wrap items-end gap-3">
          <Field id="link-existing-dicom" label="Existing DICOM identity" hint="Reuse an unlinked identity for this RIS modality.">
            <select id="link-existing-dicom" className="input-premium max-w-md" value={linkId} onChange={e => setLinkId(e.target.value)}><option value="">Select a DICOM identity</option>{compatibleDevices.map(d => <option key={d.id} value={d.id}>{d.deviceName} - AE {d.modalityAeTitle}</option>)}</select>
          </Field>
          <Button variant="secondary" disabled={!linkId || linkDicom.isPending} onClick={() => linkDicom.mutate()}>Link identity</Button>
        </div> : null}
      </section> : <p className="border-t border-border pt-4 text-sm text-muted-foreground">Create Equipment first, then configure its optional DICOM identity here.</p>}
    </div> : null}
    <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead><tr><th>Name</th><th>Type</th><th>Linked modality</th><th>Manufacturer / Vendor</th><th>Model</th><th>Location</th><th>DICOM status</th><th>Status</th><th>Actions</th></tr></thead><tbody>{equipment.data?.equipment.map(item => { const isActive = Boolean(value(item, "isActive", "is_active")); const identity = value(item, "dicomIdentity", "dicom_identity") as RecordValue | null; return <tr key={String(item.id)}><td>{asText(item.name)}</td><td>{asText(value(item, "equipmentType", "equipment_type"))}</td><td>{asText(value(item, "modalityCode", "modality_code") ?? "-")}</td><td>{asText(item.vendor || "-")}</td><td>{asText(item.model || "-")}</td><td>{asText(item.location || "-")}</td><td>{identity ? <span>DICOM configured<br /><span dir="ltr" className="text-xs text-muted-foreground">AE: {asText(identity.modalityAeTitle)}</span></span> : "DICOM not configured"}</td><td>{isActive ? "Active" : "Inactive"}</td><td className="whitespace-nowrap"><button className="underline" onClick={() => startEdit(item)}>Edit</button>{isActive ? <button className="ml-2 underline" onClick={() => deactivate.mutate(Number(item.id))}>Deactivate</button> : null}</td></tr>; })}</tbody></table></div>
  </div>;
}
