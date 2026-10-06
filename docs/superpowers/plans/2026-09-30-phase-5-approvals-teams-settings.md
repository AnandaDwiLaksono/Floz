# Phase 5 Implementation Plan: Approvals, Teams/Members & Settings Redesign

> **Starting Base SHA:** `097df12` (`feat(web): redesign dashboards and kpi reporting`)
> **Worktree:** `D:\Portofolio\Floz\app\.worktrees\redesign-approvals-teams-settings`
> **Branch:** `redesign/approvals-teams-settings`
> **Design Vibe:** Modern Calm Workspace (Indonesian-first UI, semantic design tokens, WCAG AA, responsive 1440/1024/768/390, zero AI-slop).

---

## 1. Taste Skills Discovered & Applied
- `design-taste-frontend`: Dial baseline (Variance 5-6, Motion 2-3, Density 6/10), no em-dashes, no purple glow, no broken cards, WCAG AA contrast.
- `redesign-existing-projects`: Preserve information architecture and API contracts, upgrade typography, unified gray tokens, eliminate generic table/card slop.
- `high-end-visual-design`: Double-bezel card structure where appropriate, tactile button feedback, standard 44px touch targets.
- `minimalist-ui`: Calm document-style workspace, crisp borders (`border-border`/`border-subtle`), 1px semantic dividers, restrained status badges.
- `software-development:authenticated-web-qa`: Real login session verification, exact port checks, zero unverified fake passes.
- `software-development:dogfood`: Exploratory browser QA across responsive viewports.

---

## 2. Audit Findings & Target Scope

### A. Approvals (`apps/web/app/workspaces/[workspaceId]/approvals/page.tsx`)
- **Current State:** Functional, includes Inbox/Sent/Managed/All tabs, status filters, cursor pagination, create dialog, approve/reject/cancel modals.
- **Target Polish:**
  - Semantic classes (`bg-surface`, `border-border`, `text-primary`, `bg-overlay`).
  - Indonesian UI labels: Persetujuan, Kotak masuk, Dikirim, Dikelola, Semua, Menunggu, Disetujui, Ditolak, Dibatalkan, Pemohon, Pemberi persetujuan, Setujui, Tolak, Batalkan permintaan.
  - Preserve all invariant tests: button visibility per role (MEMBER, MANAGER, ADMIN), reject reason 3-500 chars required, approve reason max 500 chars optional, cancel reason max 500 chars, 409 `APPROVAL_NOT_PENDING` handling.

### B. Settings Navigation & Subpages
- **Profile (`apps/web/app/workspaces/[workspaceId]/settings/profile/page.tsx`):**
  - Profil, Nama lengkap, Email (read-only), Zona waktu, Bahasa/Locale, Ubah kata sandi (Kata sandi saat ini, Kata sandi baru).
- **Workspace (`apps/web/app/workspaces/[workspaceId]/settings/workspace/page.tsx`):**
  - ADMIN only. Nama workspace, Zona waktu. Slug read-only / immutable.
- **Members (`apps/web/app/workspaces/[workspaceId]/settings/members/page.tsx`):**
  - ADMIN only. List members, role badges (Admin, Manajer, Anggota, Petugas Lapangan), status badges (Aktif, Diundang, Ditangguhkan, Dihapus).
  - Search & filter.
  - Modals: Tambah anggota (Lookup email -> Add), Buat akun (Provision account with one-time temporary password alert), Undangan.
  - Invariant error feedback: `409 LAST_ACTIVE_ADMIN`, `409 ACTIVE_TEAM_MANAGER`.
- **Teams (`apps/web/app/workspaces/[workspaceId]/settings/teams/page.tsx`):**
  - ADMIN only. Team list, active/archived tabs, manager select, create team dialog, archive/restore confirm.
  - Invariant handling: `INVALID_MANAGER`, `TEAM_ARCHIVED`.

### C. Workflow Settings (`apps/web/app/workspaces/[workspaceId]/settings/workflows/page.tsx` & components)
- **Components:**
  - `workflow-status-card.tsx`, `workflow-status-dialog.tsx`, `workflow-status-list.tsx`, `workflow-transition-matrix.tsx`, `workflow-metadata-card.tsx`, `workflow-create-dialog.tsx`.
- **Preserve:**
  - All status ordering, drag + keyboard reorder accessibility.
  - Immutable status code rules, initial status protection.
  - Transition matrix grid & mobile alternative list.
  - `409 VERSION_CONFLICT` optimistic concurrency reloads.
  - Exact test assertions (`Position {s.position}`, category strings, `Default`, `Workspace`, `Archived`).

---

## 3. Step-by-Step Execution Plan

1. **Step 1: Polish Approvals Surface**
   - Refactor `apps/web/app/workspaces/[workspaceId]/approvals/page.tsx` using Modern Calm workspace tokens, semantic badges, dialog backdrop tokens.
   - Verify unit tests: `test/approvals-list.test.tsx`, `test/approval-detail.test.tsx`.

2. **Step 2: Polish Settings Shell & Profile / Workspace Pages**
   - Unify settings sub-nav tabs with semantic tokens.
   - Refactor `settings/profile/page.tsx` and `settings/workspace/page.tsx`.
   - Verify unit tests: `test/settings-admin.test.tsx`.

3. **Step 3: Polish Members & Teams Administration Pages**
   - Refactor `settings/members/page.tsx` and `settings/teams/page.tsx`.
   - Add focus-trap and Escape listener to modals, semantic table and mobile card fallback.
   - Verify unit tests: `test/settings-admin.test.tsx`, `test/member-pages.test.tsx`.

4. **Step 4: Polish Workflow Components**
   - Refine `workflow-status-list.tsx`, `workflow-transition-matrix.tsx`, `workflow-metadata-card.tsx`, `workflow-create-dialog.tsx` with clean semantic tokens.
   - Verify unit tests: `test/workflow-settings.test.tsx`, `test/workflow-status-list.test.tsx`, `test/workflow-transition-matrix.test.tsx`.

5. **Step 5: Full Verification & Static Gates**
   - Run `pnpm --filter @floz/web test -- --run` (all 256+ tests).
   - Run `pnpm --filter @floz/web typecheck`.
   - Run `pnpm --filter @floz/web lint`.
   - Run `pnpm --filter @floz/web build`.
   - Check `git status` and `git diff` to ensure zero unintended mutations and zero auto-commits.

6. **Step 6: Authenticated QA & Report**
   - Check Playwright / isolated test harness and report exact runtime evidence or port/credential prerequisites.

---

## 4. Stop Condition
When all Phase 5 surfaces are redesigned, all tests pass, and QA evidence is captured:
**STOP.** Leave all changes uncommitted for human review.
