CREATE INDEX IF NOT EXISTS tasks_workspace_status_idx ON tasks (workspace_id, status_id);
CREATE INDEX IF NOT EXISTS tasks_workspace_priority_idx ON tasks (workspace_id, priority);
CREATE UNIQUE INDEX IF NOT EXISTS task_assignees_one_primary_idx ON task_assignees (task_id) WHERE is_primary;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION floz_seed_default_workflow() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE workflow_id uuid; todo_id uuid; doing_id uuid; done_id uuid;
BEGIN
  INSERT INTO workflows(workspace_id, code, name, is_default, created_by) VALUES(NEW.id, 'DEFAULT', 'Default workflow', true, NEW.created_by) RETURNING id INTO workflow_id;
  INSERT INTO task_statuses(workflow_id, code, name, category, position, is_initial) VALUES(workflow_id, 'TODO', 'To do', 'OPEN', 1, true) RETURNING id INTO todo_id;
  INSERT INTO task_statuses(workflow_id, code, name, category, position) VALUES(workflow_id, 'IN_PROGRESS', 'In progress', 'ACTIVE', 2) RETURNING id INTO doing_id;
  INSERT INTO task_statuses(workflow_id, code, name, category, position, is_terminal) VALUES(workflow_id, 'DONE', 'Done', 'DONE', 3, true) RETURNING id INTO done_id;
  INSERT INTO workflow_transitions(workflow_id, from_status_id, to_status_id) VALUES (workflow_id, todo_id, doing_id), (workflow_id, doing_id, done_id), (workflow_id, done_id, doing_id);
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS workspaces_seed_default_workflow ON workspaces;
CREATE TRIGGER workspaces_seed_default_workflow AFTER INSERT ON workspaces FOR EACH ROW EXECUTE FUNCTION floz_seed_default_workflow();
