alter table imaging_scanners rename to equipment;
alter table equipment rename constraint imaging_scanners_modality_check to equipment_legacy_modality_check;

alter table equipment
  add column equipment_type text,
  add column modality_id bigint references modalities(id) on delete restrict,
  add column serial_number text,
  add column dicom_device_id bigint references dicom_devices(id) on delete set null;

alter table equipment alter column modality drop not null;

do $$
declare
  ct_count integer;
  mri_count integer;
  ct_id bigint;
  mri_id bigint;
begin
  select count(*), min(id) into ct_count, ct_id from modalities where upper(trim(code)) = 'CT';
  select count(*), min(id) into mri_count, mri_id from modalities where upper(trim(code)) in ('MR', 'MRI');
  if exists (select 1 from equipment where modality = 'CT') and ct_count <> 1 then
    raise exception 'Equipment migration requires exactly one CT modality; found %.', ct_count;
  end if;
  if exists (select 1 from equipment where modality = 'MRI') and mri_count <> 1 then
    raise exception 'Equipment migration requires exactly one MR/MRI modality; found %.', mri_count;
  end if;
  update equipment set equipment_type = modality, modality_id = case modality when 'CT' then ct_id when 'MRI' then mri_id end
  where modality in ('CT', 'MRI');
end $$;

alter table equipment
  alter column equipment_type set not null,
  add constraint equipment_type_check check (equipment_type in ('CT','MRI','MAMMOGRAPHY','ULTRASOUND','XRAY','WORKSTATION','PACS_IT','INJECTOR','PRINTER','OTHER')),
  add constraint equipment_legacy_modality_sync_check check (
    (equipment_type = 'CT' and modality = 'CT') or
    (equipment_type = 'MRI' and modality = 'MRI') or
    (equipment_type not in ('CT','MRI') and modality is null)
  );

create unique index equipment_dicom_device_id_uidx on equipment(dicom_device_id) where dicom_device_id is not null;
create index equipment_type_idx on equipment(equipment_type);
create index equipment_modality_id_idx on equipment(modality_id);
create index equipment_active_idx on equipment(is_active);

drop trigger if exists trg_imaging_scanners_updated_at on equipment;
drop trigger if exists trg_equipment_updated_at on equipment;
create trigger trg_equipment_updated_at before update on equipment for each row execute function touch_protocol_management_updated_at();
