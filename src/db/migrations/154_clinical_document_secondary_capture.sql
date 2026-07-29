alter table clinical_document_exports add column if not exists representation_type text not null default 'encapsulated_pdf';
alter table clinical_document_exports add column if not exists expected_page_count integer;
alter table clinical_document_exports add column if not exists exported_page_count integer not null default 0;
alter table clinical_document_exports add column if not exists verified_page_count integer not null default 0;
alter table clinical_document_exports add column if not exists series_number integer;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='clinical_document_exports_representation_type_check') then
    alter table clinical_document_exports add constraint clinical_document_exports_representation_type_check check (representation_type in ('encapsulated_pdf','secondary_capture'));
  end if;
  if not exists (select 1 from pg_constraint where conname='clinical_document_exports_expected_page_count_check') then
    alter table clinical_document_exports add constraint clinical_document_exports_expected_page_count_check check (expected_page_count is null or expected_page_count > 0);
  end if;
end $$;
create table if not exists clinical_document_export_instances (
  id bigserial primary key, export_id bigint not null references clinical_document_exports(id) on delete cascade,
  page_number integer not null check (page_number > 0), instance_number integer not null check (instance_number > 0),
  sop_instance_uid text not null unique, series_instance_uid text not null, pixel_sha256 text check (pixel_sha256 is null or pixel_sha256 ~ '^[a-f0-9]{64}$'),
  rows integer not null check (rows > 0), columns integer not null check (columns > 0), status text not null default 'pending' check (status in ('pending','exporting','verified','failed','blocked')),
  orthanc_instance_id text, orthanc_series_id text, last_error text, exported_at timestamptz, verified_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(export_id, page_number), unique(series_instance_uid, instance_number)
);
create index if not exists clinical_document_export_instances_export_idx on clinical_document_export_instances(export_id, page_number);
