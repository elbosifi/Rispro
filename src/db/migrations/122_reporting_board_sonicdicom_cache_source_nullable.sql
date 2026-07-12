alter table doctor_portal.reporting_board_sonicdicom_cache
  alter column source drop not null;

alter table doctor_portal.reporting_board_sonicdicom_cache
  alter column source drop default;

update doctor_portal.reporting_board_sonicdicom_cache
set source = null
where last_success_at is null and report_status = 'unavailable';
