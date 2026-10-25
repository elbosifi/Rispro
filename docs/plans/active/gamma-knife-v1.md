# Gamma Knife V1: Minimal Design and Task Plan

Status: patient journeys validated locally; manual review pending. Updated 2026-10-26.

## Current Arabic/UI polish status

The user requested Arabic/RTL, page polish, and clearer workflow guidance after the initial implementation. Local changes now use the existing language provider/catalogs, localized patient/exam names, stable tab identifiers across language changes, keyboard-accessible tabs, a next-step action, explicit MDT decision selection, and clearer read-only/permission feedback. SMS remains deferred. Public preparation instructions are limited to preparation/treatment stages; sensitive documents cannot be released while verification is unavailable.

The user explicitly authorized continuing Gamma Knife polish while leaving the pre-existing shared translation snapshot failure unchanged. That test expects 3,566 keys and older hashes; unchanged HEAD contains 3,791 English and 3,791 Arabic keys. Its unchanged-HEAD hashes are `4cc6ea9817bc8bf6b1db8f3daf62a5015e62c99453ca6ea2cb30c063d1b84937` (English) and `21bb80d6f2865ce243c81dc9a420b90882ca829f6c6648e3a5cad9009a3bfa19` (Arabic). The shared snapshot test has not been changed; its two snapshot assertions still fail, while its other five tests pass. Gamma Knife translations have their own focused catalog/behavior coverage.

Current-tree proof: backend typecheck, frontend typecheck, and frontend production build PASS. Focused frontend tests PASS (7/7), backend input-validation tests PASS (3/3), and disposable-DB workflow/access tests PASS (8/8). Chromium journeys PASS (3/3), including English, Arabic/RTL, mobile, actual PDF rendering, and assigned view-only staff. Focused lint PASS with no warnings. Agent contract and repository harness PASS; harness warnings are report-only baseline findings. The disposable E2E container was removed after validation. Changes remain uncommitted; CI and deployment have not run.

## Patient journey review

| Journey | Verified behavior | Result |
| --- | --- | --- |
| English staff and patient | Referral using an existing patient; draft/provisional/finalized assessment; official MDT and named consultant; consent/imaging/readiness; live RISpro scheduling handoff with the correct patient and linking existing synthetic bookings; explicit treatment completion with report pending; report upload/finalization; follow-up visit/next appointment; routine patient document; QR revocation. | PASS |
| Arabic staff and patient | Arabic names, RTL, settings feedback, required-field rejection without losing entered text, provisional/finalized guidance, language switch without losing the selected tab, consultant directory, requested-investigation receipt and clinical return, MDT approval, postponement/re-confirmed readiness, clinical completion, Arabic document names, follow-up, keyboard tabs, mobile views, patient QR and revocation. | PASS |
| Assigned view-only staff | Arabic episode review without edit/settings actions; direct clinical mutation rejected with HTTP 403. Unassigned module access is also rejected in the English journey. | PASS |

The calendar test opens the real existing RISpro scheduling page with the episode's patient. Appointment-link validation uses synthetic existing V2 bookings; this task does not claim a rerun of the full scheduling creation/capacity suite.

Gaps reproduced and fixed:

- A completed autosave could roll back to the parent's stale revision; an untouched draft could retain a colleague's old text. Synchronization now adopts only current/newer server versions when no local edit/save is pending, preserving conflict detection and unsaved edits. Both failures were reproduced before the fix and now have regression tests.
- Provisional MDT cases now direct staff to finalize the clinical assessment. Editing a submitted assessment returns the episode to clinical review rather than leaving a draft in the MDT queue.
- Arabic filenames now remain readable as document display metadata; the existing shared store retains its safe on-disk filename. File-selection feedback is localized.
- Missing treatment reports have a direct Documents handoff with the treatment-report category selected. Replacing a finalized report is a separate disclosure. Read-only and missing-appointment explanations reflect the actual stage/permission state.
- Patient documents no longer rely on a blank native-viewer tab. The page reuses RISpro's Blob-based PDF/image preview and shared Dialog. Browser tests verify the exact uploaded PDF bytes, a rendered canvas, mobile layout, and localized close controls.
- Settings save feedback clears after a new edit. Settings navigation is shown only to eligible administrators and assignment changes refresh navigation.

Browser evidence is retained under `test-results/` in the Gamma Knife journey output directories: desktop/mobile settings, lists, all profile tabs, public pages, the scheduling handoff, and English/Arabic mobile document previews. The preview uses the existing synthetic `e2e/e2e-request.pdf` fixture. No production patient data or SMS delivery was used.

This revision replaces the expanded design and nine-milestone plan with the user's minimal scope.

## Implementation principle

Reuse RISpro for everything except Gamma Knife-specific clinical information and workflow. Build one patient list, one patient profile, one settings page, and one simple patient QR page. Implement predefined status changes in ordinary backend code.

Reuse patients, users, authentication, permissions, document storage, Appointments V2, shared UI controls, and audit infrastructure. Do not introduce a workflow engine, permission framework, form builder, task-management platform, separate calendar, or new notification system.

## Four interfaces

### Patient list

One searchable list with filters for Referrals, Clinical Review, MDT, Preparation, Treatment, and Follow-up. Keep previous/closed episodes accessible from the same interface. Show patient identity, diagnosis, current status, next action, and relevant appointment date. New referrals appear in the shared clinical/resident queue.

Receptionists, operations managers, and authorized doctors register referrals through existing patient selection/registration, with demographics/contact and provisional diagnosis. Show a short diagnosis-specific document checklist. Enforce one active episode per patient while retaining previous episodes.

Upcoming/overdue follow-up can be a label or filter in this list. No separate role dashboards or elaborate task/reminder system.

### Patient profile

Show patient identity, current episode/history, a simple progress indicator, and two clear lines above the five tabs:

> Current status: MDT Review  
> Next action: Record MDT decision

| Tab | What staff do |
| --- | --- |
| Clinical | Enter history, examination, prior treatment, imaging information, and assessment. Use one standard form with a few fixed diagnosis-specific sections. Autosave drafts; submit as Provisional or Finalized for MDT. |
| MDT | Review the clinical summary, edit the MDT assessment, and record decision, responsible consultants, and requested investigations. |
| Treatment | Complete the basic preparation checklist, use RISpro scheduling, record postponement or treatment, and attach the report. |
| Documents | Upload and organize files using RISpro storage; show diagnosis checklist and patient visibility. |
| Follow-up | Record condition/symptoms, imaging response, complications/severity/actions, and the next RISpro appointment. |

Use collapsible clinical sections, existing shared controls, and minimal navigation. Authorized clinical team members can edit drafts. Show saving/saved/failed/conflict feedback and prevent stale autosaves from overwriting newer work. Essential fields are required; other information may be explicitly marked unavailable.

### Settings

One straightforward page for assigned users and necessary action permissions, diagnosis categories/document checklists, limited standard-form options, MDT consultant names, scheduling access, document visibility, QR/SMS configuration, and follow-up reminder window.

Extend existing RISpro user/permission administration and settings storage. Add simple assignment/action flags only where necessary. Do not add custom roles, capability bundles, permission inheritance, or a separate membership-management framework. Existing role-page visibility controls navigation only; backend authorization must also enforce Gamma Knife assignment and action permission.

Implement the standard form and diagnosis sections in code. Settings may enable supported options; they cannot design arbitrary forms or transitions. Clinical staff supply the required fields and checklist content.

### Patient QR page

Show progress, confirmed appointment information, required actions/preparation instructions where applicable, and allowed documents. Clearly distinguish treatment from follow-up appointments. Tentative or cancelled appointments must not appear as confirmed.

Use one replaceable/revocable QR credential per episode. Routine allowed documents can be viewed directly. SMS verification is deferred by the user's implementation instruction; sensitive documents remain unavailable publicly. Administrators control category visibility. Internal clinical/MDT working notes must not be automatically published.

Replacing/revoking the QR invalidates old access. Do not expose credentials, internal notes, or storage paths in public responses/logs. If SMS is requested later, verification must use short expiry, bounded attempts/resends, the recorded patient phone, and no sensitive access when verification fails.

## Fixed workflow and mandatory safeguards

| Action | Result / safeguard |
| --- | --- |
| Register referral | Enter shared clinical review queue; database prevents two active episodes for one patient. |
| Submit provisional assessment | Available for MDT discussion, clearly labelled provisional. |
| Finalize assessment | Required before the official MDT treatment decision; retain the submitted version. |
| MDT: Approved | Move to preparation; record authorized recorder, responsible consultant(s), assessment version, and time. |
| MDT: Additional information required | Show requested items for operations follow-up within the same list/profile; received information returns the case to clinical review. |
| MDT: Deferred | Remain pending MDT. |
| MDT: Not suitable | Close active episode and retain history. |
| Schedule treatment after approval | Use Appointments V2 and its identity, eligibility, capacity, override, and audit safeguards. Scheduling alone does not establish readiness. |
| Confirm readiness | Authorized staff confirms consent, required imaging, clinical readiness, and preparation notes before marking ready. |
| Postpone treatment | Keep episode active; preserve reason and appointment history; reschedule through RISpro. |
| Confirm treatment completion | Authorized Gamma Knife staff records clinically confirmed date, frame/mask, fractions, completion status, and team members. |
| Finalize documentation | Require treatment report. Treatment completion may already be recorded while the report is pending. |
| Record follow-up | Keep visits in the original episode after treatment; use separate follow-up appointments through RISpro. |

Consultants may be selected from a simple directory or entered manually; they do not need RISpro accounts. Preserve recorded names with the decision.

Enforce safeguards on the server, including direct API calls. Corrections retain previous values, actor, time, and reason. Reuse transaction-aware audit writing and retained clinical versions; mandatory history must remain available even when general audit logging is disabled.

Only assigned users can access internal Gamma Knife content. Apply consistent authorization to existing document list/download/delete paths as well as module routes. Public retrieval checks document visibility and episode scope, including after revocation or policy changes.

## Small implementation footprint

Persist only the episode linked to the existing patient, clinical assessment versions, MDT decisions, treatment records, follow-up visits, and necessary links to RISpro appointments/documents. Keep the small amount of episode-specific visibility and QR/SMS verification state needed for secure access.

Store checklist answers, consultant/team name snapshots, investigation requests, and complications within their owning clinical records when separate tables are unnecessary. Do not prescribe a table per checklist item, participant, complication, permission, or event. Use existing settings and audit storage; add history storage only where existing audit and clinical versions cannot meet the mandatory requirement.

Keep backend code under `src/modules/gamma-knife/` and frontend pages under `frontend/src/pages/gamma-knife/`. Start with one route file, one service, and necessary database access code following repository conventions. Split only when actual responsibilities or size justify it. Reuse existing API/error handling and shared UI primitives.

| Reuse | Existing integration point |
| --- | --- |
| Sessions / users / authorization | `src/middleware/auth.ts`, `src/services/user-service.ts` |
| Patient registration/selection | `src/routes/patients.ts` |
| Documents | `src/services/document-service.ts`, `src/routes/documents.ts` |
| Scheduling | `src/modules/appointments-v2/`, `frontend/src/v2/appointments/` |
| Audit | `src/services/audit-service.ts` |
| QR patterns / shared controls | `src/modules/appointments-v2/public/utils/`, `frontend/src/components/shared/` |

Source inspection did not identify an existing SMS delivery service. The user explicitly deferred adding it during implementation. No SMS provider or OTP bypass is included.

## Short implementation task list

1. **Build the internal episode flow.** Add necessary persistence and existing-permission extensions; deliver the list, five-tab profile, and simple settings. Include referral, clinical drafts/finalization, MDT outcomes/investigation return, and retained history.
2. **Connect RISpro functions.** Wire document storage/visibility, treatment and follow-up scheduling, readiness, clinical completion/report pending, and follow-up records. Keep reminder indications in the patient list.
3. **Complete QR access and validate.** Add the minimal public page, replacement/revocation, and focused end-to-end proof of staff and patient flows. Keep sensitive content blocked while SMS is deferred.

This is a practical build order, not a separate multi-milestone platform project. The user authorized implementation with “proceed”; changes remain uncommitted for manual review.

Resolve concrete inputs as needed: approved clinical fields/diagnosis sections, existing-user access grants, treatment/follow-up calendar mapping, document visibility, SMS provider/configuration, and when follow-up can be closed to allow a new episode. Do not build configuration subsystems to avoid choosing these values.

## Acceptance and validation

Prove referral -> clinical -> MDT -> preparation -> treatment -> follow-up, plus the investigation return, deferred/not-suitable outcomes, and postponement. Verify one active episode under concurrent registration, collaborative draft protection, finalization/readiness/completion guards, report-pending handling, consultant accountability, retained corrections, and internal document authorization.

Verify QR progress/confirmed appointments, routine versus sensitive documents, failed/expired SMS verification, cross-episode denial, revocation, and exclusion of working notes. Check all four interfaces at desktop/mobile widths using synthetic data.

For implementation, follow [operating rules](../../agents/RISPRO_OPERATING_RULES.md), [DB testing](../../CODEX_DB_TESTING.md), and [browser testing](../../E2E_PLAYWRIGHT.md). Run focused tests first; use the disposable DB flow for DB changes; rerun unchanged commands outside the sandbox when blocked. After the final frontend edit, run both `npm run typecheck:frontend` and `npm run build:frontend`. Report CI and unrun checks accurately.

Leave changes uncommitted and report exact Git status. No deployment is authorized. See the [Gamma Knife domain guide](../../domains/gamma-knife/README.md) for implemented behavior, setup, and validation commands. The additive migration and clinical history must be retained once populated; disabling assignments/QR access contains exposure without deleting clinical data.

Excluded from V1: GammaPlan, planning/dose calculations, machine QA/physics, external referral portal, advanced analytics, and AI clinical decisions.
