# Floz Phase 0

## Local setup

Requirements: Node.js 22+, Corepack.

```bash
corepack enable
pnpm install
pnpm --filter @floz/database migrate
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Run services:

```bash
pnpm --filter @floz/web dev
pnpm --filter @floz/api start
pnpm --filter @floz/worker start
```

API health: `GET http://localhost:3001/api/v1/health`.
