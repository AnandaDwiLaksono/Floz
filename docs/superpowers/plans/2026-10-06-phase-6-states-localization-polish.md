# Phase 6 Implementation Plan — Global States, Localization & UX Polish

> **Worktree:** `D:\Portofolio\Floz\app\.worktrees\redesign-states-localization-polish`
> **Branch:** `redesign/states-localization-polish`
> **Starting HEAD:** `d1910a1` (`feat(web): redesign approvals teams and settings`)
> **Design Vibe:** Modern Calm Workspace (Indonesian-first UI, semantic design tokens, WCAG AA, responsive 1440/1024/768/390, zero AI-slop).

---

## 1. Audit Findings & Classification

### A. Localization (BLOCKER / HIGH)
- Public & Auth-adjacent pages (`/login`, `/register`, `/join`, `/verify-email`, `/onboarding`, `/onboarding/create-workspace`, `/invitations/accept`) feature English system UI labels and messages.
- Error boundary fallbacks (`app/error.tsx`, `app/global-error.tsx`) render English headings (`Unable to load this page`, `Application error`), body text, and button labels (`Try again`, `Reload application`), with `app/global-error.tsx` using `lang="en"`.
- `apps/web/app/workspaces/[workspaceId]/approvals/page.tsx` renders `ADMIN Override` in English instead of `Pengambilalihan Admin`.
- `test/error-boundaries.test.tsx` and `test/approvals-list.test.tsx` contain English assertions (`Unable to load this page`, `Try again`, `/Inbox|Kotak Masuk/i`, `/Sent|Dikirim/i`, `/Managed|Dikelola/i`, `/All|Semua/i`) that must be updated to exact Indonesian assertions.

### B. Date/Time Presentation Consistency (MEDIUM)
- `approvals/page.tsx` uses raw browser `new Date(...).toLocaleString()` for timestamp rendering instead of canonical `formatDateTimeDisplay()` from `lib/i18n-labels.ts`.

### C. Loading, Empty & Error States (HIGH / MEDIUM)
- Public routes (`/login`, `/register`, `/join`, `/verify-email`, `/onboarding`, `/invitations/accept`) use generic text (`Loading...`, `Loading invitation details...`) or spinner-only elements. Replace with structured skeleton loaders preserving container hierarchy.
- `TaskCommentsSection` uses spinner-only loading (`Loader2`) without skeleton fallback and displays raw English fallback error text (`Failed to load comments`).

### D. Theme Consistency & Semantic Tokens (HIGH)
- Auth and onboarding pages (`/login`, `/register`, `/join`, `/verify-email`, `/onboarding`, `/onboarding/create-workspace`, `/invitations/accept`) use arbitrary hardcoded Tailwind classes (`bg-gray-50 dark:bg-gray-950`, `bg-blue-600`, `border-gray-200 dark:border-gray-800`, `focus:ring-blue-500`). Replace with semantic design tokens (`bg-background`, `bg-surface`, `bg-primary`, `border-border`, `text-primary`, `ring-ring`).
- `TaskCommentsSection` uses arbitrary `bg-blue-600`, `bg-gray-50`, `border-gray-200`. Replace with semantic design tokens.

### E. Visual Polish & Emoji Removal (MEDIUM)
- Replace raw emojis (`✉️`, `🏢`) in `/register` and `/onboarding` with clean Lucide icons (`Mail`, `Building2`).

---

## 2. Targeted Execution Steps

### STEP 1: Localize Error Boundaries & Update Tests
- Refactor `apps/web/app/error.tsx` and `apps/web/app/global-error.tsx` to Indonesian (`lang="id"`, `Gagal Memuat Halaman`, `Muat Ulang Halaman`, etc.).
- Update `apps/web/test/error-boundaries.test.tsx` to match exact Indonesian assertions.

### STEP 2: Localize Auth & Public Surfaces with Semantic Tokens
- Refactor `/login`, `/register`, `/join`, `/verify-email`, `/onboarding`, `/onboarding/create-workspace`, `/invitations/accept`:
  - Translate all system labels, placeholders, titles, and error messages to Indonesian.
  - Replace arbitrary Tailwind color classes with semantic tokens (`bg-surface`, `border-border`, `text-foreground`, `bg-primary`, `ring-ring`).
  - Replace raw emojis with Lucide icons (`Mail`, `Building2`).
  - Add pending/disabled state feedback on submit buttons and input fields.
  - Include accessible aria attributes (`aria-describedby`, `aria-invalid`).

### STEP 3: Polish Workspace Surfaces & Presentation Consistency
- Refactor `approvals/page.tsx`:
  - Replace `ADMIN Override` with `Pengambilalihan Admin`.
  - Replace `toLocaleString()` with `formatDateTimeDisplay()` for `submitted_at`, `decided_at`, `completed_at`.
- Refactor `TaskCommentsSection`:
  - Replace hardcoded colors with semantic design tokens.
  - Translate fallback error text to Indonesian.

### STEP 4: Update Unit Tests & Vitest Verification
- Update `test/approvals-list.test.tsx` to use exact Indonesian assertions (`Kotak Masuk`, `Dikirim`, `Dikelola`, `Semua`).
- Run Vitest suite: `npx pnpm --filter @floz/web test -- --run`.

### STEP 5: Static Verification Gates
- Run `npx pnpm --filter @floz/web typecheck`.
- Run `npx pnpm --filter @floz/web lint`.
- Run `npx pnpm --filter @floz/web build`.

### STEP 6: Authenticated Visual QA & Git Hygiene
- Verify isolated runtime and screenshots across representative surfaces.
- Ensure `next-env.d.ts` is restored, untracked temporary files cleaned, and `git status` is clean before reporting.

---

## 3. Scope Boundaries & Invariants
- NO backend schema changes or API contract modifications.
- NO PWA, service worker, or offline features.
- NO extra design systems or new visual paradigms.
- NO changes to user-entered data (workspace names, project names, user titles).
- NO commits, pushes, merges, or deployments during this phase.
