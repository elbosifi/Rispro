alter table appointment_protocol_assignments
  alter column protocol_id drop not null,
  alter column protocol_version_id drop not null;

alter table appointment_protocol_assignments
  add column if not exists free_text_protocol text;

create table if not exists doctor_protocol_document_annotations (
  id bigserial primary key,
  document_id bigint not null references documents(id) on delete cascade,
  page_number integer not null check (page_number > 0),
  annotation_type text not null check (annotation_type in ('arrow', 'rectangle', 'freehand', 'text')),
  geometry jsonb not null,
  text_content text,
  style jsonb,
  created_by_user_id bigint references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists doctor_protocol_document_annotations_document_idx
  on doctor_protocol_document_annotations(document_id, page_number, id)
  where deleted_at is null;

create or replace function touch_doctor_protocol_document_annotation_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_doctor_protocol_document_annotations_updated_at on doctor_protocol_document_annotations;
create trigger trg_doctor_protocol_document_annotations_updated_at
before update on doctor_protocol_document_annotations
for each row execute function touch_doctor_protocol_document_annotation_updated_at();
