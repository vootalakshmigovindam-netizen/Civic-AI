# CivicAI

CivicAI lets residents report neighborhood infrastructure issues, follow status updates, and lets authorized local teams manage reports.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/civicai run dev` — run the CivicAI web app
- `pnpm run typecheck` — full typecheck across all packages
- `PORT=5000 BASE_PATH=/ pnpm --filter @workspace/civicai run build` — build the web app outside its managed workflow
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Optional env: `CIVICAI_AUTHORITY_EMAILS` — comma-separated authority email allowlist, applied at login
- Optional secret: `OPENAI_API_KEY` — enables OpenAI photo analysis; otherwise analysis clearly reports demo mode

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5, Replit OIDC sessions, private object storage
- Web: React, Vite, Leaflet and OpenStreetMap
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/civicai/src/pages/civic-pages.tsx` — CivicAI routes and report/map/dashboard interfaces
- `artifacts/civicai/src/civic.css` and `leaflet-overrides.css` — application visual system and map styling
- `artifacts/api-server/src/routes/civicai.ts` — report, AI analysis, status and summary endpoints
- `artifacts/api-server/src/routes/storage.ts` — signed direct photo uploads and private photo access
- `lib/api-spec/openapi.yaml` — source of truth for API contracts and generated hooks
- `lib/db/src/schema/complaints.ts` and `auth.ts` — PostgreSQL schema

## Architecture decisions

- Citizens authenticate before submitting so photo ownership and report history are protected.
- Authority access is granted only to emails listed in `CIVICAI_AUTHORITY_EMAILS`; all other accounts are citizens.
- Complaint photos are private to their owner and authorized authorities. Public responses omit photos and round map coordinates.
- Image analysis uses `OPENAI_API_KEY` only when present and falls back to an explicitly labeled demo suggestion if unavailable.

## Product

Residents can submit a categorized, prioritized civic issue with a location and optional photo, view public reports on a filterable map, track their own reports, and read a status timeline. Authorized staff can search reports and publish status updates with notes.

## User preferences

External AI credentials must be added through Replit Secrets, not pasted into chat or committed to the repository.

## Gotchas

- Authority email allowlist changes affect role assignment at login; affected users should sign in again.
- Direct OpenStreetMap tile requests need network access in the browser.
- Standalone Vite builds need both `PORT` and `BASE_PATH`; managed workflows provide them.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
