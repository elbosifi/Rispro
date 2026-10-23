# Complete application UI polish — progress

Status: active; primary printing batch complete. Reporting/document delivery batch underway.

## Baseline and safety

- Starting main/origin/main: `50514e038eaf1e8792b89864b3b2854fc27dfccd`, clean, fetched and aligned.
- Local rollback branch: `codex/application-ui-polish-goal`; no push, PR, or deployment.
- The committed five-screen polish is present in `50514e03`. References: Appointment Creation, Reporting Board, Patient Registration, Scheduling Settings, Dashboard.
- Read AGENTS, CURRENT_TASK (stale prior security goal), UI normalization guidance, shared README, tokens, routes and navigation.
- Baseline checks outside sandbox: agent contract PASS; preflight PASS/DOCKER_OK; frontend typecheck PASS; production build PASS; focused reference tests 143/143 PASS; Chromium foundation 1/1 PASS; frontend lint PASS with 9 existing hook warnings.
- Existing warning-only output: large production bundle; jsdom scrollTo stubs; 9 lint hook warnings. No failed baseline check.
- Only guarded disposable E2E database, synthetic seed, localhost backend 3100/frontend 5173. External integrations disabled/unconfigured in this environment.
- Browser tooling: in-app browser unavailable; native Safari connection timed out. Repository Chromium E2E harness works.
- Screenshot artifacts and capture runner live outside tracked application source in the system temporary directory.

## Counting and exclusions

Each canonical routed page or separately navigable Settings/protocol/setup section is one inventory entry. Parameterized detail/editor routes count once each; aliases and redirects do not count again. Shared subpanels and dialogs are assessed with their owning screen.

Redirect-only aliases excluded: `/`, `/appointments/legacy`, `/v2/appointments`, `/doctor`, `/doctor/dashboard`, `/doctor/cases`, `/doctor/admin/roster`, `/doctor/admin/doctors`, `/mobile/reporting-view/:token`, `/public/cancel-appointment`, `/teaching`, wildcard fallbacks. The five reference entries are regression-only. Despite its name, Legacy Access Viewer is actively routed and remains in scope. Teaching is actively routed and remains in scope. Internal print renderers are active output surfaces and remain in scope.

## Inventory

Total discovered composed screen entries: **119**, including **5** regression references; **114** remaining entries. Inventory completeness will be checked against reachable nested views during browser assessment.

| Module | Route / view | Component | Priority | Status |
| --- | --- | --- | --- | --- |
| Access | `/login` | `LoginPage` | P2 | Discovered |
| Reference | `/dashboard` | `DashboardPage` | P2 | Regression reference |
| Patients | `/patients` | `PatientsPage` | P2 | Complete — batch 6 |
| Reference | `/patients/new` | `PatientsPage / PatientForm` | P2 | Regression reference |
| Patients | `/patients/:id/edit` | `EditPatientPage` | P2 | Complete — batch 6 |
| Patients | `/patients/merge` | `PatientMergePage` | P2 | Complete — batch 6 |
| Patients | `/name-dictionary` | `NameDictionaryPage` | P2 | Complete — batch 6 |
| Reference | `/appointments` | `AppointmentCreatePage` | P2 | Regression reference |
| Operations | `/scheduling/override-requests` | `SchedulingOverrideRequestsPage` | P1 | Complete — batch 7 |
| Operations | `/recall-requests` | `RecallRequestsPage` | P1 | Complete — batch 4 |
| Operations | `/calendar` | `CalendarPage` | P1 | Complete — batch 5 |
| Operations | `/registrations` | `RegistrationsPage` | P1 | Complete — batch 5 |
| Documents | `/request-scans` | `RequestScansPage` | P1 | Complete — batch 7 |
| Operations | `/queue` | `QueuePage` | P1 | Complete — batch 5 |
| Operations | `/queue/check-in` | `QueueCheckInPage` | P1 | Complete — batch 5 |
| Operations | `/queue/no-shows` | `NoShowReviewPage` | P1 | Complete — batch 5 |
| Modality | `/modality` | `ModalityPage` | P1 | Complete — batch 7 |
| Documents | `/modality/document-ingestion` | `DocumentIngestionPage` | P1 | Complete — batch 7 |
| Comparisons | `/comparisons` | `ComparisonsPage` | P1 | Complete — batch 4 |
| Comparisons | `/comparisons/:id` | `ComparisonsPage (detail)` | P1 | Complete — batch 4 |
| Comparisons | `/comparisons/ir/:id` | `IrReferralDetailPage` | P1 | Complete — batch 4 |
| Comparisons | `/comparisons/:id/remap` | `PacsRemapPage (comparison)` | P1 | Complete — batch 8 |
| Printing | `/print` | `PrintPage / ReportCenter` | P2 | Complete — batch 9 |
| Printing | `/print?appointmentId=:id` | `DirectAppointmentPrintPage` | P2 | Complete — batch 9 |
| Printing | `/print/day-list` | `DayListPrintPage` | P2 | Complete — batch 9 |
| Printing | `/print/reporting-board` | `ReportingBoardPrintPage` | P2 | Complete — batch 9 |
| Printing | `/print/internal/appointment-slip` | `InternalAppointmentSlipRenderPage` | P2 | Discovered |
| Printing | `/print/internal/registration-list` | `InternalRegistrationListRenderPage` | P2 | Discovered |
| Monitoring | `/statistics` | `StatisticsPage` | P2 | Discovered |
| Patients | `/search` | `SearchPage` | P2 | Complete — batch 6 |
| PACS | `/pacs` | `PacsPage` | P2 | Complete — batch 8 |
| PACS | `/pacs/remap` | `PacsRemapPage` | P2 | Complete — batch 8 |
| PACS | `/systems/authoritative-orthanc` | `AuthoritativeOrthancOperationsPage` | P2 | Complete — batch 8 |
| Monitoring | `/worklist-monitor` | `WorklistMonitorPage` | P2 | Complete — batch 8 |
| Settings | `/settings` | `SettingsPage` | P2 | Discovered |
| Monitoring | `/incidents` | `IncidentsPage` | P2 | Discovered |
| SOP | `/sops` | `SopsPage (library)` | P2 | Discovered |
| SOP | `/sops/new` | `SopsPage (authoring)` | P2 | Discovered |
| SOP | `/sops/:id` | `SopsPage (detail/revisions)` | P2 | Discovered |
| Printing | `/workstation/printing` | `WorkstationPrintingPage` | P2 | Complete — batch 9 |
| Legacy access | `/legacy-access-viewer` | `LegacyAccessViewerPage` | P2 | Discovered |
| Reference | `/v2/appointments/admin` | `SchedulingAdminPage` | P2 | Regression reference |
| Public | `/public/appointment` | `PublicCancelAppointmentPage` | P2 | Discovered |
| Reporting | `/reporting/worklist/:token` | `ReportingBoardMobilePage` | P2 | Discovered |
| Documents | `/reporting/worklist/:token/cases/:caseId/documents` | `ReportingWorklistDocumentsPage` | P1 | Discovered |
| Doctor | `/doctor/my-work` | `DoctorPortalHome` | P1 | Complete — batch 1 |
| Doctor | `/doctor/today-cases` | `DoctorCasesPage` | P1 | Complete — batch 1 |
| Doctor | `/doctor/reporting-board` | `DoctorReportingBoardPage` | P1 | Regression reference |
| Doctor | `/doctor/doctor-worklists` | `DoctorWorklistsPage` | P1 | Complete — batch 1 |
| Doctor | `/doctor/reporting-board/saved/:token` | `DoctorReportingBoardPage (saved view)` | P1 | Discovered |
| Doctor | `/doctor/roster-planner` | `DoctorRosterPage (management)` | P1 | Complete — batch 2 |
| Doctor | `/doctor/doctors-directory` | `DoctorAdminDoctorsPage` | P1 | Complete — batch 2 |
| Doctor | `/doctor/advanced-setup` | `DoctorAdvancedSetupPage` | P1 | Complete — batch 2 |
| Doctor | `/doctor/advanced-setup?section=roster` | `DoctorRosterPage (advanced)` | P1 | Complete — batch 2 |
| Doctor | `/doctor/advanced-setup?section=doctors` | `DoctorAdminDoctorsPage (advanced)` | P1 | Complete — batch 2 |
| Doctor | `/doctor/roster` | `DoctorRosterPage (personal)` | P1 | Complete — batch 2 |
| Doctor | `/doctor/availability` | `DoctorAvailabilityPage` | P1 | Complete — batch 1 |
| Doctor | `/doctor/protocols` | `DoctorProtocolsPage (protocoling)` | P1 | Complete — batch 3 |
| Doctor | `/doctor/additional-imaging` | `RecallRequestsPage (doctor)` | P1 | Complete — batch 4 |
| Doctor | `/doctor/ir-consultations` | `DoctorIrReferralsPage` | P1 | Complete — batch 4 |
| Doctor | `/doctor/ir-consultations/:id` | `IrReferralDetailPage (doctor)` | P1 | Complete — batch 4 |
| Doctor | `/doctor/team-workload` | `DoctorTeamWorkloadPage` | P1 | Complete — batch 1 |
| Protocols | `/doctor/protocols?area=library&section=protocols` | `DoctorProtocolsPage / protocols` | P1 | Complete — batch 3 |
| Protocols | `/doctor/protocols?area=library&section=importExport` | `DoctorProtocolsPage / importExport` | P1 | Complete — batch 3 |
| Protocols | `/doctor/protocols?area=library&section=anatomy` | `DoctorProtocolsPage / anatomy` | P1 | Complete — batch 3 |
| Protocols | `/doctor/protocols?area=library&section=scanners` | `DoctorProtocolsPage / scanners` | P1 | Complete — batch 3 |
| Protocols | `/doctor/protocols?area=library&section=ctPhases` | `DoctorProtocolsPage / ctPhases` | P1 | Complete — batch 3 |
| Protocols | `/doctor/protocols?area=library&section=mriSequences` | `DoctorProtocolsPage / mriSequences` | P1 | Complete — batch 3 |
| Settings | `/settings?section=mobile_widget` | `MobileWidgetAccessSection` | P2 | Discovered |
| Settings | `/settings?section=patient_registration` | `SimpleSettingsSection` | P2 | Discovered |
| Settings | `/settings?section=patient_import` | `PatientImportSection` | P2 | Discovered |
| Settings | `/settings?section=patient_duplicate_resolver` | `PatientDuplicateResolverSection` | P2 | Discovered |
| Settings | `/settings?section=scheduling_and_capacity` | `SimpleSettingsSection` | P2 | Discovered |
| Settings | `/settings?section=queue_and_arrival` | `SimpleSettingsSection` | P2 | Discovered |
| Settings | `/settings?section=scheduling_engine_config` | `SchedulingEngineConfigSection` | P2 | Discovered |
| Settings | `/settings?section=pacs_connection` | `PacsSettingsSection` | P2 | Discovered |
| Settings | `/settings?section=dicom_gateway_config` | `DicomGatewaySettingsSection` | P2 | Discovered |
| Settings | `/settings?section=dicom_gateway_monitoring` | `DicomMonitoringSection` | P2 | Discovered |
| Settings | `/settings?section=mwl_policy` | `MwlPolicySection` | P2 | Discovered |
| Settings | `/settings?section=orthanc_mwl_sync` | `OrthancMwlSection` | P2 | Discovered |
| Settings | `/settings?section=users` | `UsersSection` | P2 | Discovered |
| Settings | `/settings?section=action_pin_policy` | `ActionPinPolicySection` | P2 | Discovered |
| Settings | `/settings?section=role_page_access` | `RolePageAccessSection` | P2 | Discovered |
| Settings | `/settings?section=audit_log` | `AuditLogSection` | P2 | Discovered |
| Settings | `/settings?section=exam_types` | `ExamTypesSection` | P2 | Discovered |
| Settings | `/settings?section=modalities` | `ModalitiesSection` | P2 | Discovered |
| Settings | `/settings?section=equipment` | `EquipmentSection` | P2 | Discovered |
| Settings | `/settings?section=name_dictionary` | `NameDictionarySection` | P2 | Discovered |
| Settings | `/settings?section=not_allowed_name_words` | `NotAllowedNameWordsSection` | P2 | Discovered |
| Settings | `/settings?section=appointment_slip` | `AppointmentSlipSettingsSection` | P2 | Discovered |
| Settings | `/settings?section=qz_tray` | `QzTrayPrintingSection` | P2 | Discovered |
| Settings | `/settings?section=deployment_identity` | `DeploymentIdentitySection` | P2 | Discovered |
| Settings | `/settings?section=patient_qr_self_service` | `PatientQrSettingsSection` | P2 | Discovered |
| Settings | `/settings?section=passkey_configuration` | `PasskeyConfigurationSection` | P2 | Discovered |
| Settings | `/settings?section=sonicdicom_reports` | `SonicDicomReportsSection` | P2 | Discovered |
| Settings | `/settings?section=ohif_viewer` | `OhifViewerSection` | P2 | Discovered |
| Settings | `/settings?section=documents_and_uploads` | `DocumentsStorageSection` | P2 | Discovered |
| Settings | `/settings?section=backup_restore` | `BackupRestoreSection` | P2 | Discovered |
| Settings | `/settings?section=system_diagnostics` | `SystemDiagnosticsSection` | P2 | Discovered |
| Settings | `/settings?section=request_scan_automation` | `RequestScanAutomationSection` | P2 | Discovered |
| Settings | `/settings?section=email_notifications` | `EmailNotificationsSection` | P2 | Discovered |
| Settings | `/settings?section=authoritative_orthanc` | `AuthoritativeOrthancSection` | P2 | Discovered |
| Teaching | `/teaching/login` | `TeachingLoginPage` | P3 | Discovered |
| Teaching | `/teaching/dashboard` | `TeachingDashboardPage` | P3 | Discovered |
| Teaching | `/teaching/anatomy` | `TeachingAnatomyIndexPage` | P3 | Discovered |
| Teaching | `/teaching/anatomy/sources` | `TeachingAnatomySourcesPage` | P3 | Discovered |
| Teaching | `/teaching/anatomy/atlas/:atlasId` | `TeachingAnatomyAtlasPage` | P3 | Discovered |
| Teaching | `/teaching/anatomy/liver` | `TeachingLiverAnatomyPage` | P3 | Discovered |
| Teaching | `/teaching/qbank` | `TeachingQbankPage` | P3 | Discovered |
| Teaching | `/teaching/qbank/session/:sessionId` | `TeachingSessionPage` | P3 | Discovered |
| Teaching | `/teaching/history` | `TeachingHistoryPage` | P3 | Discovered |
| Teaching | `/teaching/progress` | `TeachingProgressPage` | P3 | Discovered |
| Teaching | `/teaching/admin/import` | `TeachingImportPage` | P3 | Discovered |
| Teaching | `/teaching/admin/import/history` | `TeachingImportHistoryPage` | P3 | Discovered |
| Teaching | `/teaching/admin/import/batches/:batchId` | `TeachingImportBatchPage` | P3 | Discovered |
| Teaching | `/teaching/admin/questions` | `TeachingQuestionListPage` | P3 | Discovered |
| Teaching | `/teaching/admin/questions/maintenance` | `TeachingQuestionMaintenancePage` | P3 | Discovered |
| Teaching | `/teaching/admin/questions/new` | `TeachingQuestionEditorPage` | P3 | Discovered |
| Teaching | `/teaching/admin/questions/:id` | `TeachingQuestionEditorPage` | P3 | Discovered |

## Milestone ledger

- Preflight: complete.
- Inventory: 118 routed screen/view entries discovered, including 5 reference entries; full reachability/subview audit remains pending.
- Batches: Doctor Workspace; roster and directory; protocols; reception operations; modality/documents; patient management; comparisons/IR; PACS/monitoring; SOP/printing; Settings clinical, scheduling, integrations, administration, system; Teaching learner/editorial/anatomy; public/auth; final reference regression. Each batch is split into 3–5 screens where practical.
- Screens completed: 35 (28 polished, 7 accepted without further visual change). Four execution/document/override entries initially assessed; 74 non-reference entries remain unassessed. Five original reference regressions passed at batch 5; final regression remains required after later edits.
- Screenshots: batch 1 before/after desktop/mobile captures, Arabic-preference captures (the Doctor Workspace intentionally forces English/LTR), and the QR dialog. See the local screenshot report for exact files.
- Decisions requiring approval: none pending. Both encountered test-locator/interaction repairs were explicitly authorized and now pass.
- Remaining: visual assessment, focused changes, before/after evidence, targeted tests per batch, final typecheck/build and regression checks, final main alignment and uncommitted squash-apply.

### Batch 1 — Doctor Workspace core

- Assessed/completed: My Work, Today’s Cases, Doctor Worklists, Availability, Team Workload.
- Fixed: teal primary actions inconsistent with the blue reference screens; dark default control/table borders; unlabelled Availability date/time/status inputs; inconsistent control heights; worklist header alignment; manual QR overlay without Escape/focus handling.
- Reused shared Button/Input and Dialog; native selects retain their label/layout semantics. Dense domain tables and segmented view controls stay local. Scoped compact styling applies only to assessed pages; shared primitives and theme tokens are unchanged.
- Browser: before/after 1440x960 and 390x844; populated cases/worklists, empty availability/leave/workload, and QR modal. QR Tab containment, Escape, and focus restoration pass. Five Arabic-preference captures confirm the existing explicit English/LTR Doctor Workspace boundary (not an Arabic translation or RTL-compliance claim).
- Checks: 104 focused tests pass; 8 existing Doctor navigation E2E pass; 5 before + 5 final after capture cases pass; 5 Arabic-preference capture cases pass; QR keyboard case passes; frontend typecheck/build pass on final batch tree; targeted lint retains one pre-existing hook warning; harness:all passes with existing warning-only findings; diff whitespace clean.
- Correction during development: introduced JSX self-closing syntax error detected by focused tests/typecheck/build and first two after captures; corrected, rejected invalid captures, and reran to passing.
- Next-batch baseline: 2 existing roster browser tests pass, including populated synthetic roster, phone alternatives, theme and simulated direction checks.
- Open batch limits: workload populated summary and editable scoring-rule form still need representative fixture coverage; Availability/leave successful and error states need further browser characterization. These remain explicit follow-up validation, not claimed passed.

### Batch 2 — Roster, directory and advanced setup

- Assessed/completed: Roster Planner, My Roster, Advanced Setup menu, Roster setup, Doctors Directory, Doctor import/export. Planner and menu already meet the reference style and are accepted without further restructuring.
- Fixed: legacy active roster/admin controls and directory actions using teal or default dark borders; directory row dividers; drawer tabs and separators; inconsistent form sizing. Added persistent labels to 32 roster setup/template/assignment controls and 8 workload admin fields. Preserved native drag handles, tab/disclosure controls, permission checkboxes, file uploads, drawer geometry, and all handlers.
- Synthetic fixtures: linked the existing disposable super-admin account to a synthetic doctor profile through existing APIs, plus a current-week draft roster/assignment, availability, study leave, and workload catalog rule. This enabled admin-only views without changing application permissions or auth implementation. The extra synthetic profile increases directory rows from 4 to 5 across some captures; screenshot comparisons must not attribute this data change to UI code.
- Browser: desktop/mobile normal pages; populated planner/personal/advanced roster; admin setup/import; all directory drawer tabs and creation; labeled workload catalog form. Original planner workflow baseline passed 2 existing E2E tests. Directory responsive drawer E2E passes; before/after capture cases and drawer case pass. Doctor Workspace remains English/LTR; the planner has its own local Arabic/direction support and requires final targeted regression.
- Checks on final batch tree: 118 focused tests pass; frontend typecheck/build pass; targeted lint passes; harness:ui passes; whitespace check passes. Existing bundle warning retained.
- Development correction: the label text-edit helper produced invalid JSX; rejected those renders, replaced the edit with syntax-aware insertion, and reran typecheck, build, focused tests, and captures successfully.
- Rollback: batch 1 checkpoint `62688641`; batch 2 local checkpoint follows after final capture comparison. No push.

## Stop checkpoint — required validation failure

- Goal incomplete. Do not squash-apply to main.
- Completed checkpoints: batch 1 `62688641`; batch 2 `fe63fc29`, both local-only on `codex/application-ui-polish-goal`. Starting main remains `50514e038eaf1e8792b89864b3b2854fc27dfccd`.
- Next-batch baseline command: `npx playwright test e2e/specs/protocol-library-usability.spec.ts --reporter=line --output=<temporary-artifact-directory>/protocol-baseline`. Failed before any Protocol Management source edit.
- Exact failure: `e2e/specs/protocol-library-usability.spec.ts:61`, `getByRole("button", { name: "Protocols", exact: true }).click()` resolves to two valid controls: the Doctor navigation button and the button inside `aria-label="Protocol library navigation"`. Playwright strict-mode violation.
- Diagnostic evidence: the test file, Protocols page, and Doctor navigation component have no diff from starting main. Existing navigation and in-page labels are both intentional in source; this is an unscoped test locator. No test patch, test relaxation, UI rename, threshold change, or retry was made.
- Required operating rule: stop at the first unrelated failure. This blocks further implementation and final main squash-apply. The next task should scope the in-page locator and rerun this baseline before resuming; do not treat the current run as passing.
- Protocol baseline screenshots captured for all 7 top-level views at 1440x960/390x844. These are partial assessment, not completed polish or verified full interaction. The failed baseline run also captured the library desktop view, new-protocol dialog, import/export panel, and failure state.
- Counts at stop: 11 completed/accepted remaining entries (9 polished, 2 already adequate), 7 protocol entries partially assessed, 95 remaining entries unassessed, plus 5 original reference entries awaiting final regression verification. No application-wide completion claim.
- Still pending: most modules, full dynamic-detail/dialog coverage, final five-screen regression, application-wide checks, final exact-tree validation after all future edits, and squash-apply to unchanged main.
- No backend, schema, integration, authorization, audit, identity, scheduling or reporting-calculation implementation changes. Synthetic fixtures only in the disposable E2E environment.

## Resume authorization

- User explicitly authorized the one-line Protocol Library locator repair and resumption of the full goal.
- Scoped only the test's in-page Protocols click to the existing `Protocol library navigation` container. No assertion, UI label, workflow, or application code changed for this repair.
- Repaired baseline passed (1/1 Chromium test) against a newly migrated/seeded disposable E2E database. The prior stop checkpoint remains historical evidence, not the current decision to abandon remaining scope.

## Protocol batch — current validation checkpoint

- Seven top-level protocol views captured before/after at desktop and phone sizes. Controls reuse shared Button/Input; native selects retain semantics. Scoped compact styling excludes textareas. Tables use muted headers, normal tracking and row dividers. Blue primary actions match the reference screens. Clinical handlers, action placement, columns and dialog geometry are preserved.
- Focused Protocols/Doctor tests: 169 passed after implementation, before the final small hover/keyboard-token cleanup. Targeted Protocols lint passed. Required frontend typecheck and build passed after the final frontend edit (existing bundle warning only).
- Seven after-capture cases passed, and the repaired Protocol Library browser test passed after implementation. Browser screenshots inspected for the library and anatomy desktop/phone comparisons; full editor/state inspection remains pending. This batch is not yet counted complete.
- Existing exam-type browser test exposed an unchanged dynamic-dialog-title mismatch: reopened assigned dialog is “Change assigned protocol.” User authorized widening the dialog locator to the two existing titles. The rerun proceeded through successful keep/clear mutation assertions, then failed at its final assertion because clearing returns the unchanged UI to Saved protocol mode, hiding the free-text field. Main has the same clearing/reset logic. No application behavior or assertion has been weakened.
- Additional proposed test interaction: select Free-text protocol after clearing, then retain the existing empty-value assertion. Awaiting explicit user scope authorization for that addition.
- Preserved local checkpoints: `62688641`, `fe63fc29`, `5c0ac145`. Protocol application changes and exam-test locator remain uncommitted. Main/origin tracking ref remains `50514e038eaf1e8792b89864b3b2854fc27dfccd`; no final squash-apply while validation/scope remain incomplete.

### Batch 3 — Protocol Management complete

- Completed/accepted seven entries: Protocoling, Protocol Library, Import/Export, Anatomy, Scanners, CT phase presets and MRI sequence presets. Scanners informational panel accepted unchanged.
- Fixed inconsistent teal actions, oversized mixed controls, widely tracked table headers, missing row separators, and mobile inline editors wider than the viewport. Reused 31 generic Buttons and 31 Inputs; native selects remain native; textareas retain their height. Six inline table editors now fit the phone viewport while the underlying tables still scroll horizontally. No clinical handlers, columns, critical action positions or permissions changed.
- Browser: seven before/after top-level capture cases at desktop/phone; three preset forms with disabled/enabled save and cancel states; CT/MRI builders at desktop/phone; existing library test verifies dialog focus/Escape, action menu, CT/MRI create entry, navigation and 1024/390 responsive bounds. Real exam-change test verifies saved free text preserved on keep, cleared on clear, and empty after selecting free-text mode. External PACS and request-document content remain synthetic/unconfigured and are not integration verification.
- User authorized both exam-test repairs: dynamic dialog title locator and selecting Free-text protocol before retaining its existing empty-value assertion. Both protocol E2E tests passed 2/2. Final component tests passed 88/88; final frontend typecheck/build passed; lint passed from frontend cwd; harness:ui passed. Existing bundle/jsdom warning output retained. An initial lint invocation from root lacked the frontend config; corrected invocation passed. Temporary MRI capture helper used the wrong Name label; stopped that obsolete run and corrected it to Sequence name; all three final form cases passed.
- Screenshot evidence: `/tmp/rispro-ui-polish-20261022/{before,after,comparisons}/protocol-*`, `after/builder-*`, `protocol-resume-e2e`. Before left/after right in comparisons. No patient-identifiable data.
- Counts: 18 non-reference entries complete (15 polished, 3 accepted), 95 remaining non-reference entries; four of those have initial review-workflow captures. Full goal remains incomplete. Original five regressions and final main squash-apply remain pending.
- Next: populated recall, IR worklist/detail and comparison views, followed by reception operations. Existing real IR baseline passed 1/1 and focused Recall/IR baseline tests passed 35/35. One synthetic recall created through existing disposable APIs.

### Batch 4 — Recall, comparison and IR review complete

- Completed seven entries: core/doctor Additional Imaging Requests; Review Requests list/comparison detail; Doctor IR worklist; core/doctor IR detail. The three IR entries already use the established style and are accepted unchanged after populated, empty and form-state assessment.
- Fixed: recall actions consuming most of the desktop row width and squeezing clinical information; oversized status/filter actions; one-column phone attention filters; inconsistent comparison text fields, selects and textareas. Local compact CSS reuses existing control-height/radius/theme tokens. Native clinical confirmation controls remain unchanged.
- Automatic viewed-status updates produced generic success toasts over patient information. Suppressed only this background mutation's global toast, preserving all calls and seen/audit semantics; its error now appears as an explicit bilingual inline alert. User-triggered action feedback remains unchanged.
- Consequential decision approved: comparison Edit request Save/Cancel rendered outside DialogContent, behind the overlay and outside the focus trap. Moved the existing footer into DialogContent without changing handlers. Browser DOM reports `inDialog: false` before and `true` after; desktop/phone screenshots show reachable actions. New component regression test verifies containment and identical save payload. A preserved baseline was reproduced from unchanged checkpoint source, then the exact current file restored before final validation.
- Browser: initial empty and populated lists; core/doctor IR details; IR preparation, clinical review and eligible appointment-request forms; recall contact/edit/withdraw dialogs and Escape; comparison edit desktop/phone; core Arabic RTL recall/comparison/detail and IR detail. External PACS opening/integration not claimed. Synthetic data only.
- Checks: focused Recall/Comparison/IR tests 45 passed before final footer fix; final affected tests 77 passed including all 44 Registrations tests, plus the new Comparison test file 11/11 passed. Existing real IR workflow baseline 1/1 passed; operation navigation/queue baseline 5/5 passed. Capture cases passed: populated review 5, dialogs 3 plus final comparison rerun 1, Arabic core review 3, Arabic IR 1, and IR state scenario 1. Final typecheck/build, targeted lint, harness:ui, whitespace checks passed.
- Authorized baseline maintenance: operations baseline exposed three unchanged Registrations assertions expecting “Protocol: Not protocolled,” while source/catalog/Modality consistently use “No protocol assigned.” User authorized three assertion text updates; all missing-request and upload assertions retained; repaired file passes 44/44. No Registrations application edit made in this batch.
- Development capture-helper correction: explicitly initialized English for modal tests after the initial helper used the application's default Arabic locale. Corrected helper passes; obsolete waiting run terminated. No application labels renamed to satisfy it.
- Rollback checkpoint follows locally. No push/PR/deploy; main remains unchanged. Counts: 25 remaining-scope entries complete, 88 still to complete (5 initially assessed, 83 unassessed), plus the original five final regressions. No decisions pending.

### Batch 5 — Reception operations complete

- Completed/polished Calendar, Registrations, Queue, Check-in kiosk and No-show Review. Fixed oversized mixed controls, gradient page headings, search-icon overlap, crowded calendar summary labels, queue actions squeezing patient details, kiosk reset contrast and teal gradient inconsistency. Calendar's existing summary column is modestly wider and long modality names wrap fully; existing localized short category labels have full tooltip expansions. No clinical labels are truncated.
- Reused shared Input/SearchInput; consolidated the preceding review stylesheet into opt-in `components/shared/compact-controls.css` for assessed operational workspaces. This stylesheet uses existing tokens and does not change base primitives or apply to the five reference screens. Native calendar cells, range/checkbox controls, forms, scan handlers, action order and booking/no-show authority are preserved.
- No-show Review retains its existing English-only copy. Set LTR content and dialog direction inside an Arabic shell to prevent reversed English punctuation; localized patient names remain supported. This is not a claim of full Arabic translation. Removed implementation jargon from its subtitle while retaining the Action PIN requirement.
- Browser: five before/after desktop/phone cases; five Arabic-preference cases; final English/Arabic calendar capture reruns; no-show reason validation, Escape/focus restoration and zero mutation assertion. Initial no-show dialog check passed with the earlier historical fixture. After the disposable reset removed that extra fixture, two temporary helper runs timed out on the correctly disabled cleanup control; final dialog rendering used an explicitly UI-only synthetic historical candidate via a read-response fixture. It validates UI, not backend eligibility or cleanup execution.
- Test-data isolation correction: the existing Queue journey changes E2E Queue Patient from scheduled to arrived. Rerunning Calendar's scheduled-filter scenario on that reused DB failed twice. Diagnosed the data mismatch, reset only the guarded disposable seed, and reran all five existing Calendar/Queue/Registrations browser journeys in established order: 5/5 passed. No assertion or application workaround was made. Prior review/roster fixture IDs are stale after that reset; historical screenshots/results remain valid evidence from their runs.
- Checks: 137 focused operations/review tests passed; final Calendar delta tests 41/41 passed. Original reference workflow tests 144/144 passed. Exact final frontend typecheck/build passed; lint passed with the two existing Calendar hook warnings; harness:ui passed; whitespace clean. Existing bundle/jsdom warnings retained.
- Five-screen regression: separate detached main worktree at starting SHA, with a separate Vite cache and shared installed dependencies. Captured all five references at desktop/phone against the same synthetic backend. Appointment/Registration pairs are pixel-identical; remaining pairs differ only by tiny dynamic timestamp/aging text (0.007–0.057% of pixels), with matching layout inspected. Evidence: `reference-diff.json`, before/after/comparisons `reference-*`. Main is unchanged. Final reference verification remains required after future changes.
- Source-only existing issue outside this UI task: the historical candidate list's per-row Confirm callback is a no-op; preserved because altering no-show workflow is prohibited. Cleanup and bulk/clinical mutation behavior are not claimed browser-validated. Full No-show Arabic localization also remains a pre-existing limitation.
- Counts: 30 remaining-scope entries complete (24 polished, 6 accepted unchanged), 83 to complete (5 initially assessed, 78 unassessed), plus final verification of the original five. No product decision pending. Next patient-management/search baseline: 24 focused tests passed; merge/dictionary re-authentication and populated states captured safely without patient mutations.

### Batch 6 — Patient management and search complete

- Completed five entries: Patients list (accepted unchanged), Edit Patient header, Patient Merge, Name Dictionary and Patient Search. Shared registration form is unchanged.
- Fixed Search's unreadable dark header/selection, low-contrast identifiers, oversized phone results area and clipped edit actions. Reused Button/Card/Input, preserved selection and all update/delete handlers, and styled the existing destructive action consistently. Save bounds are verified inside desktop/phone viewports. Edit Patient's duplicated Back wording is removed; its route/return behavior is unchanged.
- Merge/Dictionary reuse SearchInput to prevent icon overlap in either direction. Dictionary fields have persistent localized labels; compact styling reuses existing tokens. Merge controls, conflict warnings, identity calculations and confirmation behavior remain untouched. The reused Settings resolver receives only the SearchInput presentation correction and will be assessed in Settings later.
- Browser: five before/after desktop/phone screens; populated Search details/edit/cancel; actual Arabic RTL across five screens; Merge/Dictionary beyond unchanged password re-authentication in English and Arabic; populated dictionary row/edit/cancel using one synthetic token. Apply spellings to patients was never invoked; no real patient mutation or merge occurred.
- Checks: 59 focused tests including shared registration workflow pass; existing patient navigation E2E 2/2 pass; top-level captures 5/5, Arabic 5/5, authorized views 2/2 each language, Search case 1/1 and dictionary row case 1/1 pass. Exact final frontend typecheck/build, targeted lint, harness:ui and whitespace checks pass. Existing build warning retained.
- Temporary capture-helper corrections: used the existing Edit Patient/Save Changes labels; kept row selection stable while editing; prevented reload initialization from resetting Arabic to English. Corrected runs and actual screenshots were inspected; no UI text changed to satisfy a helper.
- Counts: 35 complete (28 polished, 7 accepted unchanged), 78 remain (4 initially assessed, 74 unassessed). Original five passed the prior milestone; final regression remains required. No decisions pending. Next baseline: 66 focused execution/document/override UI tests and 2 Modality navigation E2E tests pass.

### Execution batch — baseline failure checkpoint

- Four localized presentation edits are uncommitted: Modality desktop title/control sizing, Request Scans/Document Ingestion compact controls and readable description, Override Requests compact controls and persistent page-only filter labels. Mobile Modality touch targets and all handlers are preserved. This batch is not complete.
- Targeted run: 169 passed, 1 failed across four files. Failure: `modality-page.test.tsx:820` tries clicking “Scan Paper” with NAPS2 disabled and the retired scanner-app flag enabled. The unchanged shared document panel explicitly sets `scannerAppEnabled = false` and exposes only supported NAPS2 scanning.
- Reproduced the exact failing test in the detached starting-main worktree: 1 failed, 103 skipped by the targeted name filter. Both test and document panel are unchanged by this goal. Log: `/tmp/rispro-ui-polish-20261022/modality-main-baseline.log`. No test/application workaround applied.
- Proposed scoped repair: preserve all clinical-upload assertions, then assert the unsupported Scan Paper action is absent and `createScanSessionMock` is not called. Enabled NAPS2 coverage already exists in Modality and RequestDocumentsPanel tests. User authorization requested under AGENTS rule 6; further implementation stopped pending response.
- Four initial after capture cases passed at desktop/phone, but comparison, populated/dialog/RTL coverage, final targeted checks and exact-tree typecheck/build remain pending. No completion credit added.
- Latest validated rollback checkpoint: `8daf5e69` on local-only `codex/application-ui-polish-goal`; main remains at the starting SHA. No push/PR/deploy or squash-apply.

### Batch 7 — Modality, document operations and overrides complete

- Completed/polished four entries: Modality Board, Document Ingestion, Request Scans and Override Requests. Desktop Modality heading no longer squeezed by the action row; desktop controls use established compact tokens. Previously polished phone touch targets remain unchanged.
- Request Scans/Document Ingestion: readable wrapping description, blue selected tab, consistent compact buttons/fields/dialogs, muted row dividers, and existing SearchInput fixes assignment search-icon overlap. Native table scrolling, actions, assignments, scanner/PACS/export handlers and dialog geometry remain unchanged.
- Override Requests: localized persistent page filter labels and compact controls. Drawer accessible names and filter behavior retained; no approval/rejection authority, validation, re-authentication or scheduling rules changed. Existing English-only summary/action copy inside Arabic layouts remains a localization limitation.
- User authorized the stale Modality test repair: preserved all upload assertions; asserts Scan Paper absent and retired scanner-session API not called when NAPS2 is disabled. Existing enabled-NAPS2 tests retained. Reproduced old failure on starting main before repair; historical failure checkpoint above is resolved.
- Browser: four initial after desktop/phone cases, two populated modality/document cases, four actual Arabic cases, three populated synthetic read-fixture cases before/after (including assignment/archive dialogs and rejection forms), three Arabic synthetic cases, and two existing real Modality navigation/deep-link E2E tests pass. Read fixtures explicitly assert zero workflow mutation requests. External scanner, archive and PACS integrations are not validated by these fixtures.
- Capture-helper correction: narrowed an overbroad interception matching a Vite module URL; rejected blank captures, terminated those two temporary runs and reran successfully. Corrected an unsupported helper assumption that blank rejection disables its button; verified empty required reason without submitting instead. No app behavior changed to satisfy helpers.
- Checks: 170 focused tests pass; final Request Scans styling delta 44/44 pass; exact final frontend typecheck/build pass; targeted lint passes with one existing hook warning; harness:ui and whitespace checks pass. Existing build/jsdom warnings retained.
- Five references recaptured against starting main with current synthetic data: ten viewport pairs have matching dimensions; Appointment/Registration/Scheduling pixel-identical, others differ only by dynamic clock text (0.009–0.022%). Earlier reporting discrepancy was stale fixture data; fresh matching-data pairs resolve it. Final reference checks still required after future shared edits.
- Counts: 39 complete (32 polished, 7 accepted unchanged), 74 remain (5 PACS/monitoring initially assessed, 69 unassessed). No product decisions pending. Next baseline: 115 PACS/remap/Orthanc/monitor component tests and five initial capture cases pass.
- Rollback checkpoint follows locally on retained goal branch; no push, PR, deployment or main squash-apply.

### Batch 8 — PACS administration and MWL monitoring validated

- Five entries polished: PACS Search, DICOM Remap, comparison-linked Remap, Authoritative Orthanc Operations and MWL Monitor. Reused 38 Buttons, 7 Inputs and the shared Card shell. Native file/folder selectors, clinical acknowledgments, wizard controls, history selectors and domain-specific non-modal monitor drawer remain local.
- Fixed inconsistent teal remap styling, oversized controls, unassociated PACS form labels, low-contrast result descriptions and truncated operational metric values. Orthanc metric grid uses four columns until the wide breakpoint; full values wrap. Existing English-only Orthanc/monitor content now explicitly LTR inside either shell language; this does not claim Arabic localization. Remap and PACS search retain actual Arabic RTL support.
- Populated browser inspection found MWL drawer Close hidden under the z-50 application header. Raised the existing drawer from z-40 to z-70 without moving actions or changing its non-modal layout. Before capture and intercepted-pointer log reproduce the problem; after desktop/phone Close clicks pass.
- Remap preview produced generic “Task completed” before sending anything. Suppressed only its global preview toast; local scan progress/completion and preview error messages remain. No clinical remap/send/identity calls or logic changed. Phone review comparison now wraps full original/replacement values within the existing three-column table, with muted dividers and header. Warning, file review, confirmation checkbox and disabled send behavior remain.
- Browser: five before/after top-level desktop/phone cases; five Arabic-preference cases (actual RTL for PACS/remap; explicit English/LTR for monitoring); four populated synthetic fixture cases before/after; two actual Arabic remap/comparison cases; existing Orthanc browser scenarios 2/2 pass before and after. Synthetic DICOM headers parsed locally in the real browser through Source, Patient, Destination and Review; comparison patient lock verified. Preview/replacement/search responses mocked explicitly, no remap/send/remote integration execution claimed. Monitor Orthanc/Sante previews and Close verified.
- Capture corrections: changed a helper locator to the actual patient result text; rejected that failed baseline helper. Initial monitor helper exposed the real stacking bug, then baseline capture navigated away solely to inspect the second tab; current helper requires normal Close clicks. One styling edit helper used the wrong working directory and made no changes; reapplied with absolute paths. Sticky header positions in full-page stitched captures are screenshot artifacts, not a page-layout defect.
- Checks: 115 focused component tests pass; final Remap delta 85/85 pass. Exact final frontend typecheck/build pass. Targeted lint, harness:ui and whitespace checks pass; existing build/jsdom warnings retained. Shared base primitives unchanged; five-reference regression remains valid from batch 7 and requires final recheck after future work.
- Counts: 44 complete (37 polished, 7 accepted unchanged), 69 remain (4 printing screens initially assessed, 65 unassessed). Batch 7 rollback commit is `16c292b0`. Batch 8 validated source is uncommitted because the next baseline exposed unrelated failures before its checkpoint commit. Main remains unchanged at `50514e03`; no push/PR/deploy or squash-apply.

### Printing baseline — required stop

- Before any printing application edit: 43 passed, 5 failed across five test files. Two unchanged test files fail due stale text expectations after existing localization. All five failures reproduced in the detached starting-main worktree: autoprint targeted case 1 failed/13 filtered skips; ReportCenter 4 failed/13 passed.
- Proposed test-only updates: autoprint list assertions use `print.reportCenter.title` and `print.reportTemplate.daily-appointments.title`, matching that file's existing translation-key mock; ReportCenter expectations use existing “Daily appointment list,” “No-show,” “Grouped by: Exam” and “Case Category.” No print/audit/filter/disabled-output assertion removed or weakened. Approval requested under AGENTS rule 6; no repair applied yet.
- Logs and initial printing captures remain in the external artifact directory (`print-baseline-vitest.log`, `print-main-baseline.log`, `report-center-main-baseline.log`, before `print-center`, `day-list-print`, `reporting-print`, `workstation-printing`). Those four screens are assessed only, not complete.

### Printing baseline repair authorized and passed

- User authorized the six scoped expectation updates. The localized audit-template expectation was scoped to its table cell because the same label legitimately appears in a heading and option; this preserves the audit-row readiness check. All original printing, audit, filter and disabled-output assertions remain. Repaired baseline: 48/48 pass. No printing application change made for these repairs.
- Added the separately navigable appointment-slip preview (`/print?appointmentId=:id`) discovered during actual print routing assessment. Inventory now 119 total entries: 5 references and 114 remaining-scope entries. Completion stays 44; 70 remain. No screen silently excluded.
- Next batch: Report Center, appointment preview, day-list output, reporting-board output and workstation printing/scanning. Internal slip/registration renderers follow separately. Report Center phone clipping is a concrete priority; external printer/scanner integration remains outside browser fixture claims.

### Batch 9 — Primary printing and workstation UI complete

- Five entries polished: Report Center, appointment-slip preview, day-list output, reporting-board output and workstation printing/scanning. Report Center grid/cards now constrain intrinsic table width so phone controls, filters, columns and all output actions stay visible; only the data table scrolls. Reused shared Input and compact controls; labels use normal clinical typography. No output filters, templates, column permissions, audit calls or printing/scanning handlers changed.
- Slip preview now uses the configured A5/A4 paper dimensions inside its existing scroll container. Previously the fixed-width RTL paper began at negative x in a narrow iframe, clipping fields; now the full sheet is aligned within the iframe and the outer container supports horizontal panning. Underlying generated slip HTML is unchanged. Browser geometry checks cover A5/A4 in both shell languages.
- Day-list/reporting output: consistent blue brand/header colors, readable normal header tracking, responsive on-screen header and horizontal table scrolling without changing the A4 landscape printed table. Reporting output and workstation setup retain existing predominantly English content with explicit LTR direction; day-list output retains actual Arabic RTL. Existing raw category/status codes in some output fields remain a localization limitation.
- Browser: five after desktop/phone cases and five Arabic-preference cases; appointment preview before/after; two populated control scenarios verify all five output buttons within the viewport, grouped/patient reports, paper geometry and advanced workstation diagnostics. No physical print, scanner test, setup installation, mapping save or clinical mutation was invoked. Existing autoprint/audit component checks remain intact.
- PDF evidence: applied PDF skill; generated four before/four after Chromium A4 landscape PDFs (day-list/reporting, English/Arabic), rendered via native PDFKit because Poppler is unavailable. All eight are one page; latest four PNGs visually inspected without clipping/overlap. Synthetic accession sets match: 15/15 day-list and 8/8 reporting in each language. Artifacts stay outside tracked source in `pdf/`, with `comparison.json`; these are UI/output evidence, not physical-printer verification.
- Checks: repaired baseline and final focused suite 48/48 pass; final affected ReportCenter 17/17 and preview 14/14 reruns pass. Exact final frontend typecheck/build pass; targeted lint and harness:ui pass; whitespace clean. Existing jsdom navigation/build warnings retained.
- Development corrections: localized audit label occurs in multiple places, so scoped the authorized expectation to its actual table cell; removed unsupported Testing Library `exact` option caught by TypeScript. Corrected uppercase paper-size comparison to the existing lowercase type. Corrected the A4 read fixture to the existing nested setting-value shape; final A4/A5 browser geometry checks pass. Capture comparison helper now tolerates changed full-page dimensions. None of these failures was hidden or reported as passing before correction.
- Counts: 49 complete (42 polished, 7 accepted unchanged) of 114 remaining-scope entries, 65 remain (3 reporting/document entries initially assessed, 62 unassessed), plus final five-reference verification. PACS rollback checkpoint `0ca06b02`; printing checkpoint follows locally. No decisions pending, no push/PR/deploy or main squash-apply.
- Next: saved reporting view, Personal Reporting Desk, its case documents and the two internal print renderers. Next component baseline: 90/90 mobile/reporting-document tests pass; initial three route captures pass with real synthetic saved token and assigned case.
