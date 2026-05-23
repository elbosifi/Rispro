-- Per-user permission for receptionist deferred scheduling override requests.

alter table users
add column if not exists can_request_scheduling_override boolean not null default false;
