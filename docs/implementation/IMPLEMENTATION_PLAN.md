# Phase 0 implementation plan

## Goal
Establish a runnable pnpm TypeScript monorepo without business behavior or database schema.

## Deliverables

1. Pin pnpm 9.15.4 and Node 22.
2. Add web, API, and worker applications.
3. Add shared config, observability, contracts, domain, validation, UI, database, and infrastructure boundaries.
4. Add lint, typecheck, Vitest, build, CI, Docker Compose, Caddy, environment examples, and local setup.
5. Trace architecture and API baselines from sibling Documentation without modifying them.
6. Record genuine open decisions: ORM, auth transport/provider, recurrence persistence details, queue/outbox implementation, provider choices.

## Verification

Run `pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` from this directory. Git is initialized but no commit is created.
