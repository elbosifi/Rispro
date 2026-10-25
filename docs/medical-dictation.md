# Medical Dictation (MedASR)

RISpro integrates with an independently hosted, compatible MedASR HTTP API. It does not install models, inference libraries, or additional infrastructure.

## Configure through RISpro

1. Apply the normal RISpro database migrations, including `233_medical_dictation.sql`.
2. Sign in as a super administrator. Open **Settings → Integrations → Medical Dictation (MedASR)** (`/settings?section=medical_dictation`).
3. Enter the server origin, such as `https://medasr.example.org:8000`, and API key. Set the request timeout (10–600 seconds; default 180).
4. Prefer HTTPS with a trusted certificate. To use unencrypted HTTP for the explicitly configured server, enable the acknowledgement confirming that the destination is trusted and the network is access-controlled and protected. This also supports hospital networks using addresses outside RFC1918 ranges, such as `http://192.9.101.244:8000`. Dangerous-address protections still apply to IP literals and every DNS answer. Restrict access to the MedASR API at the network boundary.
5. Enable Medical Dictation and **Save Settings**, completing the existing sensitive-settings re-authentication if prompted. After re-authentication, click Save again; edits are retained.
6. Click **Test Connection**. This checks the saved `/health` endpoint, readiness, and model identifier. It does not validate the API key; only an actual transcription does that. Disabled or unconfigured integrations are not contacted.
7. With an active clinical Doctor Workspace profile, open **Doctor Workspace → Medical Dictation** (`/doctor/dictation-test`). Allow microphone access, record a synthetic English medical phrase, stop, and click **Transcribe**. Edit, copy, or clear the result.

Connection changes take effect on the next request without a RISpro or Docker restart. Leaving the key field blank retains its encrypted value. Enter a replacement key or select **Remove saved API key on Save** for intentional removal. If the upstream requires authentication, a removed/incorrect key causes transcription to fail even if health is connected.

Credentials use the same platform `RISPRO_SECRET_ENCRYPTION_KEY` prerequisite as outbound email. There is no MedASR environment configuration. If platform encryption is absent or invalid, RISpro refuses enabling dictation or saving a key, and refuses transcription; it never stores plaintext. An operator must resolve that existing platform prerequisite if it has not already been provisioned. Preserve the platform key across application restarts.

RISpro continues to support `http://192.9.101.252:3000`. On Windows, use the **top-bar settings arrow → Windows Microphone Setup** download to configure the exact HTTP origin as trusted for capture. Edge uses `OverrideSecurityRestrictionsOnInsecureOrigin`; Chrome uses `UnsafelyTreatInsecureOriginAsSecure`. The script preserves other origins, verifies REG_SZ entries, supports read-only `-VerifyOnly`, and removes only its RISpro entries with `-Remove`. Restart the browser and check the applicable policy page for status **OK**. Registry verification does not prove browser acceptance or successful capture. Site permission, Windows desktop-app microphone access, and organization capture policies still apply; setup does not override them.

Normal Safari on macOS/iPhone blocks capture on this plain HTTP origin and does not consume the Windows policies. RISpro displays that limitation instead of claiming capture is available. Safari format compatibility (including MP4/AAC when supported) applies only when Safari permits capture; there is no application-only fix for its HTTP-origin restriction within the browser-only constraints. See [WebKit capture-origin requirements](https://webkit.org/blog/7763/a-closer-look-into-webrtc/), [Edge origin policy](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-browser-policies/overridesecurityrestrictionsoninsecureorigin), and [Chrome origin policy](https://chromeenterprise.google/policies/#UnsafelyTreatInsecureOriginAsSecure).

The recorder probes `MediaRecorder.isTypeSupported()` for WebM/Opus, MP4, WebM, Ogg/Opus, and WAV. The actual recorder MIME type and matching file extension travel through the existing API unchanged. FFmpeg conversion, MedASR configuration, and deployment are unchanged. Recordings stop at 60 seconds or 15 MB.

## Microphone test and global insertion

The top-bar microphone still starts/stops dictation into the original eligible field and cursor selection. Right Shift, configurable keyboard bindings, and SpeechMike/Dragon keyboard mappings retain Hold-to-Talk, Toggle, and separate Start/Stop modes. Review text in the field; saving remains manual. Edits, field changes, record changes, navigation, locking, and account changes invalidate pending insertion. Unrelated storage changes, panel refreshes, and background clicks do not cancel dictation.

The adjacent settings dropdown starts with **Microphone Test**: choose the default or a specific input, check permission and the live level, record, stop, and play the actual recording. Test recordings are browser-memory blobs, never uploaded, and are released when the controls close or another test starts. An unavailable saved device falls back to the default with a notice. Permission, blocked origin/page policy, unavailable hardware, empty/silent/failed recording, no recognized speech, request failure, and insertion failure have separate messages. Token-only `</s>` results are empty recognition; normal cleanup still removes trailing model end tokens.

The live level samples the recording stream without connecting it to speakers. Very low audio across at least three running-meter samples is treated as silence; the blob remains playable locally but is not automatically transcribed. This is a conservative signal check, not a voice detector. A missing/suspended Web Audio meter does not reject a valid recording; check playback and the no-speech response instead. Audio samples, field contents, and credentials are not logged.

## Physical acceptance checklist

Use synthetic phrases, not patient information. These checks require real browsers, microphone hardware, and the hospital origin; automated Chromium fake-audio checks do not replace them.

1. **Edge / Windows:** run the downloaded setup as Administrator, restart all Edge processes, verify the exact origin has status OK in `edge://policy`, and open the HTTP RISpro address. Allow site/Windows microphone access. Record/play a test and watch the level. Try default and USB inputs; unplug the selected USB device and confirm default fallback with a notice. Deny permission once and confirm useful guidance. Dictate into a cursor selection; verify red → processing → inserted text, undo, manual editing during transcription, and cancellation when switching patient/field. Confirm no automatic save.
2. **Chrome / Windows:** repeat on the same HTTP address, checking `UnsafelyTreatInsecureOriginAsSecure` in `chrome://policy`. Verify recorded MIME/filename in the test request using synthetic audio and confirm actual MedASR transcription. Check muted/silent input and disconnected/busy hardware messages.
3. **Safari / macOS:** at the HTTP address, confirm the blocked-origin message and that ordinary RISpro browsing still works. If capture is already permitted in an independently approved test context, verify supported MP4 (or another probed format), local playback, meter, cursor insertion, and cancellation. Do not mark HTTP capture as passing based on a different context.
4. **Safari / iPhone:** verify the HTTP blocked-origin message, usable narrow dropdown, and normal RISpro browsing. Where capture is independently permitted for testing, check tap start/stop, playback, input selection as exposed by iOS, interruption/lock behavior, and actual format submission. Windows policy cannot enable iPhone Safari HTTP capture.
5. **Philips SpeechMike / Windows:** select its USB audio input and configure keyboard events in Philips SpeechControl. Use Detect SpeechMike Button to confirm codes; test Hold-to-Talk (release stops), Toggle (second press stops), and separate Start/Stop. Confirm Right Shift remains independent, repeats do not restart recording, target/patient changes cancel, and physical mute/unplug is clear to the user. Dragon mappings use the same browser keyboard event path.

For script-only regression checks without machine policy changes, run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-microphone-policy.ps1`. This parses and executes setup against an in-memory registry, checking install, normalization, duplicate handling, repeat setup, verification, removal, and preservation of unrelated origins.

## Backend and reuse

`src/modules/medical-dictation/` separates PostgreSQL settings, the MedASR HTTP client, orchestration, and Express endpoints. `frontend/src/hooks/use-audio-recorder.ts` and `frontend/src/lib/medical-dictation-api.ts` can be reused by a future reporting editor without implementing report insertion or persistence now.

| Endpoint | Access |
| --- | --- |
| `GET /api/medical-dictation/settings` | Super administrator; non-secret values only |
| `PUT /api/medical-dictation/settings` | Super administrator with recent re-authentication |
| `POST /api/medical-dictation/test-connection` | Super administrator with recent re-authentication |
| `GET /api/medical-dictation/health` | Active clinical Doctor Workspace profile |
| `POST /api/medical-dictation/transcribe` | Active clinical Doctor Workspace profile |

The singleton configuration table defaults to disabled with an empty server address and a 180-second timeout. Configuration and secret-free security audit writes share a transaction. Every operation reloads saved settings. The API key is AES-256-GCM encrypted and is never returned to the browser or sent on health probes. A health result always has `credentialsValidated: false`.

Audio is held in memory, limited to 15 MB, and sent unchanged as a multipart `file` with the saved `X-API-Key`. Supported audio MIME types and container signatures are checked. Original filenames and request fields cannot override the saved target. Audio and transcription text are not saved or included in audit entries. Normal application diagnostics receive only sanitized integration errors, never upstream response bodies or credentials.

The client allows only HTTP(S) origins without embedded credentials, paths, query strings, or fragments. It blocks loopback, link-local/metadata, multicast, mapped IPv6, and other unsafe targets. DNS answers are checked on every connection and the validated address is used by the socket. Redirects are rejected and TLS verification remains enabled. Health probes have a maximum 10-second deadline; transcription uses the saved timeout, including response-body handling. Upstream error bodies are discarded.

The existing reverse proxy has an exact transcription-route exception with a 630-second deadline and 16 MB multipart request ceiling. This lets the backend enforce its saved timeout up to 600 seconds without changing ordinary API timeouts. Gateway request buffering is disabled for this route. Any additional external gateway must also permit that request duration and size; no MedASR-specific Docker configuration is needed.

## Focused validation

Run tests outside the sandbox following the repository rules:

```sh
node --import tsx --test src/modules/medical-dictation/medasr-client.test.ts src/modules/medical-dictation/medical-dictation-proxy.test.ts
npm run db:test:required -- src/modules/medical-dictation/medical-dictation.integration.test.ts
cd frontend
npm run test -- src/hooks/use-audio-recorder.test.tsx src/pages/settings/medical-dictation-section.test.tsx src/pages/doctor/dictation-test-page.test.tsx src/pages/settings/settings-page.composition.test.ts
```

The backend tests use local mock MedASR servers. The browser spec `e2e/specs/medical-dictation.spec.ts` uses the disposable E2E database, native Chromium fake microphone input, and mocks RISpro health/transcription responses to verify the browser boundary separately. For its settings-save test, supply a temporary valid **platform** encryption key to the E2E process environment if the E2E environment does not already have one. Do not use or change a deployment encryption key for tests. Start the E2E DB and use the repository's normal reset/test/down sequence; set `VITE_API_PROXY_TARGET=http://127.0.0.1:3100` when using backend port 3100.

Reference: [MediaRecorder format detection](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static).
