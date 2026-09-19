-- Custom SQL migration for Phase 13: Self-Service Onboarding, Workspace Creation, Invitations & Join Flows

ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "join_policy" varchar(32) DEFAULT 'INVITE_ONLY' NOT NULL;

CREATE TABLE IF NOT EXISTS "workspace_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
	"email" varchar(320) NOT NULL,
	"role_id" uuid NOT NULL REFERENCES "roles"("id"),
	"token_hash" varchar(255) NOT NULL UNIQUE,
	"status" varchar(32) DEFAULT 'PENDING' NOT NULL,
	"invited_by" uuid NOT NULL REFERENCES "users"("id"),
	"accepted_by" uuid REFERENCES "users"("id"),
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"declined_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "workspace_invitations_workspace_email_pending_idx" ON "workspace_invitations" ("workspace_id", "email") WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS "workspace_invitations_workspace_status_idx" ON "workspace_invitations" ("workspace_id", "status");
CREATE INDEX IF NOT EXISTS "workspace_invitations_email_status_idx" ON "workspace_invitations" ("email", "status");
CREATE INDEX IF NOT EXISTS "workspace_invitations_expires_at_idx" ON "workspace_invitations" ("expires_at");

CREATE TABLE IF NOT EXISTS "workspace_join_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"status" varchar(32) DEFAULT 'PENDING' NOT NULL,
	"requested_via" varchar(32) DEFAULT 'WORKSPACE_ID' NOT NULL,
	"reviewed_by" uuid REFERENCES "users"("id"),
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "workspace_join_requests_workspace_user_pending_idx" ON "workspace_join_requests" ("workspace_id", "user_id") WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS "workspace_join_requests_workspace_status_idx" ON "workspace_join_requests" ("workspace_id", "status", "requested_at");
CREATE INDEX IF NOT EXISTS "workspace_join_requests_user_status_idx" ON "workspace_join_requests" ("user_id", "status");

CREATE TABLE IF NOT EXISTS "workspace_join_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
	"code_hash" varchar(255) NOT NULL UNIQUE,
	"created_by" uuid NOT NULL REFERENCES "users"("id"),
	"expires_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);

CREATE UNIQUE INDEX IF NOT EXISTS "workspace_join_codes_active_code_idx" ON "workspace_join_codes" ("workspace_id") WHERE is_active = true;
