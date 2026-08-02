alter table modalities
  add column if not exists safety_workflow_type text not null default 'standard_acknowledgement';

alter table modalities
  add constraint modalities_safety_workflow_type_check
  check (safety_workflow_type in ('standard_acknowledgement', 'mri_primary_implant_screening'));

create table if not exists appointments_v2.mri_primary_screenings (
  id bigserial primary key,
  booking_id bigint not null unique references appointments_v2.bookings(id) on delete cascade,
  result text not null check (result in ('no_known_implant_reported', 'implant_reported_review_required')),
  implant_site text null,
  implant_description text null,
  previous_reviewer_name_reported text null,
  screened_by_user_id bigint not null references users(id),
  screened_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((result = 'no_known_implant_reported' and implant_site is null and implant_description is null and previous_reviewer_name_reported is null) or (result = 'implant_reported_review_required' and length(trim(coalesce(implant_site, ''))) > 0))
);
