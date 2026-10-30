-- Reuse the authoritative historical catalogue; no new cache or sync state.
create index bookings_reporting_study_uid_idx on appointments_v2.bookings(study_instance_uid,id);
create index source_resolutions_reporting_uid_idx on study_source_resolutions(study_instance_uid,appointment_id)
  where source_kind='authoritative_orthanc';
-- Match the worklist's explicit NULLS LAST ordering.
create index historical_pacs_reporting_date_page_idx on historical_pacs_studies(study_date desc nulls last,orthanc_study_id);

-- Protect future signatures across V2 and legacy authoritative-Orthanc entry
-- points, including reports not linked to a registry yet. Retain existing signed
-- rows and their history unchanged; conflicting legacy signatures need review.
create function guard_native_primary_signature() returns trigger language plpgsql as $$
begin
  if new.status<>'final' or not new.is_primary then return new; end if;
  if new.report_type<>'primary' then
    raise exception 'An additional interpretation cannot be an authoritative primary final';
  end if;
  if new.imaging_source->>'accessStrategy'='authoritative_orthanc' then
    perform pg_advisory_xact_lock(hashtextextended('native-primary:'||new.primary_study_uid,0));
    if exists(select 1 from native_reports n where n.id<>new.id and n.primary_study_uid=new.primary_study_uid
      and n.status='final' and n.is_primary and n.deleted_at is null
      and n.imaging_source->>'accessStrategy'='authoritative_orthanc'
      and (n.imaging_source->>'archiveKey' is null or new.imaging_source->>'archiveKey' is null
        or n.imaging_source->>'archiveKey'=new.imaging_source->>'archiveKey')) then
      raise exception 'An authoritative primary final already exists for this study';
    end if;
  end if;
  return new;
end $$;
create trigger native_primary_signature_guard before insert or update on native_reports
  for each row execute function guard_native_primary_signature();
