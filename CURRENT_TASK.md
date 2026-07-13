# Current Task

## Task

- One sentence: Deploy OHIF infrastructure automatically through supported Docker setup/update scripts while retaining Settings → Integrations → OHIF Viewer as the database-backed operational launch control.
- Scope: Compose profile seeding, emergency deployment override, deployment summary, deployment/operations/rollback documentation, and focused shell/Compose validation.
- Out of scope: Production data, PACS/DICOMweb configuration changes, OHIF clinical workflow redesign, application Docker access, and removal of the database-level launch check.

## Inspection

- Current behavior: Setup/update preserve `OHIF_ENABLED` from `.env` and derive `COMPOSE_PROFILES` from it. An existing `OHIF_ENABLED=false` therefore omits the `ohif` profile on updates, even though the database Settings UI is the intended operational control.
- Database control: `ohif_viewer_settings.enabled` defaults to false and viewer launch retains selected-PACS validation.

## Plan

- Supported setup/update writes `OHIF_ENABLED=true` and `COMPOSE_PROFILES=ohif` unless the clearly named emergency `OHIF_INFRASTRUCTURE_DISABLED=true` override is present.
- Preserve `OHIF_CACHE_CLEANUP_ENABLED=false` as the generated default, retain diagnostics/routes, and document normal versus emergency rollback.
