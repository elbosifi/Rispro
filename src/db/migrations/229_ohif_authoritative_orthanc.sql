-- Authoritative Orthanc is an archive source, not a PACS retrieval cache.
alter table ohif_viewer_settings drop constraint ohif_viewer_settings_access_strategy_check;
alter table ohif_viewer_settings add constraint ohif_viewer_settings_access_strategy_check
  check (access_strategy in ('native_dicomweb', 'orthanc_gateway', 'authoritative_orthanc'));
alter table ohif_viewer_settings add constraint ohif_authoritative_source_check
  check (access_strategy <> 'authoritative_orthanc' or selected_pacs_node_id is null);

alter table viewer_launch_sessions drop constraint viewer_launch_sessions_access_strategy_check;
alter table viewer_launch_sessions alter column source_pacs_node_id drop not null;
alter table viewer_launch_sessions add constraint viewer_launch_sessions_access_strategy_check
  check (access_strategy in ('native_dicomweb', 'orthanc_gateway', 'authoritative_orthanc'));
alter table viewer_launch_sessions add constraint viewer_launch_sessions_source_check
  check ((access_strategy = 'authoritative_orthanc' and source_pacs_node_id is null)
    or (access_strategy <> 'authoritative_orthanc' and source_pacs_node_id is not null));

alter table study_source_resolutions add column source_kind text not null default 'pacs';
alter table study_source_resolutions alter column source_pacs_node_id drop not null;
alter table study_source_resolutions add constraint study_source_resolutions_source_check
  check ((source_kind = 'authoritative_orthanc' and source_pacs_node_id is null)
    or (source_kind = 'pacs' and source_pacs_node_id is not null));
-- Existing PACS uniqueness constraints remain intact.
create unique index study_source_resolutions_authoritative_appointment_idx
  on study_source_resolutions(appointment_id) where source_kind = 'authoritative_orthanc';
create unique index study_source_resolutions_authoritative_accession_uid_idx
  on study_source_resolutions(accession_number, study_instance_uid) where source_kind = 'authoritative_orthanc';
