-- Narrative reports are RISpro records, not measurement SR or PACS objects.
alter table ohif_viewer_settings add column native_reporting_enabled boolean not null default false;
alter table viewer_launch_sessions add column report_context_id uuid not null default gen_random_uuid();
alter table viewer_launch_sessions add column reporting_patient_id bigint references patients(id) on delete restrict;
alter table viewer_launch_sessions add column primary_study_date text;
create unique index viewer_launch_report_context_idx on viewer_launch_sessions(report_context_id);

create table native_reports (
  id bigserial primary key,
  appointment_id bigint not null unique references appointments_v2.bookings(id) on delete restrict,
  patient_id bigint not null references patients(id) on delete restrict,
  primary_study_uid text not null,
  imaging_source jsonb not null,
  identity jsonb not null,
  status text not null default 'draft' check(status in ('draft','final')),
  revision integer not null default 1 check(revision > 0),
  sections jsonb not null,
  author_user_id bigint not null references users(id) on delete restrict,
  author_name text not null,
  finalized_by_user_id bigint references users(id) on delete restrict,
  finalized_by_doctor_id bigint references doctor_portal.doctor_profiles(id) on delete restrict,
  finalizer_name text,
  finalized_at timestamptz,
  signed_snapshot jsonb,
  finalize_request_id uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status='draft' and signed_snapshot is null and finalized_at is null) or
    (status='final' and signed_snapshot is not null and finalized_at is not null and finalized_by_user_id is not null))
);
create table native_report_versions (
  id bigserial primary key,
  report_id bigint not null references native_reports(id) on delete restrict,
  revision integer,
  kind text not null check(kind in ('draft','final','addendum')),
  snapshot jsonb not null,
  actor_user_id bigint not null references users(id) on delete restrict,
  actor_name text not null,
  request_id uuid unique,
  created_at timestamptz not null default now(),
  unique(report_id,revision)
);
create table native_report_key_images (
  id uuid primary key,
  report_id bigint not null references native_reports(id) on delete restrict,
  purpose text not null default 'report_key_image' check(purpose='report_key_image'),
  stored_path text not null unique,
  sha256 text not null check(length(sha256)=64),
  byte_size integer not null check(byte_size>0),
  width integer not null check(width between 32 and 4096),
  height integer not null check(height between 32 and 4096),
  provenance jsonb not null,
  caption text not null default '',
  position integer not null,
  removed boolean not null default false,
  captured_by_user_id bigint not null references users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index native_report_images_report_idx on native_report_key_images(report_id,position);

create function protect_native_signed_report() returns trigger language plpgsql as $$
begin
  if old.status='final' then raise exception 'Signed reports are immutable'; end if;
  if tg_op='DELETE' then raise exception 'Reports must be retained'; end if;
  return new;
end $$;
create trigger native_signed_report_immutable before update or delete on native_reports
  for each row execute function protect_native_signed_report();
create function protect_native_report_version() returns trigger language plpgsql as $$
begin raise exception 'Report history is append only'; end $$;
create trigger native_report_history_immutable before update or delete on native_report_versions
  for each row execute function protect_native_report_version();
create function protect_native_report_image() returns trigger language plpgsql as $$
begin
  if tg_op='DELETE' then raise exception 'Report image assets must be retained'; end if;
  if (select status from native_reports where id=old.report_id)='final' then
    raise exception 'Signed image selections are immutable';
  end if;
  if (new.id,new.report_id,new.stored_path,new.sha256,new.byte_size,new.width,new.height,new.provenance,new.captured_by_user_id,new.created_at)
    is distinct from (old.id,old.report_id,old.stored_path,old.sha256,old.byte_size,old.width,old.height,old.provenance,old.captured_by_user_id,old.created_at) then
    raise exception 'Captured assets and provenance are immutable';
  end if;
  return new;
end $$;
create trigger native_report_image_immutable before update or delete on native_report_key_images
  for each row execute function protect_native_report_image();

-- Serialize ownership selection with a legacy refresh already in flight.
create function guard_native_report_authority() returns trigger language plpgsql as $$
begin
  perform id from appointments_v2.bookings where id=new.appointment_id for update;
  if exists(select 1 from native_reports where appointment_id=new.appointment_id) then
    if tg_table_name='reporting_board_manual_final_overrides' then
      raise exception 'Native reports must be signed through native reporting';
    end if;
    return null;
  end if;
  return new;
end $$;
create trigger native_report_sonic_authority before insert or update on doctor_portal.reporting_board_sonicdicom_cache
  for each row execute function guard_native_report_authority();
create trigger native_report_manual_authority before insert or update on doctor_portal.reporting_board_manual_final_overrides
  for each row execute function guard_native_report_authority();
