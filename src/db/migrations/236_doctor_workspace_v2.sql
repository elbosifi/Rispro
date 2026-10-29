-- Extend native reporting in place. Existing signed text and versions are untouched.
alter table historical_pacs_sync_state add column source_archive_key text;

create table native_reporting_studies (
  id uuid primary key default gen_random_uuid(),
  source_archive_key text not null,
  study_instance_uid text not null,
  orthanc_study_id text not null,
  identity jsonb not null,
  modalities text[] not null,
  primary_report_id bigint unique references native_reports(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(source_archive_key, study_instance_uid)
);
alter table viewer_launch_sessions alter column appointment_id drop not null;
alter table viewer_launch_sessions alter column case_id drop not null;
alter table viewer_launch_sessions drop constraint viewer_launch_sessions_case_type_check;
alter table viewer_launch_sessions add constraint viewer_launch_sessions_case_type_check check(case_type in ('appointment','study'));
alter table viewer_launch_sessions add column reporting_study_key uuid references native_reporting_studies(id);
alter table viewer_launch_sessions add column reporting_report_id bigint references native_reports(id);
alter table viewer_launch_sessions add constraint viewer_launch_identity_check check(appointment_id is not null or reporting_study_key is not null);
alter table native_reports alter column appointment_id drop not null;
alter table native_reports alter column patient_id drop not null;
alter table native_reports add column legacy_primary boolean not null default true;
alter table native_reports add column report_type text not null default 'primary';
alter table native_reports add column collaboration_mode text not null default 'independent' check(collaboration_mode in ('independent','shared'));
alter table native_reports add column is_primary boolean not null default true;
alter table native_reports add column last_editor_user_id bigint references users(id);
alter table native_reports add column last_editor_name text;
alter table native_reports add column review_requested_at timestamptz;
alter table native_reports add column review_requested_by bigint references users(id);
alter table native_reports add column preferred_reviewer_id bigint references doctor_portal.doctor_profiles(id);
alter table native_reports add column reviewed_by bigint references users(id);
alter table native_reports add column policy_version integer;
alter table native_reports add column deleted_at timestamptz;
alter table native_reports add column deleted_by bigint references users(id);
alter table native_reports add column deletion_reason text;
-- All dependent legacy queries select a single active primary in this release.
alter table native_reports drop constraint native_reports_appointment_id_key;
create unique index native_reports_legacy_appointment_idx on native_reports(appointment_id) where legacy_primary and deleted_at is null;
create index native_reports_active_author_idx on native_reports(author_user_id,status) where deleted_at is null;
create index native_reports_signer_date_idx on native_reports(finalized_by_user_id,finalized_at) where status='final';
create index native_reports_study_uid_idx on native_reports(primary_study_uid);

-- Separate additive association preserves immutable legacy signed rows.
create table native_report_study_links (
  report_id bigint primary key references native_reports(id) on delete restrict,
  study_id uuid not null references native_reporting_studies(id) on delete restrict
);
create index native_report_links_study_idx on native_report_study_links(study_id,report_id);
create function protect_native_study_link() returns trigger language plpgsql as $$
declare report native_reports; study native_reporting_studies;
begin
  if tg_op<>'INSERT' then raise exception 'Verified report study associations are immutable'; end if;
  select * into report from native_reports where id=new.report_id;
  select * into study from native_reporting_studies where id=new.study_id;
  if report.primary_study_uid<>study.study_instance_uid or report.imaging_source->>'accessStrategy'<>'authoritative_orthanc'
    or (report.imaging_source ? 'archiveKey' and report.imaging_source->>'archiveKey'<>study.source_archive_key)
    or (report.appointment_id is null and report.identity->>'patientIdentifier'<>study.identity->>'patientIdentifier') then
    raise exception 'Report study association must match verified source and patient identity';
  end if;
  return new;
end $$;
create trigger native_study_link_guard before insert or update or delete on native_report_study_links
for each row execute function protect_native_study_link();
create function protect_native_study_authority() returns trigger language plpgsql as $$
begin
  if tg_op='DELETE' then raise exception 'Reporting study identity must be retained'; end if;
  if (new.id,new.source_archive_key,new.study_instance_uid,new.orthanc_study_id,new.identity,new.modalities,new.created_at)
    is distinct from (old.id,old.source_archive_key,old.study_instance_uid,old.orthanc_study_id,old.identity,old.modalities,old.created_at) then
    raise exception 'Verified reporting study identity is immutable';
  end if;
  if old.primary_report_id is not null and new.primary_report_id is distinct from old.primary_report_id then
    raise exception 'Authoritative primary final cannot be replaced';
  end if;
  if new.primary_report_id is not null and not exists(select 1 from native_report_study_links l join native_reports r on r.id=l.report_id where l.study_id=new.id and r.id=new.primary_report_id and r.status='final' and r.is_primary and r.deleted_at is null) then
    raise exception 'Authoritative primary must be a linked immutable final';
  end if;
  return new;
end $$;
create trigger native_study_authority_guard before update or delete on native_reporting_studies
for each row execute function protect_native_study_authority();
create table native_report_contributors (
  report_id bigint not null references native_reports(id) on delete restrict,
  user_id bigint not null references users(id),
  display_name text not null,
  first_contributed_at timestamptz not null default now(),
  primary key(report_id,user_id)
);
insert into native_report_contributors(report_id,user_id,display_name)
select report_id,actor_user_id,min(actor_name) from native_report_versions where kind in ('draft','final') group by report_id,actor_user_id;
create index native_report_contributors_user_idx on native_report_contributors(user_id,report_id);
create table native_report_review_events (
  id bigserial primary key,
  report_id bigint not null references native_reports(id),
  event_type text not null check(event_type in ('submit','feedback','return','withdraw')),
  actor_user_id bigint not null references users(id),
  actor_name text not null,
  comment text not null default '',
  preferred_reviewer_id bigint references doctor_portal.doctor_profiles(id),
  created_at timestamptz not null default now()
);
create trigger native_review_history_immutable before update or delete on native_report_review_events
for each row execute function protect_native_report_version();

create index historical_pacs_reporting_date_idx on historical_pacs_studies(study_date desc,orthanc_study_id);
create index historical_pacs_reporting_date_filter_idx on historical_pacs_studies(replace(study_date,'-',''),orthanc_study_id);
create index historical_pacs_reporting_modalities_idx on historical_pacs_studies using gin(modalities_in_study);
create index historical_pacs_reporting_search_idx on historical_pacs_studies using gin
 ((coalesce(patient_name_raw,'') || ' ' || coalesce(patient_id,'') || ' ' || coalesce(accession_number,'') || ' ' || coalesce(study_description,'') || ' ' || coalesce(study_instance_uid,'')) gin_trgm_ops);

insert into system_settings(category,setting_key,setting_value) values
 ('doctor_workspace','reporting_policy','{"enabled":false,"version":1,"creation":"accessible","collaboration":"both","review":"optional","mandatoryReviewRoles":["resident","senior_house_officer"],"reviewEligibility":"open","signing":"permission","additional":"typed","allowedTypes":["primary","second_opinion","additional_interpretation","peer_review"],"deletion":"creator","restoreRevisions":true}')
on conflict(category,setting_key) do nothing;

create or replace function guard_native_report_authority() returns trigger language plpgsql as $$
begin
  perform id from appointments_v2.bookings where id=new.appointment_id for update;
  if exists(select 1 from native_reports where appointment_id=new.appointment_id and deleted_at is null) then
    if tg_table_name='reporting_board_manual_final_overrides' then
      raise exception 'Native reports must be signed through native reporting';
    end if;
    return null;
  end if;
  return new;
end $$;
