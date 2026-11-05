# SIGAP Kompetensi

Ruang persiapan uji kompetensi konstruksi dengan katalog sumber standar dan latihan berbantuan peran agen AI spesialis.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — API server, managed workflow supplies PORT
- `pnpm --filter @workspace/sigap-kompetensi run dev` — frontend, via its managed workflow
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- OpenAI credentials are managed by Replit AI Integrations; do not print or manually modify them. Hermes credentials must be requested through Replit Secrets, never chat or ordinary environment forms.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- PostgreSQL + Drizzle ORM for authenticated UJK passports, consent, append-only events, upload metadata and idempotent practice attempts. The public catalog remains a versioned reference dataset.
- Clerk for accounts; private App Storage for participant evidence. Do not read or print credentials.
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/sigap-kompetensi` — Indonesian React frontend.
- `artifacts/api-server/src/lib/competency-catalog.ts` — catalog metadata.
- `artifacts/api-server/src/lib/competency-import.json` — normalized uploaded CSV catalog, with archive provenance and review flags; excludes the redundant `_all.csv` copy.
- `artifacts/api-server/src/lib/competency-sources.json` — source-derived unit excerpts from the two supplied PDF documents.
- `artifacts/api-server/src/lib/competency-agents.ts` — bounded source retrieval, examiner and evaluator pipeline.
- `lib/api-spec/openapi.yaml` — API contract; regenerate clients after edits.
- `artifacts/api-server/src/lib/ujk-rules.ts` — deterministic preparation gates; regression checks in `artifacts/api-server/tests/ujk-rules.test.ts`.
- `artifacts/api-server/src/routes/ujk.ts` — participant-owned journeys, self-assessment, K3, evidence and corrections.
- `artifacts/sigap-kompetensi/src/pages/paspor.tsx` and `pages/ujk.tsx` — authenticated passport and journey workspace.

## Architecture decisions

- Start with a bounded, inspectable practice pipeline, not unconstrained autonomous agents that can browse or execute commands.
- `SIGAP_AGENT_RUNTIME` explicitly selects `openai` (default, Replit AI Integrations) or `hermes` (NousResearch Hermes Agent HTTP adapter). There is no runtime fallback. Hermes is not installed or connected in this workspace yet; adapter availability is not a live connection. See `docs/hermes-runtime.md` for the contract and activation gates. MultiClaw is not used.
- Generic practice retains browser-local history, separated by account namespace without silently migrating anonymous records. Practice launched from a UJK journey is also persisted server-side in the participant's passport.
- Passport history is append-only in application flows: corrections add events, and participants cannot overwrite/delete prior entries.
- Evidence is uploaded directly to a short-lived signed PUT URL, then finalized into a separate private object that has never had a participant-facing write URL. Downloads require both database ownership and private object ACL authorization.
- Reference unit lists are not verified certification scheme packages. The `/review` workspace records immutable scheme revisions and human decisions; learner declarations and AI scores cannot satisfy those gates. Research candidates are unverified until the managing institution confirms the official package, codes, revision and validity dates.
- Bootstrap managers via the trusted Clerk server/admin interface: set private metadata `ujkRole` to `manager` for the institution-approved account. Never use unsafe/public metadata or participant self-assignment. A manager appoints another existing Clerk account per case; the participant consents to that exact assignment before private case access. Blank reviewer ID revokes. Managers have no blanket evidence access.
- Review evidence against valid/asli/terkini/memadai with reason and expiry. Submit simulation only after package, unit answers and K3 are available; reviewer sees the captured questions/answers plus report. Subsequent work, scheme revisions, evidence decisions, expiry, assignment or consent changes invalidate prior approvals. K/BK remains the LSP's authority.
- The general K3 gate is an internal preparation exercise referencing historical SMKK KUK, not an official certification test or a claim that the same K3 unit is mandatory in every job scheme. Its result and an internal practice threshold of 75 are separate from LSP decisions.
- AI quotas and concurrency leases are persisted atomically in PostgreSQL across replicas. Upload reservations are counted before signing; expired staging cleanup runs on startup and hourly. See `docs/resource-quotas.md` for limits, UTC windows, cleanup safety and direct PUT limitations.

## Product

Dashboard, searchable 593-entry catalog, source references, role/unit practice, account-based UJK preparation, self-assessment and learning plans, private evidence, internal K3, retained passport history and server-calculated readiness blockers. This is preparation software, not a certification authority. New journeys can only be created for roles with processed source units; the rest remain visible in the catalog.

## User preferences

Interface and responses are in Indonesian. Keep dark/light-blue contrast and legibility.

## Gotchas

- Managed artifact workflows supply PORT and BASE_PATH. Do not create duplicate workflows.
- `scripts/post-merge.sh` pushes additive DB schema and runs `setup-ujk-review.ts`, which installs database append-only guards and seeds honest, unverified provenance. Do not bypass guards to edit audit history.
- The originally attached ZIP was not present among transferred project files; its contents have not been imported.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
