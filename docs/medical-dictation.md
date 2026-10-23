# Medical Dictation (MedASR)

RISpro integrates with an independently hosted, compatible MedASR HTTP API. It does not install models, inference libraries, or additional infrastructure.

## Configure through RISpro

1. Apply the normal RISpro database migrations, including `233_medical_dictation.sql`.
2. Sign in as a super administrator. Open **Settings → Integrations → Medical Dictation (MedASR)** (`/settings?section=medical_dictation`).
3. Enter the server origin, such as `https://medasr.example.org:8000`, and API key. Set the request timeout (10–600 seconds; default 180).
4. Prefer HTTPS with a trusted certificate. HTTP is permitted only for RFC1918 IPv4 or ULA IPv6 destinations after acknowledging that the internal network is protected. Restrict access to the MedASR API at the network boundary.
5. Enable Medical Dictation and **Save Settings**, completing the existing sensitive-settings re-authentication if prompted. After re-authentication, click Save again; edits are retained.
6. Click **Test Connection**. This checks the saved `/health` endpoint, readiness, and model identifier. It does not validate the API key; only an actual transcription does that. Disabled or unconfigured integrations are not contacted.
7. With an active clinical Doctor Workspace profile, open **Doctor Workspace → Medical Dictation** (`/doctor/dictation-test`). Allow microphone access, record a synthetic English medical phrase, stop, and click **Transcribe**. Edit, copy, or clear the result.

Connection changes take effect on the next request without a RISpro or Docker restart. Leaving the key field blank retains its encrypted value. Enter a replacement key or select **Remove saved API key on Save** for intentional removal. If the upstream requires authentication, a removed/incorrect key causes transcription to fail even if health is connected.

Credentials use the same platform `RISPRO_SECRET_ENCRYPTION_KEY` prerequisite as outbound email. There is no MedASR environment configuration. If platform encryption is absent or invalid, RISpro refuses enabling dictation or saving a key, and refuses transcription; it never stores plaintext. An operator must resolve that existing platform prerequisite if it has not already been provisioned. Preserve the platform key across application restarts.

Browser microphone recording requires a secure browser context (normally HTTPS; localhost is also supported). The recorder selects supported WebM/Opus, MP4, Ogg/Opus, or WAV formats, including MP4 for capable Safari browsers. Recordings stop at 60 seconds. Safari/Edge support still depends on the browser and device; Chromium browser automation is not hardware microphone acceptance.

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
