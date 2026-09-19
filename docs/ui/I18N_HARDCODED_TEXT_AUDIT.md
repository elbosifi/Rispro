# Frontend hardcoded-text audit

Status: completed for the Settings/re-auth hardening scope. This inventory is intentionally separate from the translation catalog: an English-looking string is not automatically a translation defect.

## Method

The audit covered `frontend/src` and the Settings route surface. The initial static pass found 1,342 JSX text candidates matching `>[A-Za-z][^<{]*<`, including tests, snapshots, technical identifiers, and runtime values. A second pass found 412 candidates under `frontend/src/pages/settings`. These are heuristic counts, not a count of untranslated copy.

Each candidate is classified using the following rules:

| Class | Meaning | Treatment |
| --- | --- | --- |
| Localized UI copy | A label, heading, action, helper, status, error, or accessible name shown to a user | Must use `useLanguage().t(...)` and have English/Arabic catalog entries |
| Technical/protocol copy | DICOM tags, AE titles, URLs, route aliases, query keys, code values, vendor/product names, or protocol literals | Retain the canonical value; do not translate identifiers |
| Runtime/domain data | Patient/report names, server-provided error text, configured descriptions, database values, or API status values | Render the value supplied by the domain/API; localize surrounding UI copy |
| Test-only/documentation | Assertions, fixtures, snapshots, migration notes, or developer-facing examples | Not part of the runtime translation surface |
| Intentional English scope | Content explicitly rendered inside `EnglishLanguageScope` | Retain English by contract and document the scope |

## Findings and changes

The Settings menu had 14 section labels bypassing the catalog, including Patient Import, Patient Duplicate Resolver, Passkey Configuration, Appointment Slip Settings, Printing → QZ Tray, SonicDICOM Reports, OHIF Viewer, Action PIN Policy, Sante Worklist Server, System Diagnostics, Request Scan Automation, Email & Notifications, and Authoritative Orthanc. All Settings section labels now resolve through `settings.section.*`; the Arabic catalog has a matching entry for every Settings menu section.

The re-authentication modal had two English-only controls and exposed the backend's raw unauthorized message. Passkey/password guidance and invalid-credential copy now use the catalog, with matching interpolation-free English and Arabic entries.

The PACS Settings surface had two CD Robot labels outside the catalog. They now use `settings.pacs.cdRobot` and `settings.pacs.cdRobotDestination`. The PACS re-auth prompt also now retains the actual `auto-completion-settings` query key that produced the protected response.

The catalog parity test now checks:

- exact English/Arabic key-set parity;
- the catalog size and stable hashes;
- placeholder parity for every key; and
- representative Settings and re-auth entries in both languages.

## Intentional retained literals

The remaining heuristic candidates are classified rather than mass-replaced. Examples include `StudyInstanceUID`, `SeriesInstanceUID`, `AET`, `rispro_route_`, `QZ Tray`, `SonicDICOM`, `OHIF`, Orthanc, URL/host/port examples, DICOM status values, user-entered/configured values, and test-only assertions. Translating these would change a protocol identifier, a configured value, or test semantics. Components using `EnglishLanguageScope` are also retained in English by design.

## Verification targets

The focused regression coverage is in `frontend/src/pages/settings/settings-page.reauth.test.tsx` and `e2e/specs/i18n-reauth-settings.spec.ts`. The browser coverage verifies English and Arabic/RTL Settings surfaces, a 390×844 mobile viewport, URL preservation, cancellation, invalid-password retention, password continuation, passkey continuation, and active protected-query refetching.
