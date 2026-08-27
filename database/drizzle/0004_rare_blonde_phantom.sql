CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"aggregate_type" varchar(64) NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_by" varchar(255),
	"claimed_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	CONSTRAINT "outbox_events_status_check" CHECK ("outbox_events"."status" IN ('PENDING', 'DISPATCHED', 'FAILED')),
	CONSTRAINT "outbox_events_attempt_count_check" CHECK ("outbox_events"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "recurrence_idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"recurrence_rule_id" uuid,
	"first_occurrence_task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurrence_idempotency_keys_workspace_id_idempotency_key_unique" UNIQUE("workspace_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "recurrence_occurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"recurrence_rule_id" uuid NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"task_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurrence_occurrences_recurrence_rule_id_scheduled_for_unique" UNIQUE("recurrence_rule_id","scheduled_for"),
	CONSTRAINT "recurrence_occurrences_task_id_unique" UNIQUE("task_id")
);
--> statement-breakpoint
CREATE TABLE "recurrence_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"frequency" varchar(16) NOT NULL,
	"interval_value" integer NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone,
	"occurrence_limit" integer,
	"timezone" varchar(64) NOT NULL,
	"next_run_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"anchor_day" integer,
	"generated_count" integer DEFAULT 0 NOT NULL,
	"rule_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"template_snapshot" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurrence_rules_frequency_check" CHECK ("recurrence_rules"."frequency" IN ('DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM')),
	CONSTRAINT "recurrence_rules_interval_value_check" CHECK ("recurrence_rules"."interval_value" > 0),
	CONSTRAINT "recurrence_rules_occurrence_limit_check" CHECK ("recurrence_rules"."occurrence_limit" IS NULL OR "recurrence_rules"."occurrence_limit" > 0),
	CONSTRAINT "recurrence_rules_anchor_day_check" CHECK ("recurrence_rules"."anchor_day" IS NULL OR "recurrence_rules"."anchor_day" BETWEEN 1 AND 31),
	CONSTRAINT "recurrence_rules_generated_count_check" CHECK ("recurrence_rules"."generated_count" >= 0),
	CONSTRAINT "recurrence_rules_end_or_limit_check" CHECK (NOT ("recurrence_rules"."end_at" IS NOT NULL AND "recurrence_rules"."occurrence_limit" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "recurrence_rule_id" uuid;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence_idempotency_keys" ADD CONSTRAINT "recurrence_idempotency_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence_idempotency_keys" ADD CONSTRAINT "recurrence_idempotency_keys_recurrence_rule_id_recurrence_rules_id_fk" FOREIGN KEY ("recurrence_rule_id") REFERENCES "public"."recurrence_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence_idempotency_keys" ADD CONSTRAINT "recurrence_idempotency_keys_first_occurrence_task_id_tasks_id_fk" FOREIGN KEY ("first_occurrence_task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence_occurrences" ADD CONSTRAINT "recurrence_occurrences_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence_occurrences" ADD CONSTRAINT "recurrence_occurrences_recurrence_rule_id_recurrence_rules_id_fk" FOREIGN KEY ("recurrence_rule_id") REFERENCES "public"."recurrence_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence_occurrences" ADD CONSTRAINT "recurrence_occurrences_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence_rules" ADD CONSTRAINT "recurrence_rules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence_rules" ADD CONSTRAINT "recurrence_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbox_events_status_available_idx" ON "outbox_events" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "recurrence_rules_due_scan_idx" ON "recurrence_rules" USING btree ("workspace_id","next_run_at") WHERE "recurrence_rules"."is_active" = true;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_recurrence_rule_id_recurrence_rules_id_fk" FOREIGN KEY ("recurrence_rule_id") REFERENCES "public"."recurrence_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
