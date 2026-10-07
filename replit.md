# SIGAP Kompetensi

Ruang persiapan uji kompetensi konstruksi dengan katalog sumber standar dan latihan berbantuan peran agen AI spesialis.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/sigap-kompetensi run dev` — frontend, via its managed workflow
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- AI credentials are managed by Replit AI Integrations; do not print or manually modify them.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- Available DB: PostgreSQL + Drizzle ORM; current catalog is a versioned reference dataset, and current study history is browser-local.
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/sigap-kompetensi` — Indonesian React frontend.
- `artifacts/api-server/src/lib/competency-catalog.ts` — catalog metadata.
- `artifacts/api-server/src/lib/competency-sources.json` — source-derived unit excerpts from the two supplied PDF documents.
- `artifacts/api-server/src/lib/competency-agents.ts` — bounded source retrieval, examiner and evaluator pipeline.
- `lib/api-spec/openapi.yaml` — API contract; regenerate clients after edits.

## Architecture decisions

- Start with a bounded, inspectable practice pipeline, not unconstrained autonomous agents that can browse or execute commands.
- OpenAI through Replit AI Integrations currently powers generation. MultiClaw/Hermes is not installed or connected; do not claim otherwise.
- Study records are stored in the participant's browser only. There is no user-account or cross-device persistence yet.
- Current AI request caps are process-local safeguards, not production account quotas. Authenticated persistent quotas are needed before a public launch.

## Product

Dashboard, searchable catalog, source references, role/unit selection, scenario questions, text-answer feedback, and locally retained study history. This is preparation software, not a certification authority.

## User preferences

Interface and responses are in Indonesian. Keep dark/light-blue contrast and legibility.

## Gotchas

- Managed artifact workflows supply PORT and BASE_PATH. Do not create duplicate workflows.
- The originally attached ZIP was not present among transferred project files; its contents have not been imported.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
