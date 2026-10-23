# MedGemma HTTP integration

RISpro connects to an independently hosted service. These endpoints are the proposed RISpro-to-service contract, **not native Google model endpoints**. Implement the standalone LXC or other host to match this contract; no model installation is included in RISpro.

Configure **Settings → Integrations → MedGemma** as a super administrator. Saving and testing require recent administrator re-authentication. Set the server URL, optional API key and timeout, then enable and save. Changes apply on the next request without a restart.

The URL is an HTTP or HTTPS origin including a port if needed, for example `http://192.9.101.55:8000`. Paths, embedded credentials, query strings and fragments are rejected. HTTP requires the acknowledgement checkbox regardless of subnet. RISpro does not follow redirects or impose custom subnet or DNS policies.

Configuration uses the existing PostgreSQL `system_settings` table (`medgemma` / `connection`); no migration is needed. The default is disabled with a 180-second timeout. The allowed saved timeout is 10–600 seconds; readiness checks use at most 10 seconds. API keys use RISpro's existing AES-256-GCM runtime credential encryption prerequisite. There are no MedGemma environment variables. Blank API-key input preserves the saved key; the explicit removal checkbox deletes it. API responses and configuration audit records contain only non-secret fields and a configured flag.

## Standalone service contract

### Readiness

```http
GET {BASE_URL}/health
Accept: application/json
X-API-Key: <configured-key>
```

```json
{
  "status": "ready",
  "model": "google/medgemma-1.5-4b-it"
}
```

Return HTTP 200 with the ready status and a non-empty model string (up to 200 characters). RISpro sends the configured API key on both endpoints, omitting the header if no key is configured. The service may leave readiness unauthenticated. A successful generation request remains necessary to confirm generation access.

### Dictation cleanup

```http
POST {BASE_URL}/generate
Content-Type: application/json
Accept: application/json
X-API-Key: <configured-key>
```

```json
{
  "task": "cleanup_dictation",
  "text": "There is uh a small enhancing lesion in the left frontal lobe period",
  "instructions": "Clean medical dictation without changing clinical meaning.\nRemove obvious hesitation fillers such as \"uh\", \"um\", and \"erm\".\nCorrect grammar and punctuation, interpreting spoken punctuation commands where appropriate.\nRemove obvious transcription artifacts.\nPreserve all anatomical terms and medical findings.\nPreserve negation, laterality, measurements, and diagnostic uncertainty.\nDo not invent additional findings or omit clinically meaningful information.\nDo not convert observations into unsupported diagnoses.\nReturn only the cleaned text."
}
```

The backend instruction constant is in `src/modules/medgemma/cleanup-instructions.ts`. Only `cleanup_dictation` is supported. Treat the text as dictation to clean. Return HTTP 200 and JSON:

```json
{
  "text": "There is a small enhancing lesion in the left frontal lobe.",
  "processing_seconds": 2.5
}
```

`text` must be non-empty and at most 32,000 JavaScript UTF-16 code units, matching the input limit. `processing_seconds` must be a finite non-negative number measuring service processing time. The full upstream response is limited to 256 KiB; RISpro JSON requests are limited to 128 KiB. Responses must complete within the saved timeout. Redirects, malformed JSON, invalid shapes and oversized responses fail without forwarding upstream bodies. HTTP 401/403 indicate rejected credentials; other non-200 responses indicate service failure. Timeout returns RISpro HTTP 504, unreachable server 503, and invalid upstream responses 502.

## RISpro endpoints and console

| Endpoint | Access and purpose |
| --- | --- |
| `GET /api/medgemma/settings` | Super administrator; non-secret saved settings |
| `PUT /api/medgemma/settings` | Super administrator with recent re-auth; save `enabled`, `baseUrl`, `timeoutSeconds`, `allowInsecureHttp`, optional `apiKey` and `removeApiKey` |
| `POST /api/medgemma/test-connection` | Super administrator with recent re-auth; check the saved service |
| `GET /api/medgemma/health` | Active clinical Doctor Workspace user; `connected`, `unavailable`, `disabled` or `not_configured` |
| `POST /api/medgemma/generate` | Active clinical Doctor Workspace user; accepts only `{"task":"cleanup_dictation","text":"..."}` |

Generation always uses the saved backend connection and backend instructions. Ordinary users cannot supply a URL, key or prompt. Health and connection tests return status JSON; an unavailable connection includes a safe explanatory message.

Open `/doctor/medgemma-test` from Doctor Workspace navigation or Settings. Paste or type original dictation, clean it, review both areas, edit and copy the cleaned result. The original submitted snapshot is preserved until the next request or Clear; editing the input does not change that snapshot. Text and results exist only in browser and request memory, are not logged by this module, and are never written to reports or patient records. Clearing or leaving the console discards them. The optional direct MedASR transfer is not implemented; paste its transcription manually.

MedGemma is generative. Prompt instructions cannot guarantee clinical correctness: users must review negation, laterality, measurements, uncertainty and findings before report use. The report editor and MedASR integration are unchanged and operate independently. Future tasks can reuse the HTTP client, but are not implemented here.

## Focused validation

The client tests use a local mock HTTP service; the integration suite uses the disposable RISpro test database and mock services, without a model:

```sh
node --import tsx --test src/modules/medgemma/medgemma-client.test.ts
npm run db:test:required -- src/modules/medgemma/medgemma.integration.test.ts src/modules/medical-dictation/medical-dictation.integration.test.ts
cd frontend
npm run test -- src/pages/doctor/medgemma-test-page.test.tsx src/pages/settings/medgemma-section.test.tsx src/pages/settings/settings-page.composition.test.ts src/pages/doctor/dictation-test-page.test.tsx
```

The `e2e/specs/medgemma.spec.ts` browser journey exercises the full HTTP hop with a mock service and captures English/Arabic Settings plus desktop/mobile console layouts. The guarded synthetic E2E server supplies an ephemeral platform encryption key when one is absent. It is discarded with that server process and is never used by the production entry point.
