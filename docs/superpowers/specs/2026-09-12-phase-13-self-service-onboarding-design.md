# FLOZ — Phase 13 Design Specification
## Self-Service Onboarding, Workspace Creation, Invitations & Join Flows

**Target Phase:** Phase 13  
**Status:** DESIGN BASELINE — APPROVED BY USER  
**Date:** September 2026  
**Architecture:** Modular Monolith + Async BullMQ Worker + Outbox  
**Primary Tech:** Node.js 22, NestJS API, Next.js Web, PostgreSQL 16 (Drizzle ORM), Redis 7 (BullMQ), Better Auth v1.7.1  

---

## 1. Executive Summary & Goals

Phase 13 mentransformasi arsitektur onboarding Floz dari model *Admin-provisioned account* (Phase 9/12) menjadi **self-service multi-workspace onboarding** (mirip ClickUp/Slack) tanpa mengorbankan isolasi data multi-tenant, model hak akses (RBAC), atau kontrak keamanan produksi Phase 12.

### Fitur Utama yang Dihadirkan:
1. **Public Self-Registration & Email Verification:**
   - Visitor dapat mendaftar sendiri (`POST /api/v1/auth/register`).
   - Email verification wajib diselesaikan sebelum dapat membuat atau bergabung ke workspace secara mandiri.
2. **Atomic Workspace Creation:**
   - User terverifikasi dapat membuat workspace baru (`POST /api/v1/workspaces`).
   - Pembuat otomatis menjadi `ACTIVE ADMIN`. Trigger database bawaan (`workspaces_seed_default_workflow`) mengeksekusi seed workflow dan status standar.
3. **Workspace Invitation Lifecycle:**
   - Admin mengundang melalui email dan menetapkan peran (`ADMIN`, `MANAGER`, `MEMBER`, `FIELD_WORKER`).
   - Token kriptografis tinggi dikirimkan; hanya hash token yang disimpan di database.
   - Mendukung calon user baru maupun user yang sudah terdaftar.
4. **Join Code & Join Link:**
   - Admin dapat mengaktifkan kebijakan `JOIN_CODE` dan men-generate kode (misal `FLOZ-K7M2-P9Q4-W8TZ`).
   - Kode raw hanya diperlihatkan sekali; disimpan dalam bentuk hash di database.
   - Bergabung melalui kode otomatis menetapkan peran `MEMBER`.
5. **Workspace ID + Approval Flow:**
   - Jika kebijakan workspace `APPROVAL_REQUIRED`, user dapat mencari workspace dengan UUID presisi dan mengirimkan join request (`PENDING`).
   - Admin dapat menyetujui (`APPROVE` -> `ACTIVE MEMBER`) atau menolak (`REJECT`).
6. **Fallback Admin Provisioning Dipertahankan:**
   - Fitur `Provision Account` (`POST /workspaces/:wid/accounts`) dan `Add Existing Member` tetap dipertahankan sebagai fallback administratif di UI.
7. **Email Delivery & Local Mailbox:**
   - Produksi menggunakan adapter **Resend**.
   - Dev lokal menggunakan **Outbox Worker + File/Runtime Dev Mailbox** (`.dev-mailbox.json`, di-git-ignore, non-aktif di production).
   - Test otomatis menggunakan **In-Memory Email Adapter** (deterministik, zero network).

---

## 2. Database Schema Design (Migration 0009)

### 2.1 Extension pada Tabel `workspaces`
- Menambahkan kolom `join_policy`:
  - Nilai: `'INVITE_ONLY' | 'JOIN_CODE' | 'APPROVAL_REQUIRED'`
  - Default: `'INVITE_ONLY'`
  - Constraint: `NOT NULL DEFAULT 'INVITE_ONLY'`

### 2.2 Tabel Baru: `workspace_invitations`
- `id` (UUID PK, default random)
- `workspace_id` (UUID FK -> `workspaces.id`, CASCADE on delete)
- `email` (VARCHAR(320), NOT NULL, lower-case normalized)
- `role_id` (UUID FK -> `roles.id`, NOT NULL)
- `token_hash` (VARCHAR, NOT NULL, UNIQUE)
- `status` (VARCHAR(32), NOT NULL, default `'PENDING'`) — Status: `PENDING`, `ACCEPTED`, `DECLINED`, `REVOKED`, `EXPIRED`
- `invited_by` (UUID FK -> `users.id`, NOT NULL)
- `accepted_by` (UUID FK -> `users.id`, NULL)
- `expires_at` (TIMESTAMPTZ, NOT NULL)
- `accepted_at` (TIMESTAMPTZ, NULL)
- `declined_at` (TIMESTAMPTZ, NULL)
- `revoked_at` (TIMESTAMPTZ, NULL)
- `created_at` (TIMESTAMPTZ NOT NULL defaultNow)
- `updated_at` (TIMESTAMPTZ NOT NULL defaultNow)
- **Constraint / Index:**
  - Unique index partial pada `(workspace_id, email)` WHERE `status = 'PENDING'` (mencegah duplikasi undangan aktif).
  - Index pada `(email, status)`, `token_hash`, dan `expires_at`.

### 2.3 Tabel Baru: `workspace_join_requests`
- `id` (UUID PK, default random)
- `workspace_id` (UUID FK -> `workspaces.id`)
- `user_id` (UUID FK -> `users.id`)
- `status` (VARCHAR(32), NOT NULL, default `'PENDING'`) — Status: `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`
- `requested_via` (VARCHAR(32), NOT NULL) — `'WORKSPACE_ID' | 'JOIN_CODE' | 'JOIN_LINK'`
- `reviewed_by` (UUID FK -> `users.id`, NULL)
- `requested_at` (TIMESTAMPTZ NOT NULL defaultNow)
- `reviewed_at` (TIMESTAMPTZ, NULL)
- `created_at` (TIMESTAMPTZ NOT NULL defaultNow)
- `updated_at` (TIMESTAMPTZ NOT NULL defaultNow)
- **Constraint / Index:**
  - Unique index partial pada `(workspace_id, user_id)` WHERE `status = 'PENDING'`.
  - Index pada `(workspace_id, status, requested_at)` dan `(user_id, status)`.

### 2.4 Tabel Baru: `workspace_join_codes`
- `id` (UUID PK, default random)
- `workspace_id` (UUID FK -> `workspaces.id`)
- `code_hash` (VARCHAR, NOT NULL, UNIQUE)
- `created_by` (UUID FK -> `users.id`)
- `expires_at` (TIMESTAMPTZ, NULL)
- `is_active` (BOOLEAN NOT NULL default true)
- `created_at` (TIMESTAMPTZ NOT NULL defaultNow)
- `revoked_at` (TIMESTAMPTZ, NULL)
- **Constraint / Index:**
  - Unique index partial pada `workspace_id` WHERE `is_active = true` (maksimal satu kode aktif per workspace).

---

## 3. API Contract Additions & Modifications

### 3.1 Auth & Verification
- `POST /api/v1/auth/register`
  - Input: `{ email, password, full_name }`
  - Rate-limited via `AuthRateLimitGuard`.
  - Membuat akun di Better Auth (`autoSignIn: false`, `email_verified: false`).
  - Menulis outbox event untuk pengiriman email verifikasi.
  - Return: `202 Accepted` `{ data: { registration_status: "VERIFICATION_REQUIRED" } }`. Tidak mengirimkan cookie session.
- `POST /api/v1/auth/verification/resend`
  - Input: `{ email }`
  - Rate-limited. Anti-enumeration: selalu mengembalikan `202 Accepted`.
- `GET /api/v1/auth/verify-email?token=...` / Better Auth verification callback
  - Mengubah `users.email_verified = true`.

### 3.2 Workspace Self-Creation
- `POST /api/v1/workspaces`
  - Guard: Authenticated + `user.email_verified === true`.
  - Input: `{ name: string, timezone?: string }`
  - Transaksi database:
    1. Insert `workspaces` (generate slug unik, `join_policy: 'INVITE_ONLY'`).
    2. Insert `workspace_memberships` (`role_id: ADMIN`, `status: 'ACTIVE'`).
    3. Trigger DB mengeksekusi seed workflow & default status.
  - Return: `201 Created` dengan payload detail workspace.

### 3.3 Invitation Management
- `POST /api/v1/workspaces/:workspaceId/invitations` (ADMIN only)
  - Input: `{ email: string, role: string }`
  - Generate high-entropy token, simpan sha256 hash ke DB, tulis event outbox.
- `GET /api/v1/workspaces/:workspaceId/invitations` (ADMIN only)
- `POST /api/v1/workspaces/:workspaceId/invitations/:id/resend` (ADMIN only)
- `POST /api/v1/workspaces/:workspaceId/invitations/:id/revoke` (ADMIN only)
- `POST /api/v1/workspace-invitations/preview` (Public / Authenticated)
  - Input: `{ token: string }` -> return `{ workspace_name, invited_email, role, expires_at }`.
- `POST /api/v1/workspace-invitations/accept` (Authenticated + Verified + Email Match)
  - Transaksi: Lock invitation, buat membership `ACTIVE`, update status invitation `ACCEPTED`.
- `POST /api/v1/workspace-invitations/decline`
- `GET /api/v1/me/workspace-invitations` (Menampilkan daftar undangan aktif milik user yang sedang login).

### 3.4 Join Code & Workspace ID Join
- `GET /api/v1/workspaces/:workspaceId/join-settings` (ADMIN only)
- `PATCH /api/v1/workspaces/:workspaceId/join-settings` (ADMIN only) -> update `join_policy`.
- `POST /api/v1/workspaces/:workspaceId/join-code` (ADMIN only) -> generate/rotate kode acak.
- `DELETE /api/v1/workspaces/:workspaceId/join-code` (ADMIN only) -> revoke.
- `POST /api/v1/workspace-joins/preview`
  - Input: `{ workspace_id?: string, join_code?: string }`
  - Return info kebijakan workspace tanpa membocorkan data sensitif.
- `POST /api/v1/workspace-joins`
  - Input: `{ workspace_id?: string, join_code?: string }`
  - Berdasarkan kebijakan: langsung `ACTIVE MEMBER` (jika Join Code valid) atau `PENDING` request (jika `APPROVAL_REQUIRED`).
- `GET /api/v1/me/workspace-join-requests` & `POST /api/v1/workspace-join-requests/:id/cancel`
- `GET /api/v1/workspaces/:workspaceId/join-requests` (ADMIN only)
- `POST /api/v1/workspaces/:workspaceId/join-requests/:id/approve` (ADMIN only -> atomic `ACTIVE MEMBER`)
- `POST /api/v1/workspaces/:workspaceId/join-requests/:id/reject` (ADMIN only)

---

## 4. Web UI & User Journey

1. **Halaman Publik Baru:**
   - `/register`: Pendaftaran nama, email, password dengan link menuju `/login`.
   - `/verify-email`: Halaman konfirmasi verifikasi atau instruksi cek inbox.
   - `/join`: Halaman input Join Code atau Workspace ID (termasuk menangkap parameter URL `?code=...`).
   - `/invitations/accept`: Landing page penerimaan undangan via token URL.
2. **Onboarding Hub (`/onboarding`):**
   - Menggantikan tampilan buntu lama "No workspace access yet".
   - Menyediakan kartu pilihan: `[ Create Workspace ]`, `[ Join Workspace ]`, dan daftar `[ Pending Invitations ]`.
   - Menampilkan peringatan jika email belum diverifikasi beserta tombol Resend Verification.
3. **Workspace Switcher Extension:**
   - Menambahkan menu `+ Create Workspace` dan `+ Join Workspace` pada header desktop dan drawer mobile.
   - Memperbarui context auth agar workspace baru yang dibuat/diterima langsung menjadi aktif tanpa merusak preferensi workspace lama.
4. **Workspace Settings -> Members & Join Settings:**
   - Tab / sub-menu baru untuk mengelola kebijakan join (`INVITE_ONLY`, `JOIN_CODE`, `APPROVAL_REQUIRED`), rotasi kode join, dan approval join requests.

---

## 5. Security & Invariant Hardening

1. **Origin Guard & Rate Limiting:**
   - Endpoint publik mutasi (`/auth/register`, `/workspace-joins`, `/workspace-invitations/accept`) terproteksi oleh `CookieOriginGuard` dan rate limiting khusus.
2. **Proteksi Token & Hash Persistence:**
   - Baik invitation token maupun join code tidak pernah disimpan dalam bentuk plaintext di database. Selalu menggunakan SHA-256 hash.
   - Raw token/kode tidak pernah dicatat pada application log produksi.
3. **Pencegahan Eskalasi Peran:**
   - Self-join melalui Join Code atau Join Request secara ketat dikunci pada peran `MEMBER`.
   - Hanya pembuat workspace yang mendapatkan peran `ADMIN`.
4. **Isolasi Multi-Tenant & Last Active Admin:**
   - Hak akses workspace tetap diverifikasi per request melalui membership. Aturan bahwa workspace tidak boleh kehilangan Admin aktif terakhir (`LAST_ACTIVE_ADMIN`) tetap berlaku penuh.

---

## 6. Email Delivery & Local Testing Strategy

1. **Komponen Email Adapter:**
   - Interface `EmailDeliveryAdapter` dengan method `sendEmail({ to, subject, html, text })`.
   - Implementasi:
     - `ResendEmailAdapter`: Aktif di `NODE_ENV === 'production'`.
     - `DevMailboxEmailAdapter`: Aktif di `NODE_ENV === 'development'`. Menulis pesan ke file lokal `.dev-mailbox.json` di root / temp directory yang terdaftar di `.gitignore`.
     - `InMemoryEmailAdapter`: Digunakan dalam unit/integration/E2E test harness.
2. **Alur Outbox:**
   - API menulis event `OUTBOX_EVENT_TYPE.AUTH_EMAIL_VERIFICATION` dan `OUTBOX_EVENT_TYPE.WORKSPACE_INVITATION` ke tabel outbox.
   - Background worker BullMQ mengambil outbox event dan mengeksekusi adapter email.

---

## 7. Migration Verification & Testing Matrix

1. **Database Migration Tests:**
   - Verifikasi migrasi 0009 pada clean database.
   - Verifikasi migrasi 0009 pada database existing Phase 12 (idempotent & non-destructive).
2. **API & Service Tests:**
   - Registrasi publik, duplikasi email, verifikasi wajib.
   - Transaksi pembuatan workspace atomic.
   - Siklus undangan: create, resend, revoke, expiry, accept concurrency.
   - Siklus Join Code: generate, rotate, revoke, invalid code rate limiting.
   - Siklus Join Request: submit, list, approve, reject, cancel.
   - Uji regresi fitur `Provision Account` lama.
3. **Frontend & E2E Scenarios (Playwright Real-Stack):**
   - Scenario A: Self-register -> Verify -> Login -> Create Workspace -> ACTIVE ADMIN.
   - Scenario B: Create Workspace B -> Switcher -> Pembuktian isolasi data.
   - Scenario C: Undangan user terdaftar -> Accept -> Masuk membership.
   - Scenario D: Undangan email belum terdaftar -> Register -> Verify -> Accept.
   - Scenario E: Join Code -> Join -> MEMBER -> Rotate -> Kode lama gagal.
   - Scenario F: Workspace ID -> Join Request -> Admin Approve -> Member aktif.
   - Scenario G: Regresi Provision Account Admin fallback.
