# RISpro Operations Widget

The Scriptable widget shows operational counts only. It never receives patient records, names, identifiers, reports or appointment details. Tapping it opens `/queue` using normal browser sign-in.

## Install

1. Sign in to RISpro as an active supervisor or super administrator.
2. Open Settings → Mobile Widget Access → Add device.
3. Name the device (for example, `Seraj iPhone`) and choose 30, 90, 180 or 365 days. Complete the existing supervisor re-auth prompt if requested.
4. Copy the one-time token. Closing the dialog removes it from the UI; RISpro cannot recover it.
5. Install Scriptable on the iPhone and create a new script with the complete contents of [rispro-operations-widget.js](rispro-operations-widget.js).
6. Run it in Scriptable and select **Configure**. Enter the HTTPS RISpro origin (for example, `https://rispro.example`) without a path, then paste the token into the secure field. It is stored in Scriptable Keychain, never in source code or cache JSON.
7. Run **Preview** once to check connectivity.
8. Add a Scriptable Home Screen widget, select this script and choose small, medium or large. Optional parameter: `all`, `CT`, `MRI`, `US`, or another exact modality code. Unknown parameters safely show all modalities.
9. On supported iOS/Scriptable versions, add an accessory rectangular, circular or inline Lock Screen widget and select the script.

Keep the HTTPS site reachable from the iPhone through your approved network/VPN. Do not disable certificate validation. For a second RISpro site, copy the script and change `KEYCHAIN_KEY` to a distinct value before configuring it.

## Refresh and availability

The script requests a refresh after 15 minutes; iOS decides the actual time. Repeated runs within that interval reuse the last aggregate response. There is no background polling loop.

Successful data shows its original Tripoli date and update time. Offline fallback is marked stale. A missing cache shows an unavailable state. Unknown schemas say to update the script. An authentication failure discards the cache and asks for a new credential. Rotation/revocation prevents future server reads immediately; already displayed aggregates can remain on the phone until iOS next runs the widget.

Small shows today's total, waiting and scanning. Medium adds up to three modality rows and oldest wait; large shows up to eight rows and waiting thresholds. Accessory layouts are compact. A modality parameter limits the displayed counts to that modality; overall waiting alerts are omitted because they are not modality-specific.

## Rotate or revoke

Use **Rotate token** to replace a credential. Confirm and re-authenticate if asked, then copy the replacement once. Run the phone script → Configure and enter the replacement. The previous token stops working immediately. Rotation creates a new record and marks the previous one revoked, preserving audit history.

Use **Revoke access** for a lost/retired device. Expired or revoked tokens cannot fetch data. Tokens also fail if their creator becomes inactive, loses supervisor/admin eligibility or must change their password. Last-used tracking is updated at most once per five minutes.

## API contract (schema version 1)

`GET /api/mobile/operations-summary` requires `Authorization: Bearer <device-token>`. No cookie or query credential is accepted. Responses use `Cache-Control: no-store, private`.

| Field | Meaning |
| --- | --- |
| `schemaVersion` | `1` |
| `date`, `timezone`, `generatedAt` | Today in `Africa/Tripoli`; UTC ISO generation timestamp |
| `totals` | Integer counts: `totalAppointments`, `scheduled`, `arrived`, `waiting`, `inProgress`, `inQueue`, `completed`, `noShow`, `cancelled`, `discontinued`, `voided`, `walkIn` |
| `waiting` | `count`, nullable `oldestWaitingMinutes`, `over30Minutes`, `over60Minutes`, `unknownDurationCount` |
| `modalities` | Rows with `modalityId`, `code`, `nameEn`, `nameAr`, and the same count fields as `totals` |

`inQueue = arrived + waiting + inProgress`. Totals include voided records, matching the existing Statistics API; individual status counts expose them separately. There is no soft-delete predicate in that authoritative API. Inactive modalities with bookings remain included; modalities with no bookings are omitted.

Waiting metrics include only status `waiting` and use `waiting_started_at`, the persisted waiting transition timestamp. This differs from the Queue's **time since arrival** display. No arrival fallback is used. Missing waiting timestamps count toward `unknownDurationCount` and never generate fabricated ages. Future timestamps clamp to zero. Oldest duration is floored to minutes; thresholds compare actual elapsed time strictly greater than 30/60 minutes. Oldest is `null` when no duration is known.

Authentication: absent, malformed, unknown, expired, revoked or ineligible-owner credentials receive 401; valid credentials with a different scope receive 403. Rate limits allow 60 reads/minute per authenticated device and 180 attempts/minute per source IP, per application process. Normal RISpro APIs never accept this bearer credential.

## Settings APIs and security

Normal cookie authentication plus active supervisor/admin eligibility is required for all `/api/settings/mobile-widget` endpoints:

- `GET /tokens` returns safe metadata, creator and active/expired/revoked status; never a hash or secret.
- `GET /preview` uses the same aggregate service without a mobile token.
- `POST /tokens` accepts `{ deviceName, expiresAt }` and returns `{ token, secret }` once.
- `POST /tokens/:id/rotate` accepts `{ expiresAt }` and returns a replacement `{ token, secret }` once.
- `POST /tokens/:id/revoke` returns `{ ok: true }`.

All mutations require existing recent supervisor re-auth. Expiry is mandatory and limited to 366 days. The fixed scope is `mobile.operations-summary:read`. Tokens contain 32 cryptographically random bytes; only SHA-256 hashes and short identification prefixes are stored. Rotation and audit writes share a transaction. Security audit events follow the existing audit service and its configured audit policy; routine reads only update last-used metadata.

The summary performs one aggregate SQL query without reading patient objects or invoking queue cleanup. Widget cache projection drops unexpected fields. HTTPS is required and redirects are refused to keep the Authorization header at the configured origin. The script does not log credentials. Do not put tokens in URLs, screenshots of real devices, source control or support tickets.

## Validation and device limits

Run `node --test scripts/mobile/scriptable-widget.test.mjs` for syntax, payload validation, cache/schema handling, modality selection and layout shims. Backend tests live in `src/modules/mobile-widget/mobile-widget.integration.test.ts`; the browser workflow is `e2e/specs/mobile-widget-access.spec.ts`.

Mock checks do not prove native iOS layout or refresh timing. Verify the final script on a real iPhone before distributing it, especially the Lock Screen layouts. Scriptable documents [widget families](https://docs.scriptable.app/config/), [refresh behavior](https://docs.scriptable.app/listwidget/), [Keychain](https://docs.scriptable.app/keychain/) and [request redirects](https://docs.scriptable.app/request/).
