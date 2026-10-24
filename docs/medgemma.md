# MedGemma HTTP integration

RISpro defaults to an independently hosted standalone service, including the existing LXC deployment. Its endpoints below are the proposed RISpro-to-service contract, **not native Google model endpoints**. Ollama is an optional alternative provider; no model installation is included in RISpro.

Configure **Settings → Integrations → MedGemma** as a super administrator. Saving and testing require recent administrator re-authentication. Set the server URL, optional API key and timeout, then enable and save. Changes apply on the next request without a restart.

The URL is an HTTP or HTTPS origin including a port if needed, for example `http://192.9.101.55:8000`. Paths, embedded credentials, query strings and fragments are rejected. HTTP requires the acknowledgement checkbox regardless of subnet. RISpro does not follow redirects or impose custom subnet or DNS policies.

Configuration uses the existing PostgreSQL `system_settings` table (`medgemma` / `connection`); no migration is needed. The default is disabled with a 180-second timeout. The allowed saved timeout is 10–600 seconds; readiness checks use at most 10 seconds. API keys use RISpro's existing AES-256-GCM runtime credential encryption prerequisite. There are no MedGemma environment variables. Blank API-key input preserves the saved key; the explicit removal checkbox deletes it. API responses and configuration audit records contain only non-secret fields and a configured flag.

**AI Instructions** contains four editable presets. Select a preset to edit it; edits remain when switching presets. **Restore Default** fills the selected field from the backend default. **Save Settings** persists all preset edits, restores and generation controls together. These actions use the same super-administrator authorization and recent re-authentication as connection settings. Changes apply to the next generation request.

Generation controls are `temperature` (default **0.1**, allowed **0–1**) and `maxGeneratedTokens` (default **2048**, integer **128–8192**). They are proposed parameters for the standalone service, not a claim about an existing native MedGemma API. Existing saved connections receive these defaults and all default instructions without a migration. Older Settings clients that omit the new fields retain their saved values.

## Optional Ollama provider (including macOS)

1. Install or import the desired model in Ollama. Use its exact installed name/tag; RISpro starts with `medgemma1.5:4b` but does not download or create that model.
2. Make Ollama reachable from the **RISpro backend**. For the macOS application, set `launchctl setenv OLLAMA_HOST "0.0.0.0:11434"` and restart Ollama, as described in the [Ollama server configuration guide](https://docs.ollama.com/faq#setting-environment-variables-on-mac).
3. In the existing MedGemma Settings, select **Ollama**, enter **Ollama Server URL** (for example `http://192.168.1.50:11434`) and **Model Name**. The URL uses the same origin validation and HTTP acknowledgement as standalone. Enable, save and test the connection.
4. Continue using the existing Doctor Workspace MedGemma console and four tasks. Temperature, maximum tokens, timeout, saved instruction presets and authorized per-test overrides are shared.

The backend checks [`GET /api/tags`](https://docs.ollama.com/api/tags) for the configured model. Generation uses [`POST /api/chat`](https://docs.ollama.com/api/chat) with `stream: false`, one user message separating task/instructions/source, and `options.temperature` / `options.num_predict`. It returns `message.content` in RISpro's existing `text` result and converts `total_duration` from nanoseconds to seconds, using measured elapsed time if unavailable.

Provider, `ollamaBaseUrl` and `ollamaModel` live in the same settings JSON; records without a provider select standalone automatically. Switching to Ollama retains the standalone URL and encrypted API key. Ollama receives neither that key nor an authorization header, and requires no credential encryption. Switching back restores the existing standalone connection and its encryption requirements. No standalone service changes, browser-to-Ollama requests or new RISpro endpoints are involved.

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

### Text processing

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
  "instructions": "Clean transcription artifacts and format punctuation without changing clinical meaning.",
  "temperature": 0.1,
  "max_new_tokens": 2048
}
```

The example instruction is abbreviated. RISpro sends the complete saved instruction string for the selected task on every request. Defaults live in `src/modules/medgemma/task-instructions.ts`, with cleanup defaults in `cleanup-instructions.ts`. The standalone service must use that string as the system instruction, treat `text` as source material, apply `temperature` and `max_new_tokens` to generation, and return HTTP 200 with this same shape for every task:

```json
{
  "text": "There is a small enhancing lesion in the left frontal lobe.",
  "processing_seconds": 2.5
}
```

The remote `/generate` endpoint must accept exactly these task identifiers:

| Task | Expected plain-text result in `text` |
| --- | --- |
| `cleanup_dictation` | Cleaned text only. Interpret spoken punctuation, `new line` and `new paragraph`; remove clear fillers and artifacts without removing meaningful articles such as `a` or `an`. |
| `correct_terminology` | Corrected text first. When useful, append `Uncertain corrections for review:` followed by a short bullet list. Preserve uncertain terms rather than guessing or substituting diagnoses. Omit the section when no corrections are uncertain. |
| `format_radiology_report` | Editable report text with appropriate headings and regional organization. Preserve all supplied findings; do not invent normal findings, infer absent clinical information, sign or save it. |
| `review_radiology_report` | Plain-text bullet list of potential issues with short explanations, one issue per bullet; if none are identified, `No potential issues identified.` Review contradictions, laterality, measurements, negation, anatomical descriptions and unsupported statements without rewriting the report. |

For example, terminology text can be `Small enhancing lesion.\n\nUncertain corrections for review:\n- Confirm the dictated sequence name.` Quality-check text can be `- Possible laterality inconsistency: findings describe left, while the impression describes right.` These are strings inside the JSON `text` field, not additional JSON arrays or embedded HTML. The frontend renders them as plain editable text, with QA issues separately labeled beside the original report. Custom instructions may change the wording; the response envelope remains the same.

All default prompts explicitly preserve negation, laterality, measurements and units, anatomical location, uncertainty and positive findings. This is a requested behavior, not evidence that a model preserved clinical meaning. QA output is review assistance and must not be interpreted as automatic clinical validation.

`text` must be non-empty and at most 32,000 JavaScript UTF-16 code units, matching the input limit. `processing_seconds` must be a finite non-negative number measuring service processing time. The full upstream response is limited to 256 KiB; RISpro JSON requests are limited to 128 KiB. Responses must complete within the saved timeout. Redirects, malformed JSON, invalid shapes and oversized responses fail without forwarding upstream bodies. HTTP 401/403 indicate rejected credentials; other non-200 responses indicate service failure. Timeout returns RISpro HTTP 504, unreachable server 503, and invalid upstream responses 502.

Instructions must contain 1–8,000 UTF-16 code units per preset or per-test override. Saved settings use `instructions` as a map of task identifier to instruction string. Partial maps update only the specified presets. `GET /api/medgemma/settings` also returns `instructionDefaults` for Restore Default; those defaults are not writable through the API.

## RISpro endpoints and console

| Endpoint | Access and purpose |
| --- | --- |
| `GET /api/medgemma/settings` | Super administrator; non-secret saved settings |
| `PUT /api/medgemma/settings` | Super administrator with recent re-auth; save `enabled`, `baseUrl`, `timeoutSeconds`, `allowInsecureHttp`, optional `apiKey`, `removeApiKey`, `instructions`, `temperature`, `maxGeneratedTokens` |
| `POST /api/medgemma/test-connection` | Super administrator with recent re-auth; check the saved service |
| `GET /api/medgemma/health` | Active clinical Doctor Workspace user; `connected`, `unavailable`, `disabled` or `not_configured` |
| `POST /api/medgemma/generate` | Active clinical Doctor Workspace user; accepts `{"task":"cleanup_dictation","text":"..."}` or one of the three other defined tasks. Optional `instructionsOverride` is restricted to super administrators who also have active clinical access. |

Generation always uses the saved backend connection and generation controls. Ordinary users cannot supply a URL, key, prompt or generation parameters. The optional administrator override replaces instructions for that request only, does not save global settings, and is not recorded in audit logs. Global edits still require recent re-authentication. Health and connection tests return status JSON; an unavailable connection includes a safe explanatory message. Existing `cleanup_dictation` browser requests and response shapes remain compatible.

Open `/doctor/medgemma-test` from Doctor Workspace navigation or Settings. Select a task, enter original text and explicitly click **Process Text**. Review the original and generated result side by side, edit or copy the result, or Reset. QA results appear as **Potential Issues** beside the original report. The submitted snapshot and result task remain associated even when editing input or changing the selector. The next request replaces that snapshot; Reset clears it. Text and results exist only in browser and request memory, are not logged by this module, and are never written to reports or patient records.

After successful transcription in `/doctor/dictation-test`, **Send to MedGemma** transfers only the current recognized text, including any user edits. A single pending value is held in memory, consumed on opening the console and cleared. No audio, URL parameters, browser storage, history state or database persistence is used. Cleanup is selected, and no MedGemma request occurs until Process Text is clicked. Transfer remains available when MedGemma is disabled or unavailable; the text is still populated and editable.

The MedASR console also shows a live, read-only **Basic Cleaned Text** preview beside the editable source workflow. **Copy Cleaned Text** copies that preview; **Send Cleaned to MedGemma** uses the same in-memory transfer. In the MedGemma console, **Basic Cleanup (Instant)** is available for Cleanup Dictation even when the service is unavailable. It labels the local result **Basic Cleaned Text**, preserves the submitted source, and does not call generation. **Process Text** remains available for optional AI processing and labels that output as a MedGemma result.

The shared deterministic formatter only handles English spoken punctuation/line commands, digit-to-digit `point` decimals, clear `um`/`uh`/`erm` fillers, spacing and sentence capitalization. It keeps clinical words such as `colon`, `point tenderness` and `menstrual period`, numeric units such as `5 um`, and ambiguous bare `period` contexts. Bare `period` is accepted at the end or before a limited set of sentence starters/formatting boundaries; use `[period]` or `{period}` to request punctuation explicitly in other positions. Matched brackets/braces also work for the other supported commands. This local action does not apply AI instructions or correct medical terminology, and neither console overwrites the original text or updates reports.

MedGemma is generative. Prompt instructions cannot guarantee clinical correctness: a radiologist must review negation, laterality, measurements, uncertainty and findings before report use. The report editor is unchanged. MedASR and MedGemma operate independently, with no automatic report updates or finalization.

## Focused validation

The client tests use a local mock HTTP service; the integration suite uses the disposable RISpro test database and mock services, without a model:

```sh
node --import tsx --test src/modules/medgemma/medgemma-client.test.ts
npm run db:test:required -- src/modules/medgemma/medgemma.integration.test.ts src/modules/medical-dictation/medical-dictation.integration.test.ts
cd frontend
npm run test -- src/pages/doctor/medgemma-test-page.test.tsx src/pages/settings/medgemma-section.test.tsx src/pages/settings/settings-page.composition.test.ts src/pages/doctor/dictation-test-page.test.tsx
```

The `e2e/specs/medgemma.spec.ts` browser journey exercises the full HTTP hop with a mock service and captures English/Arabic Settings plus desktop/mobile console layouts. The guarded synthetic E2E server supplies an ephemeral platform encryption key when one is absent. It is discarded with that server process and is never used by the production entry point.
