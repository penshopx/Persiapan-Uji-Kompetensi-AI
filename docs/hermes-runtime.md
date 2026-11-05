# Hermes Agent integration

## Current state

The user selected **NousResearch/hermes-agent**, not either similarly named MultiClaw project. No Hermes service exists yet. This workspace contains a real HTTP adapter, not an installed Hermes runtime. The existing OpenAI runtime stays explicitly selected by default so practice remains available. Do not claim live Hermes verification from contract tests.

Upstream references:
- https://github.com/NousResearch/hermes-agent
- https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server
- https://hermes-agent.nousresearch.com/docs/user-guide/configuration

The adapter requires the documented bearer-authenticated Runs API, capabilities, skills and toolsets discovery. Pin and test an upstream revision on the runtime host before activation: the upstream default branch and documentation change over time. A generic OpenAI-compatible endpoint is **not** enough.

## Configuration

Use the integrations/environment-secrets skills when configuring these values. Never paste, read or log credential values.

| Setting | Where | Purpose |
|---|---|---|
| `SIGAP_AGENT_RUNTIME` | Non-secret environment | `openai` (default) or `hermes`; unknown values fail closed |
| `HERMES_BASE_URL` | Non-secret environment | Dedicated HTTPS gateway/profile root, **without** `/v1`, query, fragment, embedded credentials or trailing slash |
| `HERMES_API_KEY` | Replit Secrets | Dedicated API profile's bearer credential; never exposed to frontend |
| `HERMES_RESTRICTED_PROFILE_VERIFIED` | Non-secret environment | `true` only after the deployment operator verifies the restrictions below |

For example a dedicated gateway root or `/p/sigap` profile root can be used. Do not reuse an administrator's personal agent profile. Provider/model credentials belong on the Hermes host; selecting Hermes does not configure an inference provider for it. Do not forward Replit AI proxy credentials to another host.

## Required host restrictions

Hermes adds client prompts to its own system prompt; prompts do **not** remove tools. The operator must provision a dedicated profile and verify these requirements against the pinned revision:

1. Disable **all** toolsets, skills, plugins, MCP servers, hooks, cron jobs, delegation, terminal and filesystem tools. No free browsing or dynamic skill installation.
2. Disable global and long-term memory, automatic recall, and cross-session shared context. Start with a clean profile; do not attach personal memories or prior participant transcripts.
3. Give the process no SIGAP database credentials, evidence object-storage credentials, participant file mounts, or access to the SIGAP internal network. Restrict its network to its inference provider and required gateway ingress. No administrative API available to model-generated requests.
4. Set finite model/provider timeouts, output/token and agent iteration budgets; configure a model capable of obeying the JSON role contracts. Keep generated text and transcript retention appropriate for participant data.
5. Require TLS and the dedicated bearer credential; keep browser CORS disabled. Route only the backend to this service.

`HERMES_RESTRICTED_PROFILE_VERIFIED` is an **operator attestation**, not automatic proof that memory/hooks/network permissions are safe. Do not set it speculatively. Before every practice turn, the adapter independently checks capability flags, required bearer auth, an empty skills list and no enabled concrete tools. Missing/malformed discovery fails closed. Live configuration must not be changed while serving participant requests.

## Bounded execution

- A server-owned plan permits standards → examiner for start, and standards → evaluator → coach → examiner for an answer. Hermes orchestrator must confirm exactly this plan; arbitrary plans are rejected.
- Source retrieval remains authoritative in SIGAP's catalog. Hermes standards role receives only blocks of the selected unit and must return its exact standard/unit identifiers and valid unique block indexes. SIGAP resolves those indexes to source bytes for subsequent roles, retaining the full excerpt as authoritative context. Hermes cannot replace a source, fetch participant evidence, or broaden catalog access.
- Examiner questions and coach output have bounded text contracts. Evaluation uses the generated Zod schema; score/status thresholds are imposed by the host. Coach cannot change the score. Citations are supplied by the host, not invented by the model.
- No user/owner/journey/attempt identifiers or evidence objects are passed as model input. Owner identity and validated input form a SHA-256 execution namespace. Stage, policy and source payload form the request key and unique stage session. Anonymous calls get random namespaces. This prevents common opening questions from binding different participants to the same Hermes session.
- `POST /v1/runs` uses `Idempotency-Key`. The adapter polls `GET /v1/runs/{id}` and accepts only completed JSON from the exact expected run/session. Failed/cancelled/interrupted/unknown/approval states are rejected. A failed or timed-out run receives a bounded best-effort stop request. No auto-approval or automatic retry under a new key. A deliberate participant retry atomically claims a new persisted execution generation; only that generation may fail/complete the passport attempt. Concurrent retries are refused. Generic practice without a passport ledger gets a fresh namespace per request.
- Whole-turn deadline: 150 seconds. Discovery deadline: 5 seconds. Cancellation request deadline: 3 seconds. Remote JSON bodies: 128 KiB maximum. No redirects, unbounded retries or shell execution.
- Hermes deduplication has its own finite retention (documented as 24 hours for Runs). SIGAP's participant passport ledger remains authoritative for replaying completed attempts without invoking Hermes. Failed/invalid runs cannot pin a deliberate retry to the same failed upstream key: that retry uses its newly claimed execution generation. Retries within a generation reuse keys; there are no unbounded automatic retries. A stale worker cannot overwrite a newer generation's result or failure state.

## Status and history

`GET /api/competency/summary` reports the selected runtime, current discovery result and check time without exposing configuration or credentials. OpenAI selection means configuration selection, not a paid model health test. Hermes readiness means contract/permission discovery succeeded, not that a practice turn has completed.

Each completed stage records its actual runtime and (for Hermes) its run ID. OpenAI orchestration/lookup stages are local deterministic operations. Evaluator/coach are skipped for starts, not falsely marked complete. Legacy passport results without runtime metadata still parse and are displayed as unrecorded, not retroactively labeled Hermes.

Passport ownership, pending claims, input-conflict rejection, transactional event insertion and cached result replay are unchanged. The adapter cannot write the passport or make a certification decision.

## Activation checklist

1. Provision and restrict the service as above; verify a pinned version on the host.
2. Configure the URL and secret securely; attest restrictions only after verification.
3. Select `hermes`, restart the API workflow and inspect the agent status page.
4. Run one real start and answer; verify all required stages have Hermes run IDs, source citations are unchanged, and retrying the same passport attempt replays the result without a second event.
5. Exercise timeout/cancellation and a deliberately enabled test tool on **non-participant** data; confirm fail-closed behavior. Remove the unsafe configuration before accepting participants.

Automated contract tests use a local test HTTP server; they do not prove any provisioned external service is safe or available.
