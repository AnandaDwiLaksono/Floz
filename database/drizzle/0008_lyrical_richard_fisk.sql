ALTER TABLE "task_statuses" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "workflows" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
DO $$
BEGIN
  -- 1. Check duplicate lower status names within any workflow
  IF EXISTS (SELECT 1 FROM task_statuses GROUP BY workflow_id, LOWER(name) HAVING COUNT(*) > 1) THEN
    RAISE EXCEPTION 'Phase 11 Preflight Violation: Duplicate case-insensitive status names exist within a workflow.';
  END IF;

  -- 2. Check duplicate active workspace defaults
  IF EXISTS (SELECT 1 FROM workflows WHERE team_id IS NULL AND is_default = true AND is_active = true GROUP BY workspace_id HAVING COUNT(*) > 1) THEN
    RAISE EXCEPTION 'Phase 11 Preflight Violation: Multiple active workspace default workflows exist.';
  END IF;

  -- 3. Check duplicate active team defaults
  IF EXISTS (SELECT 1 FROM workflows WHERE team_id IS NOT NULL AND is_default = true AND is_active = true GROUP BY workspace_id, team_id HAVING COUNT(*) > 1) THEN
    RAISE EXCEPTION 'Phase 11 Preflight Violation: Multiple active team default workflows exist for a team.';
  END IF;

  -- 4. Check duplicate active initial statuses
  IF EXISTS (SELECT 1 FROM task_statuses WHERE is_initial = true AND is_active = true GROUP BY workflow_id HAVING COUNT(*) > 1) THEN
    RAISE EXCEPTION 'Phase 11 Preflight Violation: Multiple active initial statuses exist within a workflow.';
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX "task_statuses_workflow_name_lower_idx" ON "task_statuses" USING btree ("workflow_id",LOWER("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "task_statuses_active_initial_idx" ON "task_statuses" USING btree ("workflow_id") WHERE is_initial = true AND is_active = true;--> statement-breakpoint
CREATE UNIQUE INDEX "workflows_active_workspace_default_idx" ON "workflows" USING btree ("workspace_id") WHERE team_id IS NULL AND is_default = true AND is_active = true;--> statement-breakpoint
CREATE UNIQUE INDEX "workflows_active_team_default_idx" ON "workflows" USING btree ("workspace_id","team_id") WHERE team_id IS NOT NULL AND is_default = true AND is_active = true;
