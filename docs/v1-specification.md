# RISpro Reception Module V1 Specification

This document is the final V1 specification for the reception module prototype.

It is written as the main business and workflow reference for the real implementation.

## 1. Product scope

The system is a reception module for a diagnostic radiology information system.

V1 covers:

- login
- dashboard
- patient registration
- appointment creation
- queue workflow
- patient search
- printing
- settings
- audit trail

V1 is:

- a web app
- bilingual: Arabic and English
- connected later to PostgreSQL
- designed for multi-user simultaneous use
- designed for one organization, without branch logic in V1

## 2. Language and interface

- The interface must support `Arabic` and `English`.
- The language is selected from a menu.
- Arabic uses `RTL`.
- English uses `LTR`.
- Arabic fields should behave as Arabic fields automatically.
- English fields should behave as English fields automatically.
- No warning messages are needed for keyboard language.

## 3. Roles

There are two main roles:

- `receptionist`
- `supervisor`

### Receptionist

Can:

- register patients
- search patients
- create appointments
- add exam types from the appointment screen
- upload request documents
- print slips and labels
- mark no-show
- merge duplicate patients after confirmation
- add walk-in patients directly to queue

### Supervisor

Can do everything a receptionist can do, plus:

- open settings after re-authentication
- overbook when capacity is full
- delete records
- manage user accounts and system-wide settings

## 4. Login and security

- Login is username and password based.
- Settings page requires supervisor re-authentication.
- Password policy should be configurable later in settings.
- Session timeout should be configurable later in settings.
- Login history and settings-change history should be logged.

## 5. Patient identity and registration

### Main identifiers

- `National ID` is the main patient identifier.
- National ID must be `13 digits`.
- National ID must be entered twice for confirmation.
- The system also generates an `MRN`.
- MRN may be edited later by users.

### Registration fields

Core fields:

- Arabic full name
- English full name
- age
- sex
- phone 1
- phone 2
- address
- national ID
- optional custom fields

### Date of birth handling

- If the patient provides age only, the system should estimate date of birth.
- The estimated DOB is saved for system use.

### Transliteration

- Arabic name must transliterate immediately into English.
- Common spelling is preferred.
- The custom dictionary must be applied before general transliteration rules.
- The English transliterated name must remain editable.

### Duplicate logic

- The system must suggest possible previous records while registering/searching.
- Duplicate suggestions should use:
  - national ID
  - phone
  - Arabic name
  - transliterated English name
  - estimated DOB
- Arabic matching should ignore spelling variations such as:
  - `أ / ا`
  - similar common Arabic variations
- Duplicate merge can be done by receptionist or supervisor.
- Duplicate merge must always require confirmation before final save.

### Field configuration

- Field visibility and required/optional rules are configured in settings.
- These rules apply to all patients in V1.

## 6. Phone rules

- Libyan local phone format should be used.
- Phone numbers should be validated as `11 digits`.
- Phone formatting behavior can be expanded later, but V1 should enforce the basic rule.

## 7. Appointment creation

The appointment page must support:

- patient search
- patient selection
- patient detail summary
- modality selection
- exam type selection
- reporting priority
- notes
- instruction preview
- capacity calendar
- appointment slip preview
- label preview

### Exam types

- Receptionists can add a missing exam type from the appointment page.

### Reporting priorities

V1 priorities:

- `Routine`
- `Urgent`
- `STAT`

### Instructions

- General preparation instruction per modality
- Specific instruction per exam type
- Exam-specific instruction overrides the general modality instruction when applicable

## 8. Accession number

- Accession number is generated automatically.
- Format should be `date + daily sequence`.
- Recommended V1 format:
  - `20260325-014`

## 9. Scheduling and capacity

- Capacity is per modality per day.
- No time-slot scheduling in V1.
- Booking is based on daily capacity, not time blocks.
- The calendar should show available daily slots.
- Calendar should show at least the next 14 days and allow later dates.
- Double-booking prevention is required.

### Overbooking

- Only supervisor can overbook.
- Overbooking reason is mandatory.
- The approving supervisor name must be recorded.

## 10. Queue and arrival

- Patients may arrive through barcode scanning.
- Barcode value may be the accession number.
- Queue screen is a separate page.
- Walk-in patients can be added directly to queue.
- Queue can be used by multiple users at the same time.

### Status flow

Main V1 statuses:

- `scheduled`
- `arrived`
- `waiting`
- `completed`
- `no-show`
- `cancelled`

### Status ownership

- Reception controls registration, appointment creation, arrival, queue, no-show, and cancellation workflows.
- `Completed` should be set by modality staff, not reception.
- If modality integration is added later, completion can be connected to modality workflow.

## 11. Automatic no-show rule

- Automatic no-show review starts at `5:00 PM`.
- If a patient has not been marked `arrived` by then, the system should show a warning on the home page.
- The warning should say these are possible no-shows and ask the user/supervisor to confirm.
- No-show should not be finalized silently without confirmation.
- A no-show reason must be saved.

## 12. Cancellation

- Cancellation is supported.
- No cancellation reason list is required in V1, but a cancel reason field must exist and be saved.

## 13. Printing

V1 print outputs:

- appointment slip
- patient label / sticker
- daily appointment list

### Appointment slip

Should include:

- patient name
- modality
- exam type
- accession number
- barcode
- preparation instructions

### Label

Should include:

- patient name
- accession number
- sex / DOB
- barcode

### Printer behavior

- Label printer details should be customizable later in settings.
- Exact printer model is not fixed in V1.

## 14. Document upload and scanning

- Referral/request document upload is supported.
- The uploaded document is linked to patient and appointment.
- Preferred workflow is a one-button scan/upload action from the interface.

### Scanner note

- If TWAIN-like scanning is needed from the browser, real implementation may require:
  - a helper application
  - or a local scanner bridge

## 15. Search behavior

Patient search should support:

- Arabic name
- English name
- phone number
- national ID
- accession number

Search should also show:

- previous appointments
- no-show history
- quick open actions

## 16. Audit trail

The audit trail must record:

- who made the change
- when the change happened
- old value
- new value

Audit trail should include at least:

- patient create/edit/merge/delete
- appointment create/edit/cancel/overbook/no-show
- settings changes
- user changes
- document uploads

## 17. Delete policy

- Only supervisor can delete.

## 18. Backup and restore

V1 should support:

- backup to a local file
- backup download from the browser
- restore from a previous backup

Future storage destinations can be expanded later.

## 19. Home page behavior

The dashboard should show:

- today’s appointments
- arrived patients
- waiting patients
- no-shows needing confirmation
- available capacity by modality
- quick actions
- queue overview

If possible no-shows exist after 5:00 PM:

- show a warning on the home page
- ask the user to confirm that the patient did not arrive

## 20. Settings philosophy

The settings page should control as much of the system behavior as practical.

V1 settings categories include:

- general system
- users and roles
- security and access
- language and interface
- patient registration
- transliteration and dictionary
- modalities and exams
- scheduling and capacity
- queue and arrival
- printing and labels
- documents and uploads
- dashboard and UI
- audit and logging

## 21. Not in V1

These are not priorities in V1:

- branch management
- full modality/cluster integration
- detailed billing
- advanced printer-specific integrations
- desk/location management

## 22. Recommended implementation next step

After this specification is accepted, the next implementation phase should be:

1. authentication and user roles
2. PostgreSQL patient model
3. appointment and accession generation
4. scheduling and capacity logic
5. queue and no-show confirmation logic
6. settings persistence
7. printing and document upload integration
