# Backend Handoff

This document turns the current frontend prototype into a backend-ready handoff.

## Goal

Build a real web app backend for the reception module while keeping the current screen flow and layout decisions from `docs/v1-specification.md`.

## Deployment target

- Ubuntu container on Proxmox
- PostgreSQL database
- Multi-user simultaneous access

## Main screens to support

1. Login
2. Dashboard
3. Patient Registration
4. Appointment Creation
5. Queue
6. Patient Search
7. Daily Print
8. Settings

## Core backend modules

### 1. Authentication and roles

Need:

- login by username and password
- roles: `receptionist`, `supervisor`
- supervisor re-authentication before opening settings

### 2. Patients

Need:

- create patient
- edit patient
- search patient
- detect possible duplicates
- save Arabic and English names
- save automatic transliteration result with manual override
- save national ID as main patient identifier
- confirm national ID by entering it twice
- require manual entry in the confirmation field with paste blocked
- generate MRN automatically
- allow MRN to be edited later
- store age and estimate DOB when age is provided
- ignore Arabic spelling variants during duplicate search
- validate Libyan phone numbers as 10 digits

### 3. Appointments

Need:

- create appointment
- assign modality
- assign exam type
- assign reporting priority
- generate accession number automatically
- use `date + daily sequence` accession format
- store notes
- support supervisor overbooking
- store overbooking reason
- store approving supervisor name

### 4. Scheduling

Need:

- daily capacity per modality
- remaining capacity per day
- calendar availability for future days
- double-booking prevention
- no time-slot logic in V1
- walk-in patient support directly into queue

### 5. Queue

Need:

- barcode scan by accession number
- move appointment to `arrived` and queue state
- show queue order and status
- support walk-in queue entries
- support no-show review warnings after 5:00 PM
- require user confirmation before automatic no-show is finalized

### 6. Documents

Need:

- upload referral/request scan
- link to patient and appointment
- keep room for future scanner bridge integration

### 7. Printing

Need:

- appointment slip
- patient label / sticker
- daily appointment list

### 8. Settings

Need:

- general system
- users and roles
- security and access
- language and interface
- patient registration
- modalities
- exam types
- reporting priorities
- daily capacities
- modality instructions
- exam-specific instructions
- custom Arabic-English dictionary
- registration field rules
- custom fields
- user management
- queue behavior
- printing and labels
- documents and uploads
- dashboard and UI
- audit and logging

## Recommended first API groups

### Auth

- `POST /api/login`
- `POST /api/re-auth`
- `POST /api/logout`
- `GET /api/me`

### Patients

- `GET /api/patients`
- `POST /api/patients`
- `GET /api/patients/:id`
- `PUT /api/patients/:id`
- `GET /api/patients/possible-matches`
- `POST /api/patients/merge`

### Appointments

- `GET /api/appointments`
- `POST /api/appointments`
- `GET /api/appointments/:id`
- `PUT /api/appointments/:id`
- `POST /api/appointments/:id/no-show`
- `POST /api/appointments/:id/confirm-no-show`
- `POST /api/appointments/:id/cancel`

### Queue

- `GET /api/queue`
- `POST /api/queue/scan`
- `POST /api/queue/walk-in`

### Audit

- `GET /api/audit`
- `GET /api/audit/export`

### Integrations

- `GET /api/integrations/status`
- `POST /api/integrations/print-prepare`
- `POST /api/integrations/scan-prepare`

### Settings

- `GET /api/settings/system`
- `PUT /api/settings/system`
- `GET /api/settings/modalities`
- `POST /api/settings/modalities`
- `GET /api/settings/exam-types`
- `POST /api/settings/exam-types`
- `GET /api/settings/users`
- `POST /api/settings/users`

## Minimum PostgreSQL tables

- `users`
- `patients`
- `patient_custom_fields`
- `patient_custom_values`
- `name_dictionary`
- `modalities`
- `exam_types`
- `reporting_priorities`
- `appointments`
- `appointment_status_history`
- `documents`
- `audit_log`
- `system_settings`
- `backup_runs`

## Important business rules

- only supervisors can overbook
- only supervisors can open settings after re-authentication
- only supervisors can delete
- Arabic name transliterates immediately into English name
- English name remains editable
- patient registration must suggest old records when likely duplicate matches exist
- duplicate merge requires confirmation
- barcode value can be the accession number
- no-show history should appear when the patient is searched or selected
- possible no-shows appear on the home page after 5:00 PM and require confirmation
- no-show reason and cancel reason should be saved
- completed status is controlled by modality staff

## Frontend assumptions already locked in

- Arabic / English language menu
- Arabic fields use Arabic direction automatically
- English fields use English direction automatically
- separate pages instead of one crowded page
- color-coded statuses
- dashboard-first workflow

## Suggested implementation order

1. Real login and role system
2. PostgreSQL patient module
3. Appointment creation and accession generation
4. Calendar capacity logic
5. Queue barcode workflow
6. No-show confirmation workflow
7. Settings and user management
8. Printing and document uploads
9. Backup and restore flow
