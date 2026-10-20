# Doctor Portal Roster Planning

Doctor Portal roster planning is team-based. It supports availability, leave, conflict checks, templates, draft generation, roster exports, and internal roster notification records.

## Boundaries

- RISpro Core remains authoritative for patients, appointments, scheduling, capacity, print, QR, and receptionist workflows.
- Generated rosters are drafts only and must be reviewed before publish.
- Exports and notifications contain roster data only. They must not include patient or appointment details.
- No payroll, salary, revenue, individual RVU ranking, or individual productivity scoring is implemented.

## Workflow

1. Doctors enter availability or request leave.
2. Supervisors review team availability and approve or reject leave.
3. Supervisors use **Roster Planner → Create Roster** to choose dates and start blank or copy a saved roster. Templates and draft generation remain in Advanced Setup.
4. Conflict validation highlights unavailable doctors, leave, overlapping assignments, junior leads, missing specialists, and modality permission gaps.
5. Publish is blocked while error-level conflicts exist.
6. After publish, supervisors can create notification records for assigned doctors and export the roster.

## Creating and arranging a roster

- New roster dates default to the next Sunday and following Thursday, using the Africa/Tripoli calendar. On Sunday, "next Sunday" means seven days later. Both dates are editable; custom ranges are supported by the existing schema. My Roster retains its Monday–Sunday viewing window and includes relevant assignments from Sunday-start rosters.
- Creation offers **Copy last week's roster**, **Choose a saved roster**, and **Start blank**. Last week means a saved roster starting exactly seven days before the selected start; it never silently substitutes an older roster. The saved-source selector includes drafts, published and archived records and prefers the most recent suitable published source.
- Copy defaults to structure plus assigned doctors. Structure only is optional. The preview shows each included/excluded section and its mapped date. First Sunday maps to first Sunday, first Monday to first Monday, and so on; subsequent occurrences retain their week order. Dates outside either roster's range and cancelled sections are excluded.
- Each day contains independent roster sections. **+ Add Roster → CT/MRI/Ultrasound/Mammography/Reporting/Interventional Radiology** creates a section using a configured duty and matching configured modality where available. A reporting duty is the fallback; unrelated duties such as administration are never substituted. Custom accepts a name and an existing duty. Identical section types can appear more than once on the same day.
- Sections initially use the existing planner's 08:00–14:00 default. Section settings allow renaming, duty/modality selection, session and working-hour changes. Removing a populated section requires an explicit dialog confirmation.
- Doctors are searchable and grouped by their existing professional grades: consultant, specialist, senior_house_officer (Senior SHO), and resident (Junior SHO). Only active profiles linked to active accounts are offered. Professional grade is separate from roster responsibility.
- Dragging a sidebar doctor or selecting a doctor through **Add doctor** asks the backend to suggest responsibility. A consultant/specialist becomes lead when no lead exists; later qualified doctors become specialists. SHOs become SHOs. Existing memberships are preserved on repeated automatic assignment. Managers can explicitly adjust lead/specialist/SHO/supervisor/observer responsibilities.
- Dragging an assigned doctor opens an explicit Move / copy choice. The same action is available without dragging. A move removes the original membership atomically; a copy preserves it. Both preserve the existing responsibility, and duplicate destination membership is refused.
- Edits save immediately. Publishing remains a separate backend-validated action. Conflicts identify the affected section and doctor; the sidebar flags conflicts for the selected day. Published, archived and past rosters are read-only. Custom ranges are also checked against overlapping duties in already published rosters.
- At desktop widths of 1280px and above, the board uses five columns and a grouped doctor sidebar. Narrower layouts use a day selector and a collapsible doctor panel; each section also has a searchable tap/keyboard doctor picker. Longer custom ranges wrap into additional rows.
- The board has its own English/Arabic language control and RTL layout within the existing English Doctor shell. It follows system dark preference using scoped overrides of RISpro tokens and shared controls. Administrator-defined labels and saved section names remain data; only built-in fallback duty labels are translated.

## Persistence and API contract

No new tables or migration are required. Existing `doctor_roster_weeks`, `doctor_roster_assignments` and `doctor_roster_members` remain the records of authority.

- `GET /api/doctor/roster/saved` lists saved roster date ranges and statuses for managers.
- `POST /api/doctor/roster/weeks` accepts the existing dates plus optional `sourceRosterWeekId` and `structureOnly`. Creation, copying and their audit records are committed together; a failed copy leaves no partial new roster.
- `POST /api/doctor/roster/weeks/:id/copy-previous` also accepts `sourceRosterWeekId`, `structureOnly`, and `replaceExisting`. Omitting the source retains the old earlier-roster selection for legacy callers. A populated target returns 409 unless replacement is explicitly requested. Repeated unconfirmed requests never append sections. Replacement failures roll back the original draft and audit changes.
- `POST /api/doctor/roster/assignments/:id/members` permits omitted `teamRole` for backend suggestions. An explicit role retains the existing manager-edit semantics.
- `POST /api/doctor/roster/assignments/:id/members/:memberId/transfer` accepts `targetAssignmentId` and `mode` (`move` or `copy`), within the same editable roster. Both sides and their audit records share one transaction.
- Roster editing and publication serialize using the existing roster row. Source copying also locks its source for reading. Membership removal verifies that the member belongs to the specified section. Conflict validation uses the transaction connection during copying/publishing; specialist coverage derives from professional grade, so assigning an SHO the responsibility "specialist" cannot satisfy qualified coverage.
- With an entirely empty duty registry, the API exposes the previously supported built-in duties with optional `builtIn: true` metadata. It does not overwrite configured duties or re-enable inactive configuration. This keeps a fresh installation usable without requiring ordinary managers to open Advanced Setup.

## Focused validation

```sh
npm run db:test:required -- src/modules/doctor-portal/roster-board.integration.test.ts src/modules/doctor-portal/doctor-portal.integration.test.ts
cd frontend && npm run test -- src/pages/doctor/roster/roster-board-utils.test.ts src/pages/doctor/roster/doctor-roster-board.test.tsx src/pages/doctor/doctor-page.test.tsx src/lib/i18n.test.ts
```

Use the guarded E2E database, then run the actual supervisor workflow and mobile touch/keyboard journey:

```sh
npm run e2e:db:up
VITE_API_PROXY_TARGET=http://127.0.0.1:3100 npm run test:e2e -- e2e/specs/doctor-roster-board.spec.ts
npm run e2e:db:down
```

Screenshots are written under the two `test-results/doctor-roster-board-*` directories. The test exercises 1440px, 1280px and 390px, light/dark, Arabic RTL, populated-section confirmation, section settings, server-rejected publishing, published read-only state, original-source preservation, console/page errors and page overflow. Full-page capture must not occur during an active drag: the installed dnd-kit sensor cancels on the resize it triggers; use viewport capture for that screenshot.

## Limitations

- Notification records are internal audit-style records; email delivery is deferred.
- The generator uses conservative candidate selection and returns unfilled requirements instead of unsafe assignments.
- Template tables are implemented as `doctor_portal.roster_templates`, `roster_template_assignments`, and `roster_template_members`.
