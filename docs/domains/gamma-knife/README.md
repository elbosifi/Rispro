# Gamma Knife V1

Gamma Knife adds one patient list, a five-tab episode profile, settings, and a patient QR page. It reuses RISpro patients, users, document storage, Appointments V2, shared UI controls, and audit writing. There is no separate scheduler, workflow engine, form builder, or notification system.

## Code map

- Backend: `src/modules/gamma-knife/gamma-knife-routes.ts`, `gamma-knife-service.ts`, `gamma-knife-validation.ts`, `gamma-knife-types.ts`.
- Frontend: `frontend/src/pages/gamma-knife/`.
- Persistence: `src/db/migrations/234_gamma_knife.sql` adds episode, immutable history, and document-link tables; user permission flags extend `users`; configuration uses `system_settings`.
- Shared integrations: `src/services/document-service.ts`, `src/services/settings-service.ts`, `src/app.ts`, `frontend/src/App.tsx`, and the Doctor Workspace launcher.
- Design: [minimal design and task plan](../../plans/active/gamma-knife-v1.md).

## Initial setup

Apply migrations through the normal authorized deployment process. A RISpro supervisor or super administrator opens `/gamma-knife/settings` to assign existing users, configure diagnosis document checklists/consultant names, select distinct treatment and follow-up RISpro exam types, and set patient-document visibility. No users receive module access automatically. Administrators can manage setup without gaining clinical episode access.

Internal clinical routes require the `access` flag plus the relevant action flag: referral, clinical, MDT, treatment, scheduling, or documents. Existing administrators retain settings authority. Navigation visibility is not API authorization. Revocation and user deactivation are checked on subsequent requests.

The standard form requires history, examination, imaging information, and assessment on submission. Prior treatment can be marked unavailable; a category-labelled additional clinical information section can be enabled. The module ships with the neutral Other category and no diagnosis checklist content. Clinicians configure approved checklists; this is not a clinical decision-support system or a form designer.

All four interfaces use the existing English/Arabic language provider, with RTL layout, localized names/statuses/permissions, keyboard-accessible profile tabs, and stage-appropriate next-step navigation. A read-only staff member can review the episode without being offered edit or administrator actions.

## Workflow

One active episode is enforced in PostgreSQL. Provisional assessments permit discussion; finalized assessments are required for official MDT outcomes. Responsible consultants can be selected or entered without accounts. Additional-information decisions return through operations receipt and clinical review. MDT corrections before treatment completion require a reason, retain the prior version, and invalidate readiness.

Provisional MDT cases point back to clinical finalization as their next action. Editing an assessment returns it to clinical review. Collaborative draft refreshes do not roll back a successful save's revision or overwrite pending local edits. Missing treatment reports link directly to the Documents tab with the report category selected.

Schedule/reschedule using existing RISpro, then link the patient's matching booking in the episode. Linking does not create bookings or bypass V2 capacity/identity checks. Treatment links may be tentative or confirmed. Postponement preserves the reason and hides the postponed appointment from the QR page; staff still update/cancel the actual booking through RISpro.

Consent, imaging, clinical readiness, and notes are required to mark ready. Treatment completion requires explicit clinical confirmation and records date, frame/mask, fractions, and team. Documentation can remain report-pending; finalization requires an episode treatment report. Follow-up visits, complications, actions, and appointments remain in the episode. Upcoming/overdue labels use the Tripoli date and configured reminder window. Authorized clinical staff may explicitly close follow-up, with a reason, after treatment documentation is finalized; treatment completion alone does not close it.

Episode history is retained even when general audit logging is disabled. Clinical drafts use expected revisions to avoid lost updates. There are no episode deletion endpoints. Generic document retrieval and bulk deletion exclude Gamma Knife files; episode-scoped retrieval enforces assignment.

Gamma Knife uploads retain a Unicode display basename in document metadata, including Arabic names. The shared storage filename/path sanitization is unchanged.

## Patient QR access

Configure RISpro's existing public app base URL before issuing QR codes. Issue/replace/revoke in the Documents tab. The raw link is returned only at issue time; only its hash is stored. Tokens use URL fragments and authorization headers rather than query strings. Public responses are non-cacheable and contain only progress, confirmed future appointments, preparation/actions, and explicitly released routine documents.

**SMS integration is deferred at the user's explicit request. Sensitive documents remain inaccessible through the public page**, even when marked released. Internal notes never publish automatically. Revocation, release state, and category policy are rechecked for downloads. QR rotation invalidates the old credential.

New releases are restricted to routine categories while verification is deferred. Preparation instructions/actions are shown only during preparation/treatment, so they do not remain as stale instructions after completion. Allowed documents open through the existing Blob-based PDF/image preview in a shared Dialog; no authenticated generic-document URL or native PDF plugin is required.

## Validation

- Unit validation: `node --import tsx --test src/modules/gamma-knife/gamma-knife-validation.test.ts`.
- DB workflow: `npm run db:test:required -- src/modules/gamma-knife/gamma-knife.integration.test.ts`, following [DB testing rules](../../CODEX_DB_TESTING.md). If the current Windows wrapper exits without executing its main function, use the same documented preflight/start/check sequence and `npm run test:db:one -- src/modules/gamma-knife/gamma-knife.integration.test.ts`; do not count a wrapper-only exit as test proof.
- Frontend autosave: `npm --prefix frontend test -- src/pages/gamma-knife/clinical-editor.test.tsx`.
- Focused English/Arabic integration: `npm --prefix frontend test -- src/pages/gamma-knife/use-gamma-knife-text.test.tsx`.
- Browser: `npm run e2e:db:up`, `npm run test:e2e -- e2e/specs/gamma-knife.spec.ts`, then `npm run e2e:db:down`. Uses guarded synthetic fixtures and captures list, settings, all tabs, and public page at desktop/mobile widths.
- Run backend/frontend typechecks, frontend production build, and harness checks under the [operating rules](../../agents/RISPRO_OPERATING_RULES.md).

Database and browser proof covers active-episode uniqueness, assessment guards, all MDT outcomes, investigation return, appointments/readiness/postponement, completion/report finalization, follow-up, permissions, document isolation, public visibility, and QR revocation. No production data or real SMS delivery is exercised.

The shared `frontend/src/lib/i18n.test.ts` has a previously confirmed stale catalog-count/hash baseline. It is left unchanged under explicit user instruction; do not describe the full frontend suite or CI as passing from the focused Gamma Knife results.
