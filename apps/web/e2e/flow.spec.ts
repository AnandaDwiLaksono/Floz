import { test, expect, type Page } from '@playwright/test';
import type { WorkflowDetail } from '../lib/api-client';
import { createDatabase, accounts, sessions, users, verifications } from '@floz/database';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

const databaseUrl = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5433/floz';
const auth = betterAuth({ database: drizzleAdapter(createDatabase(databaseUrl).db as never, { provider: 'pg', schema: { user: users, account: accounts, session: sessions, verification: verifications } }), emailAndPassword: { enabled: true }, advanced: { database: { generateId: 'uuid' } } });

async function resetDb() {
  const { sql } = createDatabase(databaseUrl);
  await sql`TRUNCATE team_memberships, teams, workspace_memberships, workspaces, roles, sessions, accounts, users, verifications RESTART IDENTITY CASCADE`;
  await sql`INSERT INTO roles (code, name) VALUES ('ADMIN', 'Admin'), ('MEMBER', 'Member') ON CONFLICT DO NOTHING`;
  await sql.end();
}

test.describe('Floz Kanban', () => {
  test.beforeEach(resetDb);
  test('login, load, filter, non-drag transition, detail persistence, and conflict rollback', async ({ page }) => {
    const { sql } = createDatabase(databaseUrl);
    const admin = await auth.api.signUpEmail({ body: { email: 'admin@example.com', password: 'password123', name: 'Admin User' } });
    const member = await auth.api.signUpEmail({ body: { email: 'member@example.com', password: 'password123', name: 'Member User' } });
    const workspaceId = 'a8ee46bf-5d8f-4ba1-b3fb-0750fb9e7e7c';
    const adminRoleId = String((await sql`SELECT id FROM roles WHERE code='ADMIN'`)[0].id);
    const memberRoleId = String((await sql`SELECT id FROM roles WHERE code='MEMBER'`)[0].id);
    await sql`INSERT INTO workspaces (id,name,slug,created_by,is_active) VALUES (${workspaceId},'Test Work','test-work',${String(admin.user.id)},true)`;
    await sql`INSERT INTO workspace_memberships (workspace_id,user_id,role_id,status) VALUES (${workspaceId},${String(admin.user.id)},${adminRoleId},'ACTIVE'),(${workspaceId},${String(member.user.id)},${memberRoleId},'ACTIVE')`;
    await sql.end();
    await page.goto('/login');
    await page.fill('#email', 'admin@example.com');
    await page.fill('#password', 'password123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(new RegExp(`/workspaces/${workspaceId}/tasks`));
    await page.click('button:has-text("New Task")');
    await page.fill('input#title', 'Kanban Task');
    await page.selectOption('select#priority', 'HIGH');
    await page.click('button:has-text("Create")');
    await page.goto(`/workspaces/${workspaceId}/kanban`);
    await expect(page.getByRole('heading', { name: 'Kanban' })).toBeVisible();
    await page.getByLabel('Priority').selectOption('HIGH');
    await expect(page.getByText('Kanban Task')).toBeVisible();
    const transitionSaved = page.waitForResponse(r => r.url().includes('/transitions') && r.request().method() === 'POST');
    await page.getByLabel('Change status for Kanban Task').selectOption({ label: 'In progress' });
    expect((await transitionSaved).ok()).toBe(true);
    await expect(page.locator('section').filter({ hasText: 'In progress' }).getByText('1', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: /Kanban Task/ }).click();
    await expect(page.getByRole('dialog', { name: 'Task details' })).toBeVisible();
    await expect(page.getByText('Change Status')).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Task details' }).getByText('In progress', { exact: true })).toBeVisible();
    await page.goto(`/workspaces/${workspaceId}/kanban`);
    await expect(page.getByLabel('Change status for Kanban Task')).toBeVisible();
    const stale = createDatabase(databaseUrl);
    await stale.sql`UPDATE tasks SET version=version+1 WHERE title='Kanban Task'`;
    await stale.sql.end();
    await page.getByLabel('Change status for Kanban Task').selectOption({ label: 'Done' });
    await expect(page.getByText('VERSION_CONFLICT')).toBeVisible();
    await expect(page.getByText('Kanban Task')).toBeVisible();
  });

  test('recurring create persists its rule and first task through refresh', async ({ page }) => {
    const { sql } = createDatabase(databaseUrl);
    const admin = await auth.api.signUpEmail({ body: { email: 'recurring@example.com', password: 'password123', name: 'Recurring Admin' } });
    const workspaceId = 'a8ee46bf-5d8f-4ba1-b3fb-0750fb9e7e7c';
    const adminRoleId = String((await sql`SELECT id FROM roles WHERE code='ADMIN'`)[0].id);
    await sql`INSERT INTO workspaces (id,name,slug,timezone,created_by,is_active) VALUES (${workspaceId},'Recurring Work','recurring-work','Asia/Jakarta',${String(admin.user.id)},true)`;
    await sql`INSERT INTO workspace_memberships (workspace_id,user_id,role_id,status) VALUES (${workspaceId},${String(admin.user.id)},${adminRoleId},'ACTIVE')`;

    await page.goto('/login');
    await page.fill('#email', 'recurring@example.com');
    await page.fill('#password', 'password123');
    await page.click('button[type="submit"]');
    await page.getByRole('button', { name: 'New Task' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create Task' });
    await dialog.locator('#title').fill('Recurring browser task');
    await dialog.locator('#start_at').fill('2026-09-01T09:00');
    await dialog.locator('#enable_recurring').check();
    await expect(dialog.getByText('CUSTOM recurrence is not supported.')).toBeVisible();
    await dialog.locator('#recurrence_frequency').selectOption('WEEKLY');
    await dialog.locator('#recurrence_interval').fill('2');
    await dialog.locator('#recurrence_timezone').fill('Asia/Jakarta');
    await dialog.locator('#recurrence_occurrence_limit').fill('3');
    await expect(dialog.locator('#recurrence_end_date')).toBeDisabled();
    await dialog.getByRole('button', { name: 'Create' }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText('Recurring browser task')).toBeVisible();
    const rule = (await sql`SELECT id,frequency,interval_value,timezone,occurrence_limit FROM recurrence_rules WHERE workspace_id=${workspaceId}`)[0];
    expect(rule).toMatchObject({ frequency: 'WEEKLY', interval_value: 2, timezone: 'Asia/Jakarta', occurrence_limit: 3 });
    const occurrence = (await sql`SELECT o.task_id,t.title FROM recurrence_occurrences o JOIN tasks t ON t.id=o.task_id WHERE o.recurrence_rule_id=${rule.id}`)[0];
    expect(occurrence).toMatchObject({ title: 'Recurring browser task' });
    await page.reload();
    await expect(page.getByText('Recurring browser task')).toBeVisible();
    await sql.end();
  });

  test('calendar create handoff opens task form with prefilled schedule fields', async ({ page }) => {
    const { sql } = createDatabase(databaseUrl);
    const admin = await auth.api.signUpEmail({ body: { email: 'admin2@example.com', password: 'password123', name: 'Admin User' } });
    const workspaceId = 'a8ee46bf-5d8f-4ba1-b3fb-0750fb9e7e7c';
    const adminRoleId = String((await sql`SELECT id FROM roles WHERE code='ADMIN'`)[0].id);
    await sql`INSERT INTO workspaces (id,name,slug,timezone,created_by,is_active) VALUES (${workspaceId},'Test Work','test-work','Asia/Jakarta',${String(admin.user.id)},true)`;
    await sql`INSERT INTO workspace_memberships (workspace_id,user_id,role_id,status) VALUES (${workspaceId},${String(admin.user.id)},${adminRoleId},'ACTIVE')`;
    await sql.end();

    await page.goto('/login');
    await page.fill('#email', 'admin2@example.com');
    await page.fill('#password', 'password123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(new RegExp(`/workspaces/${workspaceId}/tasks`));
    await page.goto(`/workspaces/${workspaceId}/tasks?create=1&prefill_start_at=2026-08-18T09:00&prefill_due_at=2026-08-18T10:00&prefill_timezone=America%2FNew_York`);
    const dialog = page.getByRole('dialog', { name: 'Create Task' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('input#start_at')).toHaveValue('2026-08-18T09:00');
    await expect(dialog.locator('input#due_at')).toHaveValue('2026-08-18T10:00');
    await dialog.locator('input#title').fill('Timezone handoff');
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(dialog).toBeHidden();
    const stored = createDatabase(databaseUrl);
    const saved = (await stored.sql`SELECT start_at FROM tasks WHERE title='Timezone handoff'`)[0];
    expect(saved).toBeTruthy();
    expect(new Date(saved.start_at).toISOString()).toBe('2026-08-18T02:00:00.000Z');
    await stored.sql.end();
  });

  test('login, open calendar, navigate ranges, filter, create from context, and open task detail', async ({ page }) => {
    const { sql } = createDatabase(databaseUrl);
    const admin = await auth.api.signUpEmail({ body: { email: 'admin3@example.com', password: 'password123', name: 'Admin User' } });
    const member = await auth.api.signUpEmail({ body: { email: 'member3@example.com', password: 'password123', name: 'Member User' } });
    const workspaceId = 'a8ee46bf-5d8f-4ba1-b3fb-0750fb9e7e7c';
    const teamId = '0c2beefd-8f51-4a71-a943-db2b14b3eb92';
    const workflowId = '127e7f8d-ff0a-42fa-8da9-4e33e852d864';
    const todoStatusId = '90bedc5e-361e-4f75-a57f-bb9b63a35580';
    const adminRoleId = String((await sql`SELECT id FROM roles WHERE code='ADMIN'`)[0].id);
    const memberRoleId = String((await sql`SELECT id FROM roles WHERE code='MEMBER'`)[0].id);
    await sql`INSERT INTO workspaces (id,name,slug,timezone,created_by,is_active) VALUES (${workspaceId},'Test Work','test-work','Asia/Jakarta',${String(admin.user.id)},true)`;
    await sql`INSERT INTO workspace_memberships (workspace_id,user_id,role_id,status) VALUES (${workspaceId},${String(admin.user.id)},${adminRoleId},'ACTIVE'),(${workspaceId},${String(member.user.id)},${memberRoleId},'ACTIVE')`;
    await sql`INSERT INTO teams (id,workspace_id,name,is_active) VALUES (${teamId},${workspaceId},'Ops',true)`;
    await sql`INSERT INTO workflows (id,workspace_id,code,name,is_default,is_active,created_by) VALUES (${workflowId},${workspaceId},'CALENDAR','Calendar workflow',false,true,${String(admin.user.id)})`;
    await sql`INSERT INTO task_statuses (id,workflow_id,code,name,category,position,is_initial,is_terminal) VALUES (${todoStatusId},${workflowId},'TODO','To do','todo',1,true,false)`;
    const scheduled = String((await sql`INSERT INTO tasks (workspace_id,task_key,title,workflow_id,status_id,priority,team_id,creator_id,start_at,due_at) VALUES (${workspaceId},'TASK-1','Scheduled',${workflowId},${todoStatusId},'HIGH',${teamId},${String(admin.user.id)},'2026-08-10T02:00:00.000Z','2026-08-10T03:00:00.000Z') RETURNING id`)[0].id);
    await sql`INSERT INTO task_assignees (task_id,user_id,is_primary,assigned_by) VALUES (${scheduled},${String(member.user.id)},true,${String(admin.user.id)})`;
    await sql`INSERT INTO tasks (workspace_id,task_key,title,workflow_id,status_id,priority,creator_id,due_at) VALUES (${workspaceId},'TASK-2','Deadline task',${workflowId},${todoStatusId},'MEDIUM',${String(admin.user.id)},'2026-08-18T03:00:00.000Z')`;
    await sql.end();

    await page.goto('/login');
    await page.fill('#email', 'admin3@example.com');
    await page.fill('#password', 'password123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(new RegExp(`/workspaces/${workspaceId}/tasks`));
    await page.goto(`/workspaces/${workspaceId}/calendar?view=month&date=2026-08-18`);
    await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible();
    const deadlineBtn = page.getByRole('button', { name: 'Deadline task', exact: true });
    await expect(deadlineBtn).toBeVisible();
    await expect(page.getByText('Deadline only')).toBeVisible();
    await page.getByRole('button', { name: 'Week view' }).click();
    await expect(page).toHaveURL(/view=week/);
    await page.getByRole('button', { name: 'Next period' }).click();
    await expect(page).toHaveURL(/date=/);
    await page.getByLabel('Team').selectOption(teamId);
    await expect(page).toHaveURL(new RegExp(`team_id=${teamId}`));
    await page.getByRole('button', { name: /Create task on/ }).first().click();
    await expect(page).toHaveURL(/\/tasks\?/);
    await expect(page).toHaveURL(/prefill_timezone=Asia%2FJakarta/);
    await expect(page.locator('input#start_at')).not.toHaveValue('');
    await page.goto(`/workspaces/${workspaceId}/calendar?view=day&date=2026-08-10`);
    await page.getByRole('button', { name: 'Scheduled', exact: true }).click();
    await expect(page).toHaveURL(/selected_task_id=/);
    await expect(page.getByText('Change Status')).toBeVisible();
  });

  test('calendar invalid URL state does not fetch calendar tasks', async ({ page }) => {
    const { sql } = createDatabase(databaseUrl);
    const admin = await auth.api.signUpEmail({ body: { email: 'admin5@example.com', password: 'password123', name: 'Admin User' } });
    const workspaceId = 'a8ee46bf-5d8f-4ba1-b3fb-0750fb9e7e7c';
    const adminRoleId = String((await sql`SELECT id FROM roles WHERE code='ADMIN'`)[0].id);
    await sql`INSERT INTO workspaces (id,name,slug,timezone,created_by,is_active) VALUES (${workspaceId},'Test Work','test-work','Asia/Jakarta',${String(admin.user.id)},true)`;
    await sql`INSERT INTO workspace_memberships (workspace_id,user_id,role_id,status) VALUES (${workspaceId},${String(admin.user.id)},${adminRoleId},'ACTIVE')`;
    await sql.end();
    await page.goto('/login');
    await page.fill('#email', 'admin5@example.com');
    await page.fill('#password', 'password123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(new RegExp(`/workspaces/${workspaceId}/tasks`));
    const calendarRequests: string[] = [];
    page.on('request', (request) => { if (request.url().includes('/calendar/tasks')) calendarRequests.push(request.url()); });
    await page.goto(`/workspaces/${workspaceId}/calendar?view=bad&date=2026-02-31`);
    await expect(page.getByText('Invalid calendar view.')).toBeVisible();
    expect(calendarRequests).toEqual([]);
  });

  test('calendar mobile smoke renders agenda controls', async ({ page }) => {
    page.setViewportSize({ width: 390, height: 844 });
    const { sql } = createDatabase(databaseUrl);
    const admin = await auth.api.signUpEmail({ body: { email: 'admin4@example.com', password: 'password123', name: 'Admin User' } });
    const workspaceId = 'a8ee46bf-5d8f-4ba1-b3fb-0750fb9e7e7c';
    const adminRoleId = String((await sql`SELECT id FROM roles WHERE code='ADMIN'`)[0].id);
    await sql`INSERT INTO workspaces (id,name,slug,timezone,created_by,is_active) VALUES (${workspaceId},'Test Work','test-work','Asia/Jakarta',${String(admin.user.id)},true)`;
    await sql`INSERT INTO workspace_memberships (workspace_id,user_id,role_id,status) VALUES (${workspaceId},${String(admin.user.id)},${adminRoleId},'ACTIVE')`;
    await sql.end();
    await page.goto('/login');
    await page.fill('#email', 'admin4@example.com');
    await page.fill('#password', 'password123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(new RegExp(`/workspaces/${workspaceId}/tasks`));
    await page.goto(`/workspaces/${workspaceId}/calendar?view=day&date=2026-08-18`);
    await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create task on 2026-08-18' })).toBeVisible();
  });

  test('reporting fixtures cover roles, scopes, periods, drilldowns, mobile, and keyboard access', async ({ page, request }) => {
    await page.addInitScript(() => { Date = class extends Date { constructor(value?: string | number | Date) { super(value ?? '2026-09-03T00:00:00.000Z'); } static now() { return Date.parse('2026-09-03T00:00:00.000Z'); } } as DateConstructor; });
    const { sql } = createDatabase(databaseUrl);
    const workspaceId = 'd8ee46bf-5d8f-4ba1-b3fb-0750fb9e7e7c';
    const managedTeamId = 'dc2beefd-8f51-4a71-a943-db2b14b3eb92';
    const unmanagedTeamId = 'ec2beefd-8f51-4a71-a943-db2b14b3eb92';
    const people = await Promise.all([
      auth.api.signUpEmail({ body: { email: 'report-admin@example.com', password: 'password123', name: 'Report Admin' } }),
      auth.api.signUpEmail({ body: { email: 'report-manager@example.com', password: 'password123', name: 'Report Manager' } }),
      auth.api.signUpEmail({ body: { email: 'report-member@example.com', password: 'password123', name: 'Report Member' } }),
      auth.api.signUpEmail({ body: { email: 'report-worker@example.com', password: 'password123', name: 'Report Worker' } }),
    ]);
    const [adminId, managerId, memberId, workerId] = people.map((person) => String(person.user.id));
    await sql`INSERT INTO roles (code,name) VALUES ('MANAGER','Manager'),('FIELD_WORKER','Field Worker') ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name`;
    const roles = await sql`SELECT id,code FROM roles`;
    const role = (code: string) => String(roles.find((row) => row.code === code)!.id);
    await sql`INSERT INTO workspaces (id,name,slug,timezone,created_by,is_active) VALUES (${workspaceId},'Reporting Work','reporting-work','UTC',${adminId},true)`;
    await sql`INSERT INTO workspace_memberships (workspace_id,user_id,role_id,status) VALUES (${workspaceId},${adminId},${role('ADMIN')},'ACTIVE'),(${workspaceId},${managerId},${role('MANAGER')},'ACTIVE'),(${workspaceId},${memberId},${role('MEMBER')},'ACTIVE'),(${workspaceId},${workerId},${role('FIELD_WORKER')},'ACTIVE')`;
    await sql`INSERT INTO teams (id,workspace_id,name,manager_user_id,is_active) VALUES (${managedTeamId},${workspaceId},'Managed Ops',${managerId},true),(${unmanagedTeamId},${workspaceId},'Unmanaged Ops',NULL,true)`;
    await sql`INSERT INTO team_memberships (team_id,user_id,membership_role) VALUES (${managedTeamId},${memberId},'MEMBER'),(${managedTeamId},${workerId},'MEMBER')`;
    const workflow = (await sql`SELECT id FROM workflows WHERE workspace_id=${workspaceId} LIMIT 1`)[0];
    const statuses = await sql`SELECT id,code FROM task_statuses WHERE workflow_id=${workflow.id}`;
    const cancelledStatusId = 'fc2beefd-8f51-4a71-a943-db2b14b3eb92';
    await sql`INSERT INTO task_statuses (id,workflow_id,code,name,category,position,is_terminal) VALUES (${cancelledStatusId},${workflow.id},'CANCELLED','Cancelled','CANCELLED',999,true)`;
    const status = (code: string) => code === 'CANCELLED' ? cancelledStatusId : String(statuses.find((row) => row.code === code)!.id);
    const start = new Date('2026-09-01T00:00:00.000Z');
    const tomorrow = new Date('2026-09-02T00:00:00.000Z');
    const afterTomorrow = new Date('2026-09-03T00:00:00.000Z');
    const yesterday = new Date('2026-08-31T00:00:00.000Z');
    const taskRows = await sql`INSERT INTO tasks (workspace_id,task_key,title,workflow_id,status_id,priority,team_id,creator_id,due_at,completed_at,created_at) VALUES
      (${workspaceId},'RPT-1','Due today member',${workflow.id},${status('TODO')},'HIGH',${managedTeamId},${adminId},${new Date(start.getTime()+3600000).toISOString()},NULL,${start.toISOString()}),
      (${workspaceId},'RPT-2','Tomorrow midnight upcoming',${workflow.id},${status('TODO')},'URGENT',${managedTeamId},${adminId},${tomorrow.toISOString()},NULL,${start.toISOString()}),
      (${workspaceId},'RPT-3','Strictly overdue',${workflow.id},${status('TODO')},'MEDIUM',${managedTeamId},${adminId},${yesterday.toISOString()},NULL,${start.toISOString()}),
      (${workspaceId},'RPT-4','Equality is not overdue',${workflow.id},${status('TODO')},'LOW',${managedTeamId},${adminId},${start.toISOString()},NULL,${start.toISOString()}),
      (${workspaceId},'RPT-5','Done in period',${workflow.id},${status('DONE')},'HIGH',${managedTeamId},${adminId},${new Date(start.getTime()+7200000).toISOString()},${new Date(start.getTime()+5400000).toISOString()},${start.toISOString()}),
      (${workspaceId},'RPT-6','Cancelled excluded',${workflow.id},${status('CANCELLED')},'URGENT',${managedTeamId},${adminId},${new Date(start.getTime()+7200000).toISOString()},NULL,${start.toISOString()}),
      (${workspaceId},'RPT-7','Managed unassigned',${workflow.id},${status('TODO')},'HIGH',${managedTeamId},${adminId},${afterTomorrow.toISOString()},NULL,${start.toISOString()}),
      (${workspaceId},'RPT-8','Outside team assignee',${workflow.id},${status('TODO')},'LOW',${unmanagedTeamId},${adminId},${afterTomorrow.toISOString()},NULL,${start.toISOString()}) RETURNING id,task_key`;
    const id = (key: string) => String(taskRows.find((row) => row.task_key === key)!.id);
    await sql`INSERT INTO task_assignees (task_id,user_id,is_primary,assigned_by) VALUES (${id('RPT-1')},${memberId},true,${adminId}),(${id('RPT-2')},${memberId},true,${adminId}),(${id('RPT-3')},${memberId},true,${adminId}),(${id('RPT-4')},${memberId},true,${adminId}),(${id('RPT-5')},${memberId},true,${adminId}),(${id('RPT-6')},${memberId},true,${adminId}),(${id('RPT-8')},${workerId},true,${adminId})`;
    await sql.end();

    const login = async (email: string) => {
      await page.goto('/login');
      await page.getByLabel('Email').fill(email);
      await page.getByLabel('Password').fill('password123');
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page).toHaveURL(new RegExp(`/workspaces/${workspaceId}/tasks`));
    };
    await login('report-member@example.com');
    await page.goto(`/workspaces/${workspaceId}/my-work`);
    await expect(page.getByRole('heading', { name: 'My Work' })).toBeVisible();
    await expect(page.getByText('Due today member')).toBeVisible();
    await expect(page.getByText('Tomorrow midnight upcoming')).toBeVisible();
    await expect(page.getByText('Strictly overdue')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Overdue/ }).locator('..')).not.toContainText('Equality is not overdue');
    await page.getByRole('button', { name: /Due today member/ }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`selected_task_id=${id('RPT-1')}`));
    await page.goto(`/workspaces/${workspaceId}/dashboard`);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText(/%$/).first()).toBeVisible();
    await expect(page.getByText(/(?:h|m)$/).last()).toBeVisible();
    const activeHref = await page.getByRole('link', { name: 'View active tasks' }).getAttribute('href');
    expect(activeHref).toContain('/tasks?assignee_id=');

    await page.context().clearCookies();
    await login('report-worker@example.com');
    await page.goto(`/workspaces/${workspaceId}/my-work`);
    await expect(page.getByText('Outside team assignee')).toBeVisible();
    await page.goto(`/workspaces/${workspaceId}/manager-dashboard`);
    await expect(page.getByText('MANAGER or ADMIN access required.')).toBeVisible();

    await page.context().clearCookies();
    await login('report-manager@example.com');
    await page.goto(`/workspaces/${workspaceId}/manager-dashboard`);
    await expect(page.getByRole('heading', { name: 'Manager dashboard' })).toBeVisible();
    await expect(page.getByText('Managed Ops')).toBeVisible();
    await expect(page.getByText('Unmanaged Ops')).not.toBeVisible();
    await expect(page.getByText('Unassigned workload')).toBeVisible();
    const from = start.toISOString().slice(0, 10);
    await page.getByLabel('From').fill(from);
    await page.getByLabel('To').fill(from);
    await expect(page.getByRole('heading', { name: 'KPI reporting' })).toBeVisible();
    const workloadTable = page.getByRole('table', { name: 'Workload by team' });
    await expect(workloadTable).toContainText('Managed ops');
    await expect(workloadTable).toContainText('5');
    const priorityTable = page.getByRole('table', { name: 'Priority breakdown' });
    await expect(priorityTable).toContainText('Urgent');
    await expect(priorityTable).toContainText('High');
    await expect(priorityTable).toContainText('Medium');
    await expect(priorityTable).toContainText('Low');
    await expect(page.getByText('33%')).toBeVisible();
    await expect(page.getByText('1h 30m')).toBeVisible();
    const report = await page.evaluate(async ({ workspaceId, apiUrl }) => {
      const response = await fetch(`${apiUrl}/api/v1/workspaces/${workspaceId}/reports/kpis?from=2026-09-01T00%3A00%3A00.000Z&to=2026-09-02T00%3A00%3A00.000Z&evaluationAt=1999-01-01T00%3A00%3A00.000Z`, { credentials: 'include' });
      return { status: response.status, body: await response.json() };
    }, { workspaceId, apiUrl: process.env.NEXT_PUBLIC_API_URL! });
    expect(report).toMatchObject({ status: 200, body: { data: { completion_rate: '0.333333', overdue_rate: '0.666667', on_time_completion_rate: '1.000000', average_completion_time_seconds: '5400', workload: 5, denominators: { due: 3, completed: 1, overdue: 2, onTime: 1 }, period: { evaluationAt: '2026-09-03T00:00:00.000Z' } } } });
    const unassignedHref = await page.getByRole('link', { name: 'View unassigned tasks' }).getAttribute('href');
    expect(unassignedHref).toContain('/tasks?assignee_id=unassigned');

    await page.context().clearCookies();
    await login('report-admin@example.com');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/workspaces/${workspaceId}/manager-dashboard`);
    await expect(page.getByRole('heading', { name: 'Manager dashboard' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Priority breakdown' })).toBeVisible();
    await page.locator('body').press('Tab');
    for (let i = 0; i < 20 && await page.getByLabel('To').evaluate((element) => element !== document.activeElement); i++) await page.keyboard.press('Tab');
    await expect(page.getByLabel('To')).toBeFocused();
    const apiResponse = await request.get(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/health`);
    expect(apiResponse.ok()).toBe(true);
  });

  test('notification badge updates, opens popover, clicks item to mark read and navigate', async ({ page }) => {
    const { sql } = createDatabase(databaseUrl);
    const admin = await auth.api.signUpEmail({ body: { email: 'notif_admin@example.com', password: 'password123', name: 'Notif Admin' } });
    const workspaceId = 'a8ee46bf-5d8f-4ba1-b3fb-0750fb9e7e7c';
    const taskId = 'b9ee46bf-5d8f-4ba1-b3fb-0750fb9e7e7c';
    const adminRoleId = String((await sql`SELECT id FROM roles WHERE code='ADMIN'`)[0].id);
    await sql`INSERT INTO workspaces (id,name,slug,timezone,created_by,is_active) VALUES (${workspaceId},'Notif WS','notif-ws','Asia/Jakarta',${String(admin.user.id)},true)`;
    await sql`INSERT INTO workspace_memberships (workspace_id,user_id,role_id,status) VALUES (${workspaceId},${String(admin.user.id)},${adminRoleId},'ACTIVE')`;
    
    const defaultWorkflow = (await sql<{ id: string }[]>`SELECT id FROM workflows WHERE workspace_id=${workspaceId} LIMIT 1`)[0];
    const status = (await sql<{ id: string }[]>`SELECT id FROM task_statuses WHERE workflow_id=${defaultWorkflow.id} LIMIT 1`)[0];
    await sql`
      INSERT INTO tasks (id, workspace_id, task_key, title, workflow_id, status_id, creator_id)
      VALUES (${taskId}, ${workspaceId}, 'NOTIF-1', 'Notif Task', ${defaultWorkflow.id}, ${status.id}, ${String(admin.user.id)})
    `;

    // Seed notifications directly
    await sql`
      INSERT INTO notifications (workspace_id, user_id, type, title, body, is_read, entity_type, entity_id)
      VALUES (${workspaceId}, ${String(admin.user.id)}, 'TASK_ASSIGNED', 'New assigned task E2E', 'You have been assigned to test notifications', false, 'TASK', ${taskId})
    `;
    await sql.end();

    await page.goto('/login');
    await page.fill('#email', 'notif_admin@example.com');
    await page.fill('#password', 'password123');
    await page.click('button[type="submit"]');

    // 1. Unread count badge is visible
    const bellBtn = page.getByRole('button', { name: /Notifications, 1 unread/i });
    await expect(bellBtn).toBeVisible();
    await expect(bellBtn.locator('span')).toHaveText('1');

    // 2. Open popover
    await bellBtn.click();
    await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
    await expect(page.getByText('New assigned task E2E')).toBeVisible();

    // 3. Mark read and navigate on item click
    await page.getByRole('button', { name: 'New assigned task E2E' }).click();
    await expect(page).toHaveURL(new RegExp(`/workspaces/${workspaceId}/tasks\\?selected_task_id=${taskId}`));

    // 4. Badge is gone (0 unread)
    const bellBtnAfter = page.getByRole('button', { name: /Notifications, 0 unread/i });
    await expect(bellBtnAfter).toBeVisible();
    await expect(bellBtnAfter.locator('span')).toBeHidden();
  });

  test('phase9 task 8 reschedule preserves calendar context and persists new schedule', async ({ page }) => {
    const { sql } = createDatabase(databaseUrl);
    const admin = await auth.api.signUpEmail({ body: { email: 'resched@example.com', password: 'password123', name: 'Resched Admin' } });
    const workspaceId = 'a8ee46bf-5d8f-4ba1-b3fb-0750fb9e7e7c';
    const workflowId = '127e7f8d-ff0a-42fa-8da9-4e33e852d864';
    const todoStatusId = '90bedc5e-361e-4f75-a57f-bb9b63a35580';
    const adminRoleId = String((await sql`SELECT id FROM roles WHERE code='ADMIN'`)[0].id);
    await sql`INSERT INTO workspaces (id,name,slug,timezone,created_by,is_active) VALUES (${workspaceId},'Resched Work','resched-work','Asia/Jakarta',${String(admin.user.id)},true)`;
    await sql`INSERT INTO workspace_memberships (workspace_id,user_id,role_id,status) VALUES (${workspaceId},${String(admin.user.id)},${adminRoleId},'ACTIVE')`;
    await sql`INSERT INTO workflows (id,workspace_id,code,name,is_default,is_active,created_by) VALUES (${workflowId},${workspaceId},'RESCHED','Resched workflow',false,true,${String(admin.user.id)})`;
    await sql`INSERT INTO task_statuses (id,workflow_id,code,name,category,position,is_initial,is_terminal) VALUES (${todoStatusId},${workflowId},'TODO','To do','todo',1,true,false)`;
    const taskId = String((await sql`INSERT INTO tasks (workspace_id,task_key,title,workflow_id,status_id,priority,creator_id,start_at,due_at) VALUES (${workspaceId},'RS-1','Resched Task',${workflowId},${todoStatusId},'HIGH',${String(admin.user.id)},'2026-08-10T02:00:00.000Z','2026-08-10T03:00:00.000Z') RETURNING id`)[0].id);
    await sql.end();

    await page.goto('/login');
    await page.fill('#email', 'resched@example.com');
    await page.fill('#password', 'password123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(new RegExp(`/workspaces/${workspaceId}/tasks`));
    await page.goto(`/workspaces/${workspaceId}/calendar?view=month&date=2026-08-10`);
    await expect(page.getByRole('button', { name: 'Resched Task', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Reschedule Resched Task' }).click();
    await expect(page).toHaveURL(/edit_schedule=1/);
    await expect(page).toHaveURL(/cal_view=month/);
    await expect(page).toHaveURL(/cal_date=2026-08-10/);
    const dialog = page.getByRole('dialog', { name: 'Task details' });
    await expect(dialog.getByText('Edit Task Fields')).toBeVisible();
    await dialog.locator('#edit_start_at').fill('2026-08-12T09:00');
    await dialog.locator('#edit_due_at').fill('2026-08-12T10:00');
    await dialog.getByRole('button', { name: 'Save Changes' }).click();
    await expect(dialog.getByText('Edit Task Fields')).toBeHidden();
    const stored = createDatabase(databaseUrl);
    const saved = (await stored.sql`SELECT start_at,due_at FROM tasks WHERE id=${taskId}`)[0];
    expect(new Date(saved.start_at).getTime()).not.toBe(Date.parse('2026-08-10T02:00:00.000Z'));
    expect(new Date(saved.due_at).getTime()).not.toBe(Date.parse('2026-08-10T03:00:00.000Z'));
    await stored.sql.end();
    await dialog.getByRole('button', { name: 'Return to Calendar' }).click();
    await expect(page).toHaveURL(new RegExp(`/workspaces/${workspaceId}/calendar\\?view=month&date=2026-08-10`));
    await expect(page.getByRole('button', { name: 'Resched Task', exact: true })).toBeVisible();
  });

  test('phase9 task 9 field worker quick status uses server transitions and updates projection', async ({ page }) => {
    const { sql } = createDatabase(databaseUrl);
    const admin = await auth.api.signUpEmail({ body: { email: 'qs-admin@example.com', password: 'password123', name: 'QS Admin' } });
    const worker = await auth.api.signUpEmail({ body: { email: 'qs-worker@example.com', password: 'password123', name: 'QS Worker' } });
    const workspaceId = 'a8ee46bf-5d8f-4ba1-b3fb-0750fb9e7e7c';
    await sql`INSERT INTO roles (code,name) VALUES ('FIELD_WORKER','Field Worker') ON CONFLICT (code) DO NOTHING`;
    const adminRoleId = String((await sql`SELECT id FROM roles WHERE code='ADMIN'`)[0].id);
    const workerRoleId = String((await sql`SELECT id FROM roles WHERE code='FIELD_WORKER'`)[0].id);
    await sql`INSERT INTO workspaces (id,name,slug,timezone,created_by,is_active) VALUES (${workspaceId},'QS Work','qs-work','UTC',${String(admin.user.id)},true)`;
    await sql`INSERT INTO workspace_memberships (workspace_id,user_id,role_id,status) VALUES (${workspaceId},${String(admin.user.id)},${adminRoleId},'ACTIVE'),(${workspaceId},${String(worker.user.id)},${workerRoleId},'ACTIVE')`;
    const workflow = (await sql`SELECT id FROM workflows WHERE workspace_id=${workspaceId} AND code='DEFAULT'`)[0];
    const todoId = String((await sql`SELECT id FROM task_statuses WHERE workflow_id=${workflow.id} AND code='TODO'`)[0].id);
    const doneId = String((await sql`SELECT id FROM task_statuses WHERE workflow_id=${workflow.id} AND code='DONE'`)[0].id);
    const reviewId = String((await sql`INSERT INTO task_statuses (workflow_id,code,name,category,position) VALUES (${workflow.id},'REVIEW','In review','ACTIVE',4) RETURNING id`)[0].id);
    await sql`INSERT INTO workflow_transitions (workflow_id,from_status_id,to_status_id) VALUES (${workflow.id},${todoId},${reviewId}),(${workflow.id},${todoId},${doneId})`;
    const taskId = String((await sql`INSERT INTO tasks (workspace_id,task_key,title,workflow_id,status_id,priority,creator_id,due_at) VALUES (${workspaceId},'QST-1','Quick status task',${workflow.id},${todoId},'HIGH',${String(admin.user.id)},'2026-01-01T00:00:00.000Z') RETURNING id`)[0].id);
    await sql`INSERT INTO task_assignees (task_id,user_id,is_primary,assigned_by) VALUES (${taskId},${String(worker.user.id)},true,${String(admin.user.id)})`;
    await sql.end();

    await page.goto('/login');
    await page.fill('#email', 'qs-worker@example.com');
    await page.fill('#password', 'password123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(new RegExp(`/workspaces/${workspaceId}/tasks`));
    await page.goto(`/workspaces/${workspaceId}/my-work`);
    await expect(page.getByRole('heading', { name: 'My Work' })).toBeVisible();
    await expect(page.getByText('Quick status task')).toBeVisible();
    await expect(page.getByRole('button', { name: 'To Done' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Quick status for QST-1' }).click();
    await expect(page.getByRole('button', { name: 'To In review' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'To Done' })).toBeVisible();
    await page.getByRole('button', { name: 'To Done' }).click();
    await expect(page.getByText('No overdue tasks.')).toBeVisible();
    const stored = createDatabase(databaseUrl);
    const saved = (await stored.sql`SELECT status_id FROM tasks WHERE id=${taskId}`)[0];
    expect(String(saved.status_id)).toBe(doneId);
    await stored.sql.end();
  });

  test('phase9 task 11 admin provisions account with no-workspace login and password change', async ({ page }) => {
    const { sql } = createDatabase(databaseUrl);
    const admin = await auth.api.signUpEmail({ body: { email: 'prov-admin@example.com', password: 'password123', name: 'Prov Admin' } });
    const workspaceId = 'a8ee46bf-5d8f-4ba1-b3fb-0750fb9e7e7c';
    const adminRoleId = String((await sql`SELECT id FROM roles WHERE code='ADMIN'`)[0].id);
    await sql`INSERT INTO workspaces (id,name,slug,timezone,created_by,is_active) VALUES (${workspaceId},'Prov Work','prov-work','UTC',${String(admin.user.id)},true)`;
    await sql`INSERT INTO workspace_memberships (workspace_id,user_id,role_id,status) VALUES (${workspaceId},${String(admin.user.id)},${adminRoleId},'ACTIVE')`;
    await sql.end();

    await page.goto('/login');
    await page.fill('#email', 'prov-admin@example.com');
    await page.fill('#password', 'password123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(new RegExp(`/workspaces/${workspaceId}/tasks`));
    await page.goto(`/workspaces/${workspaceId}/settings/members`);
    await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();
    await page.getByRole('button', { name: 'Provision Account' }).focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Provision Account' });
    await expect(dialog).toBeVisible();
    await dialog.locator('#prov_email').fill('newhire@example.com');
    await dialog.locator('#prov_name').fill('New Hire');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(dialog.getByText('Account Created')).toBeVisible();
    await expect(dialog.getByText('Copy this password now. It will not be shown again.')).toBeVisible();
    const tempPassword = await dialog.locator('input[readonly]').inputValue();
    expect(tempPassword.length).toBeGreaterThanOrEqual(24);
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'prov-admin@example.com' })).toBeVisible();
    const me = await page.evaluate(async ({ apiUrl }) => {
      const res = await fetch(`${apiUrl}/api/v1/me`, { credentials: 'include' });
      return { status: res.status, body: await res.json() };
    }, { apiUrl: process.env.NEXT_PUBLIC_API_URL! });
    expect(me.status).toBe(200);
    expect(me.body.data.email).toBe('prov-admin@example.com');
    const membersList = await page.evaluate(async ({ workspaceId, apiUrl }) => {
      const res = await fetch(`${apiUrl}/api/v1/workspaces/${workspaceId}/members`, { credentials: 'include' });
      return res.json();
    }, { workspaceId, apiUrl: process.env.NEXT_PUBLIC_API_URL! });
    expect(JSON.stringify(membersList)).not.toContain(tempPassword);

    await page.context().clearCookies();
    await page.goto('/login');
    await page.fill('#email', 'newhire@example.com');
    await page.fill('#password', tempPassword);
    await page.click('button[type="submit"]');
    await expect(page.getByRole('heading', { name: 'No workspace access yet' })).toBeVisible();
    await expect(page.locator('section').getByText('newhire@example.com')).toBeVisible();
    await page.locator('#current_password').fill(tempPassword);
    await page.locator('#new_password').fill('brand-new-password-456');
    await page.locator('#new_password').press('Enter');
    await expect(page.getByText('Password changed.')).toBeVisible();
    await page.locator('main').getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.fill('#email', 'newhire@example.com');
    await page.fill('#password', tempPassword);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeEnabled();
    await page.fill('#password', 'brand-new-password-456');
    await page.click('button[type="submit"]');
    await expect(page.getByRole('heading', { name: 'No workspace access yet' })).toBeVisible();
  });

  test('phase9 task 11 workspace settings and member lifecycle with last-admin protection', async ({ page }) => {
    const { sql } = createDatabase(databaseUrl);
    const admin = await auth.api.signUpEmail({ body: { email: 't11-admin@example.com', password: 'password123', name: 'T11 Admin' } });
    await auth.api.signUpEmail({ body: { email: 'member-b@example.com', password: 'password123', name: 'Member Bee' } });
    await sql`INSERT INTO roles (code,name) VALUES ('MANAGER','Manager'),('FIELD_WORKER','Field Worker') ON CONFLICT (code) DO NOTHING`;
    const workspaceId = 'a8ee46bf-5d8f-4ba1-b3fb-0750fb9e7e7c';
    const adminRoleId = String((await sql`SELECT id FROM roles WHERE code='ADMIN'`)[0].id);
    await sql`INSERT INTO workspaces (id,name,slug,timezone,created_by,is_active) VALUES (${workspaceId},'Settings Work','settings-work','Asia/Jakarta',${String(admin.user.id)},true)`;
    await sql`INSERT INTO workspace_memberships (workspace_id,user_id,role_id,status) VALUES (${workspaceId},${String(admin.user.id)},${adminRoleId},'ACTIVE')`;
    await sql.end();

    await page.goto('/login');
    await page.fill('#email', 't11-admin@example.com');
    await page.fill('#password', 'password123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(new RegExp(`/workspaces/${workspaceId}/tasks`));
    await page.goto(`/workspaces/${workspaceId}/settings/workspace`);
    await page.locator('#ws_name').fill('Renamed Work');
    await page.locator('#ws_timezone').fill('UTC');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Workspace updated.')).toBeVisible();
    const renamed = createDatabase(databaseUrl);
    const ws = (await renamed.sql`SELECT name,slug,timezone FROM workspaces WHERE id=${workspaceId}`)[0];
    expect(ws).toMatchObject({ name: 'Renamed Work', slug: 'settings-work', timezone: 'UTC' });
    await renamed.sql.end();

    await page.goto(`/workspaces/${workspaceId}/settings/members`);
    await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();
    await page.getByRole('button', { name: 'Add Member' }).click();
    const addDialog = page.getByRole('dialog', { name: 'Add Member' });
    await addDialog.locator('#add_email').fill('member-b@example.com');
    await addDialog.getByRole('button', { name: 'Add', exact: true }).click();
    const memberRow = page.locator('tbody tr', { hasText: 'member-b@example.com' });
    await expect(memberRow).toBeVisible();
    const statusReload = page.waitForResponse((r) => r.url().includes('/members') && r.request().method() === 'GET');
    await memberRow.getByLabel('Status for member-b@example.com').selectOption('ACTIVE');
    await statusReload;
    await expect(memberRow.getByLabel('Status for member-b@example.com')).toHaveValue('ACTIVE');
    const roleReload = page.waitForResponse((r) => r.url().includes('/members') && r.request().method() === 'GET');
    await memberRow.getByLabel('Role for member-b@example.com').selectOption('MANAGER');
    await roleReload;
    await expect(memberRow.getByLabel('Role for member-b@example.com')).toHaveValue('MANAGER');
    const adminRow = page.locator('tbody tr', { hasText: 't11-admin@example.com' });
    await adminRow.getByLabel('Role for t11-admin@example.com').selectOption('MEMBER');
    await expect(page.getByText(/At least one active admin/i)).toBeVisible();
    await expect(adminRow.getByLabel('Role for t11-admin@example.com')).toHaveValue('ADMIN');
  });

  test('phase9 task 11 team lifecycle with invalid restore rejection and manager scope', async ({ page }) => {
    const { sql } = createDatabase(databaseUrl);
    const admin = await auth.api.signUpEmail({ body: { email: 'team-admin@example.com', password: 'password123', name: 'Team Admin' } });
    const manager = await auth.api.signUpEmail({ body: { email: 'team-manager@example.com', password: 'password123', name: 'Team Manager' } });
    const teammate = await auth.api.signUpEmail({ body: { email: 'teammate@example.com', password: 'password123', name: 'Team Mate' } });
    await sql`INSERT INTO roles (code,name) VALUES ('MANAGER','Manager'),('FIELD_WORKER','Field Worker') ON CONFLICT (code) DO NOTHING`;
    const managerId = String(manager.user.id);
    const teammateId = String(teammate.user.id);
    const workspaceId = 'a8ee46bf-5d8f-4ba1-b3fb-0750fb9e7e7c';
    const adminRoleId = String((await sql`SELECT id FROM roles WHERE code='ADMIN'`)[0].id);
    const managerRoleId = String((await sql`SELECT id FROM roles WHERE code='MANAGER'`)[0].id);
    const memberRoleId = String((await sql`SELECT id FROM roles WHERE code='MEMBER'`)[0].id);
    await sql`INSERT INTO workspaces (id,name,slug,timezone,created_by,is_active) VALUES (${workspaceId},'Team Work','team-work','UTC',${String(admin.user.id)},true)`;
    await sql`INSERT INTO workspace_memberships (workspace_id,user_id,role_id,status) VALUES (${workspaceId},${String(admin.user.id)},${adminRoleId},'ACTIVE'),(${workspaceId},${managerId},${managerRoleId},'ACTIVE'),(${workspaceId},${teammateId},${memberRoleId},'ACTIVE')`;
    const workflow = (await sql`SELECT id FROM workflows WHERE workspace_id=${workspaceId} AND code='DEFAULT'`)[0];
    const todoId = String((await sql`SELECT id FROM task_statuses WHERE workflow_id=${workflow.id} AND code='TODO'`)[0].id);
    await sql`INSERT INTO teams (id,workspace_id,name,is_active) VALUES ('0c2beefd-8f51-4a71-a943-db2b14b3eb92',${workspaceId},'Seeded',true)`;
    const seededTask = String((await sql`INSERT INTO tasks (workspace_id,task_key,title,workflow_id,status_id,priority,creator_id,due_at) VALUES (${workspaceId},'TM-0','Seeded workload',${workflow.id},${todoId},'MEDIUM',${String(admin.user.id)},'2026-08-01T00:00:00.000Z') RETURNING id`)[0].id);
    await sql`INSERT INTO task_assignees (task_id,user_id,is_primary,assigned_by) VALUES (${seededTask},${teammateId},true,${String(admin.user.id)})`;
    await sql.end();

    const login = async (email: string) => {
      await page.goto('/login');
      await page.fill('#email', email);
      await page.fill('#password', 'password123');
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL(new RegExp(`/workspaces/${workspaceId}/tasks`));
    };
    await login('team-admin@example.com');
    await page.goto(`/workspaces/${workspaceId}/settings/teams`);
    await expect(page.getByRole('heading', { name: 'Teams' })).toBeVisible();
    await page.getByRole('button', { name: 'New Team' }).click();
    const createDialog = page.getByRole('dialog', { name: 'Create Team' });
    await createDialog.locator('#team_name').fill('Ops');
    await createDialog.locator('#team_manager').selectOption({ label: 'Team Manager' });
    await createDialog.getByRole('button', { name: 'Create', exact: true }).click();
    const card = page.locator('div.space-y-3 > div', { hasText: 'Ops' });
    await expect(card).toBeVisible();
    await expect(card.getByText('Active')).toBeVisible();
    const stored = createDatabase(databaseUrl);
    const created = (await stored.sql`SELECT id,manager_user_id,is_active FROM teams WHERE workspace_id=${workspaceId} AND name='Ops'`)[0];
    const teamId = String(created.id);
    expect(String(created.manager_user_id)).toBe(managerId);
    await stored.sql`UPDATE tasks SET team_id=${teamId} WHERE id=${seededTask}`;
    const clearReload = page.waitForResponse((r) => r.url().includes('/teams') && r.request().method() === 'GET');
    await card.getByRole('combobox').selectOption({ label: 'No manager' });
    await clearReload;
    const cleared = (await stored.sql`SELECT manager_user_id FROM teams WHERE id=${teamId}`)[0];
    expect(cleared.manager_user_id).toBeNull();
    const reassignReload = page.waitForResponse((r) => r.url().includes('/teams') && r.request().method() === 'GET');
    await card.getByRole('combobox').selectOption(managerId);
    await reassignReload;
    const reassigned = (await stored.sql`SELECT manager_user_id FROM teams WHERE id=${teamId}`)[0];
    expect(String(reassigned.manager_user_id)).toBe(managerId);

    await page.context().clearCookies();
    await login('team-manager@example.com');
    await page.goto(`/workspaces/${workspaceId}/manager-dashboard`);
    await expect(page.getByRole('heading', { name: 'Manager dashboard' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Workload by team' })).toContainText('Ops');

    await page.context().clearCookies();
    await login('team-admin@example.com');
    await page.goto(`/workspaces/${workspaceId}/settings/teams`);
    await page.locator('div.space-y-3 > div', { hasText: 'Ops' }).getByRole('button', { name: 'Archive' }).click();
    const archivedCard = page.locator('div.space-y-3 > div', { hasText: 'Ops' });
    await expect(archivedCard.getByText('Archived')).toBeVisible();
    await page.goto(`/workspaces/${workspaceId}/settings/members`);
    await expect(page.locator('tbody tr', { hasText: 'team-manager@example.com' })).toBeVisible();
    const demoteReload = page.waitForResponse((r) => r.url().includes('/members') && r.request().method() === 'GET');
    await page.locator('tbody tr', { hasText: 'team-manager@example.com' }).getByLabel('Role for team-manager@example.com').selectOption('MEMBER');
    await demoteReload;
    await page.goto(`/workspaces/${workspaceId}/settings/teams`);
    await page.getByRole('button', { name: 'Archived', exact: true }).click();
    await page.locator('div.space-y-3 > div', { hasText: 'Ops' }).getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByText(/active manager or admin/i)).toBeVisible();
    const rejectedAdd = await page.evaluate(async ({ workspaceId, teamId, userId, apiUrl }) => {
      const res = await fetch(`${apiUrl}/api/v1/workspaces/${workspaceId}/teams/${teamId}/members`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ user_id: userId }) });
      return { status: res.status, text: await res.text() };
    }, { workspaceId, teamId, userId: teammateId, apiUrl: process.env.NEXT_PUBLIC_API_URL! });
    expect(rejectedAdd.status).toBe(409);
    expect(rejectedAdd.text).toContain('TEAM_ARCHIVED');
    await page.goto(`/workspaces/${workspaceId}/settings/members`);
    await expect(page.locator('tbody tr', { hasText: 'team-manager@example.com' })).toBeVisible();
    const promoteReload = page.waitForResponse((r) => r.url().includes('/members') && r.request().method() === 'GET');
    await page.locator('tbody tr', { hasText: 'team-manager@example.com' }).getByLabel('Role for team-manager@example.com').selectOption('MANAGER');
    await promoteReload;
    await page.goto(`/workspaces/${workspaceId}/settings/teams`);
    await page.getByRole('button', { name: 'Archived', exact: true }).click();
    await page.locator('div.space-y-3 > div', { hasText: 'Ops' }).getByRole('button', { name: 'Restore' }).click();
    await page.getByRole('button', { name: 'Active', exact: true }).click();
    await expect(page.locator('div.space-y-3 > div', { hasText: 'Ops' }).getByText('Active')).toBeVisible();
    await stored.sql.end();
  });

  test('phase9 task 11 multi-assignee task creation persists single primary', async ({ page }) => {
    const { sql } = createDatabase(databaseUrl);
    const admin = await auth.api.signUpEmail({ body: { email: 'multi-admin@example.com', password: 'password123', name: 'Multi Admin' } });
    const first = await auth.api.signUpEmail({ body: { email: 'multi-a@example.com', password: 'password123', name: 'Multi Alpha' } });
    const second = await auth.api.signUpEmail({ body: { email: 'multi-b@example.com', password: 'password123', name: 'Multi Beta' } });
    const firstId = String(first.user.id);
    const secondId = String(second.user.id);
    const workspaceId = 'a8ee46bf-5d8f-4ba1-b3fb-0750fb9e7e7c';
    const adminRoleId = String((await sql`SELECT id FROM roles WHERE code='ADMIN'`)[0].id);
    const memberRoleId = String((await sql`SELECT id FROM roles WHERE code='MEMBER'`)[0].id);
    await sql`INSERT INTO workspaces (id,name,slug,timezone,created_by,is_active) VALUES (${workspaceId},'Multi Work','multi-work','UTC',${String(admin.user.id)},true)`;
    await sql`INSERT INTO workspace_memberships (workspace_id,user_id,role_id,status) VALUES (${workspaceId},${String(admin.user.id)},${adminRoleId},'ACTIVE'),(${workspaceId},${firstId},${memberRoleId},'ACTIVE'),(${workspaceId},${secondId},${memberRoleId},'ACTIVE')`;
    await sql.end();

    await page.goto('/login');
    await page.fill('#email', 'multi-admin@example.com');
    await page.fill('#password', 'password123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(new RegExp(`/workspaces/${workspaceId}/tasks`));
    await page.getByRole('button', { name: 'New Task' }).click();
    const createDialog = page.getByRole('dialog', { name: 'Create Task' });
    await expect(createDialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(createDialog).toBeHidden();
    await page.getByRole('button', { name: 'New Task' }).click();
    await expect(createDialog).toBeVisible();
    await createDialog.locator('#title').fill('Multi Owner Task');
    await createDialog.locator(`#create_assignee_${firstId}`).check();
    await expect(createDialog.getByRole('button', { name: 'Primary', exact: true })).toBeVisible();
    await createDialog.locator(`#create_assignee_${secondId}`).check();
    const betaRow = createDialog.locator('div', { hasText: 'Multi Beta' }).last();
    await betaRow.getByRole('button', { name: 'Make Primary' }).click();
    await createDialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(createDialog).toBeHidden();
    await expect(page.getByText('Multi Owner Task')).toBeVisible();
    const stored = createDatabase(databaseUrl);
    const task = (await stored.sql`SELECT id FROM tasks WHERE workspace_id=${workspaceId} AND title='Multi Owner Task'`)[0];
    const assignees = await stored.sql`SELECT user_id,is_primary FROM task_assignees WHERE task_id=${task.id}`;
    expect(assignees.length).toBe(2);
    expect(assignees.filter((a) => a.is_primary).map((a) => String(a.user_id))).toEqual([secondId]);
    await stored.sql.end();
    await page.getByText('Multi Owner Task').click();
    const detail = page.getByRole('dialog', { name: 'Task details' });
    await expect(detail.getByText('Multi Alpha')).toBeVisible();
    await expect(detail.getByText('Multi Beta')).toBeVisible();
    await expect(detail.getByRole('button', { name: 'Primary', exact: true })).toBeVisible();
    await expect(detail.getByRole('button', { name: 'Make Primary' })).toBeVisible();
  });
  test('phase9 task 10 overdue filter syncs url and drops stale cursor', async ({ page }) => {
    const { sql } = createDatabase(databaseUrl);
    const admin = await auth.api.signUpEmail({ body: { email: 'filter@example.com', password: 'password123', name: 'Filter Admin' } });
    const workspaceId = 'a8ee46bf-5d8f-4ba1-b3fb-0750fb9e7e7c';
    const adminRoleId = String((await sql`SELECT id FROM roles WHERE code='ADMIN'`)[0].id);
    await sql`INSERT INTO workspaces (id,name,slug,timezone,created_by,is_active) VALUES (${workspaceId},'Filter Work','filter-work','UTC',${String(admin.user.id)},true)`;
    await sql`INSERT INTO workspace_memberships (workspace_id,user_id,role_id,status) VALUES (${workspaceId},${String(admin.user.id)},${adminRoleId},'ACTIVE')`;
    await sql.end();

    await page.goto('/login');
    await page.fill('#email', 'filter@example.com');
    await page.fill('#password', 'password123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(new RegExp(`/workspaces/${workspaceId}/tasks`));
    await page.goto(`/workspaces/${workspaceId}/tasks?cursor=stale-cursor-123`);
    await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible();
    await page.getByText('Overdue only').click();
    await expect(page.getByLabel('Overdue only')).toBeChecked();
    await expect(page).toHaveURL(/overdue=true/);
    expect(page.url()).not.toContain('cursor=');
    await page.getByLabel('Priority filter').selectOption('HIGH');
    await expect(page).toHaveURL(/priority=HIGH/);
    await expect(page).toHaveURL(/overdue=true/);
    expect(page.url()).not.toContain('cursor=');
    await page.getByText('Overdue only').click();
    await expect(page.getByLabel('Overdue only')).not.toBeChecked();
    await expect(page).toHaveURL(/priority=HIGH/);
    expect(page.url()).not.toContain('overdue=');
    const hasOverdue = await page.evaluate(() => new URL(window.location.href).searchParams.has('overdue'));
    expect(hasOverdue).toBe(false);
  });

  test('phase10 e2e 1 create -> inbox -> approve -> notification -> deep link', async ({ page }) => {
    const { sql } = createDatabase(databaseUrl);
    const requester = await auth.api.signUpEmail({ body: { email: 'e1-requester@example.com', password: 'password123', name: 'Requester Alice' } });
    const approver = await auth.api.signUpEmail({ body: { email: 'e1-approver@example.com', password: 'password123', name: 'Approver Bob' } });
    const requesterId = String(requester.user.id);
    const approverId = String(approver.user.id);
    const workspaceId = 'a8ee46bf-5d8f-4ba1-b3fb-0750fb9e7e7c';
    const memberRoleId = String((await sql`SELECT id FROM roles WHERE code='MEMBER'`)[0].id);
    await sql`INSERT INTO workspaces (id,name,slug,timezone,created_by,is_active) VALUES (${workspaceId},'E1 Work','e1-work','UTC',${requesterId},true)`;
    await sql`INSERT INTO workspace_memberships (workspace_id,user_id,role_id,status) VALUES (${workspaceId},${requesterId},${memberRoleId},'ACTIVE'),(${workspaceId},${approverId},${memberRoleId},'ACTIVE')`;
    await sql.end();

    const login = async (email: string) => {
      await page.goto('/login');
      await page.fill('#email', email);
      await page.fill('#password', 'password123');
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL(new RegExp(`/workspaces/${workspaceId}/tasks`));
    };

    // 1. Requester logs in and creates approval request
    await login('e1-requester@example.com');
    await page.goto(`/workspaces/${workspaceId}/approvals`);
    await page.getByRole('button', { name: 'New Approval Request' }).click();
    const createDialog = page.getByRole('dialog', { name: 'New Approval Request' });
    await expect(createDialog).toBeVisible();
    await createDialog.locator('#create-title').fill('Q4 Budget Request');
    await createDialog.locator('#create-description').fill('Please approve the Q4 budget allocation.');
    await expect(createDialog.locator('#create-approver option', { hasText: 'Approver Bob' })).toBeAttached();
    await createDialog.locator('#create-approver').selectOption(approverId);
    await createDialog.getByRole('button', { name: 'Submit Request' }).click();
    await expect(createDialog).toBeHidden({ timeout: 10000 });

    // Verify created request appears in Sent view
    await page.getByRole('tab', { name: 'Sent' }).click();
    await expect(page.getByText('Q4 Budget Request')).toBeVisible();

    const dbQuery = createDatabase(databaseUrl);
    const created = (await dbQuery.sql`SELECT id,status FROM approval_requests WHERE workspace_id=${workspaceId} AND title='Q4 Budget Request'`)[0];
    expect(created).toBeDefined();
    const approvalRequestId = String(created.id);
    await dbQuery.sql.end();

    // 2. Approver logs in and opens inbox
    await page.context().clearCookies();
    await login('e1-approver@example.com');
    await page.goto(`/workspaces/${workspaceId}/approvals?view=inbox`);
    await expect(page.getByText('Q4 Budget Request')).toBeVisible();

    // Open selected detail
    await page.getByText('Q4 Budget Request').click();
    const detailDialog = page.getByRole('dialog', { name: 'Approval Detail' });
    await expect(detailDialog).toBeVisible();
    await expect(detailDialog.getByText('PENDING')).toBeVisible();
    await expect(detailDialog.getByText('Requester Alice')).toBeVisible();

    // Approve
    await detailDialog.getByRole('button', { name: 'Approve' }).click();
    const decisionModal = page.getByRole('dialog', { name: 'Confirm Approval' });
    await expect(decisionModal).toBeVisible();
    await decisionModal.locator('#decision-reason').fill('Looks great, approved for Q4.');
    await decisionModal.getByRole('button', { name: 'Confirm Approval' }).click();
    await expect(decisionModal).toBeHidden();
    await expect(detailDialog.getByText('APPROVED', { exact: true })).toBeVisible();
    await expect(detailDialog.getByText('Approver Bob').first()).toBeVisible();

    // 3. Requester receives APPROVAL_APPROVED notification through outbox/worker
    await page.context().clearCookies();
    await login('e1-requester@example.com');
    await page.waitForTimeout(2000);

    const notifButton = page.getByRole('button', { name: /Notifications/i });
    await expect(notifButton).toBeVisible();

    let notificationFound = false;
    for (let i = 0; i < 20; i++) {
      await notifButton.click();
      const notifItem = page.getByRole('button', { name: /Approval Approved/i });
      if (await notifItem.isVisible().catch(() => false)) {
        notificationFound = true;
        await notifItem.click();
        break;
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }
    expect(notificationFound).toBe(true);

    // Assert exact final deep-link URL and selected state
    await expect(page).toHaveURL(`/workspaces/${workspaceId}/approvals?view=sent&selected_approval_request_id=${approvalRequestId}`);
    const selectedDetail = page.getByRole('dialog', { name: 'Approval Detail' });
    await expect(selectedDetail).toBeVisible();
    await expect(selectedDetail.getByText('APPROVED', { exact: true })).toBeVisible();
    await expect(selectedDetail.getByText('Looks great, approved for Q4.')).toBeVisible();
  });

  test('phase10 e2e 2 reject + cancellation lifecycle', async ({ page }) => {
    const { sql } = createDatabase(databaseUrl);
    const requester = await auth.api.signUpEmail({ body: { email: 'e2-requester@example.com', password: 'password123', name: 'Requester Charlie' } });
    const approver = await auth.api.signUpEmail({ body: { email: 'e2-approver@example.com', password: 'password123', name: 'Approver Dave' } });
    const requesterId = String(requester.user.id);
    const approverId = String(approver.user.id);
    const workspaceId = 'a8ee46bf-5d8f-4ba1-b3fb-0750fb9e7e7c';
    const memberRoleId = String((await sql`SELECT id FROM roles WHERE code='MEMBER'`)[0].id);
    await sql`INSERT INTO workspaces (id,name,slug,timezone,created_by,is_active) VALUES (${workspaceId},'E2 Work','e2-work','UTC',${requesterId},true)`;
    await sql`INSERT INTO workspace_memberships (workspace_id,user_id,role_id,status) VALUES (${workspaceId},${requesterId},${memberRoleId},'ACTIVE'),(${workspaceId},${approverId},${memberRoleId},'ACTIVE')`;
    await sql.end();

    const login = async (email: string) => {
      await page.goto('/login');
      await page.fill('#email', email);
      await page.fill('#password', 'password123');
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL(new RegExp(`/workspaces/${workspaceId}/tasks`));
    };

    // 1. Create Request A
    await login('e2-requester@example.com');
    await page.goto(`/workspaces/${workspaceId}/approvals`);
    await page.getByRole('button', { name: 'New Approval Request' }).click();
    const createDialog = page.getByRole('dialog', { name: 'New Approval Request' });
    await createDialog.locator('#create-title').fill('Request A Rejection');
    await expect(createDialog.locator('#create-approver option', { hasText: 'Approver Dave' })).toBeAttached();
    await createDialog.locator('#create-approver').selectOption(approverId);
    await createDialog.getByRole('button', { name: 'Submit Request' }).click();
    await expect(createDialog).toBeHidden({ timeout: 10000 });

    // 2. Approver rejects Request A with required reason
    await page.context().clearCookies();
    await login('e2-approver@example.com');
    await page.goto(`/workspaces/${workspaceId}/approvals?view=inbox`);
    await page.getByText('Request A Rejection').click();
    const detailDialog = page.getByRole('dialog', { name: 'Approval Detail' });
    await expect(detailDialog).toBeVisible();
    await detailDialog.getByRole('button', { name: 'Reject' }).click();
    const rejectModal = page.getByRole('dialog', { name: 'Confirm Rejection' });
    await expect(rejectModal.getByRole('button', { name: 'Confirm Rejection' })).toBeDisabled();
    await rejectModal.locator('#decision-reason').fill('Insufficient justification provided for this request.');
    await expect(rejectModal.getByRole('button', { name: 'Confirm Rejection' })).toBeEnabled();
    await rejectModal.getByRole('button', { name: 'Confirm Rejection' }).click();
    await expect(rejectModal).toBeHidden();
    await expect(detailDialog.getByText('REJECTED')).toBeVisible();

    // 3. Requester sees REJECTED in Sent view with canonical reason
    await page.context().clearCookies();
    await login('e2-requester@example.com');
    await page.goto(`/workspaces/${workspaceId}/approvals?view=sent`);
    await expect(page.getByText('Request A Rejection')).toBeVisible();
    await page.getByText('Request A Rejection').click();
    const reqADetail = page.getByRole('dialog', { name: 'Approval Detail' });
    await expect(reqADetail.getByText('REJECTED', { exact: true })).toBeVisible();
    await expect(reqADetail.getByText('Insufficient justification provided for this request.')).toBeVisible();
    await expect(reqADetail.getByText('Approver Dave').first()).toBeVisible();
    await page.keyboard.press('Escape');

    // 4. Create Request B and Cancel it
    await page.getByRole('button', { name: 'New Approval Request' }).click();
    const createDialogB = page.getByRole('dialog', { name: 'New Approval Request' });
    await createDialogB.locator('#create-title').fill('Request B Cancellation');
    await expect(createDialogB.locator('#create-approver option', { hasText: 'Approver Dave' })).toBeAttached();
    await createDialogB.locator('#create-approver').selectOption(approverId);
    await createDialogB.getByRole('button', { name: 'Submit Request' }).click();
    await expect(createDialogB).toBeHidden({ timeout: 10000 });

    const dbQuery = createDatabase(databaseUrl);
    const createdB = (await dbQuery.sql`SELECT id FROM approval_requests WHERE workspace_id=${workspaceId} AND title='Request B Cancellation'`)[0];
    const requestBId = String(createdB.id);
    await dbQuery.sql.end();

    // Open detail of Request B and cancel
    await page.getByRole('tabpanel', { name: 'Sent' }).getByText('Request B Cancellation').click();
    const detailB = page.getByRole('dialog', { name: 'Approval Detail' });
    await detailB.getByRole('button', { name: 'Cancel Request' }).click();
    const cancelModal = page.getByRole('dialog', { name: 'Confirm Cancellation' });
    await cancelModal.locator('#decision-reason').fill('No longer needed, cancelling.');
    await cancelModal.getByRole('button', { name: 'Confirm Cancellation' }).click();
    await expect(cancelModal).toBeHidden();
    await expect(detailB.getByText('CANCELLED', { exact: true })).toBeVisible();
    await expect(detailB.getByText('No longer needed, cancelling.')).toBeVisible();
    await expect(detailB.getByText('Requester Charlie').first()).toBeVisible();

    // 5. Approver receives APPROVAL_CANCELLED notification and navigates to inbox
    await page.context().clearCookies();
    await login('e2-approver@example.com');
    await page.waitForTimeout(2000);
    const notifButton = page.getByRole('button', { name: /Notifications/i });
    let notifFound = false;
    for (let i = 0; i < 20; i++) {
      await notifButton.click();
      const notifItem = page.getByRole('button', { name: /Approval Cancelled/i });
      if (await notifItem.isVisible().catch(() => false)) {
        notifFound = true;
        await notifItem.click();
        break;
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }
    expect(notifFound).toBe(true);

    // Assert exact canonical deep-link URL: view=inbox & selected_approval_request_id=${requestBId}
    await expect(page).toHaveURL(`/workspaces/${workspaceId}/approvals?view=inbox&selected_approval_request_id=${requestBId}`);
    const selectedB = page.getByRole('dialog', { name: 'Approval Detail' });
    await expect(selectedB).toBeVisible();
    await expect(selectedB.getByText('CANCELLED', { exact: true })).toBeVisible();
    await expect(selectedB.getByText('No longer needed, cancelling.')).toBeVisible();
  });

  test('phase10 e2e 3 manager pending_approvals -> managed drilldown', async ({ page }) => {
    const { sql } = createDatabase(databaseUrl);
    const manager = await auth.api.signUpEmail({ body: { email: 'e3-manager@example.com', password: 'password123', name: 'Manager Morgan' } });
    const approver = await auth.api.signUpEmail({ body: { email: 'e3-approver@example.com', password: 'password123', name: 'Approver Alex' } });
    const requester = await auth.api.signUpEmail({ body: { email: 'e3-requester@example.com', password: 'password123', name: 'Requester Robin' } });
    const managerId = String(manager.user.id);
    const approverId = String(approver.user.id);
    const requesterId = String(requester.user.id);
    const workspaceId = 'a8ee46bf-5d8f-4ba1-b3fb-0750fb9e7e7c';
    await sql`INSERT INTO roles (code,name) VALUES ('MANAGER','Manager') ON CONFLICT (code) DO NOTHING`;
    const managerRoleId = String((await sql`SELECT id FROM roles WHERE code='MANAGER'`)[0].id);
    const memberRoleId = String((await sql`SELECT id FROM roles WHERE code='MEMBER'`)[0].id);
    await sql`INSERT INTO workspaces (id,name,slug,timezone,created_by,is_active) VALUES (${workspaceId},'E3 Work','e3-work','UTC',${managerId},true)`;
    await sql`INSERT INTO workspace_memberships (workspace_id,user_id,role_id,status) VALUES (${workspaceId},${managerId},${managerRoleId},'ACTIVE'),(${workspaceId},${approverId},${memberRoleId},'ACTIVE'),(${workspaceId},${requesterId},${memberRoleId},'ACTIVE')`;

    // One manager manages two teams (Team 1 & Team 2)
    const team1Id = '11111111-1111-4111-8111-111111111111';
    const team2Id = '22222222-2222-4222-8222-222222222222';
    await sql`INSERT INTO teams (id,workspace_id,name,manager_user_id,is_active) VALUES (${team1Id},${workspaceId},'Alpha Team',${managerId},true),(${team2Id},${workspaceId},'Beta Team',${managerId},true)`;
    // One approver is effectively in both teams
    await sql`INSERT INTO team_memberships (team_id,user_id,membership_role) VALUES (${team1Id},${approverId},'MEMBER'),(${team2Id},${approverId},'MEMBER')`;

    // One pending approval is assigned to that approver
    const reqId = '33333333-3333-4333-8333-333333333333';
    const stepId = '44444444-4444-4444-8444-444444444444';
    await sql`INSERT INTO approval_requests (id,workspace_id,requester_id,title,description,status,submitted_at) VALUES (${reqId},${workspaceId},${requesterId},'Deterministic Managed Request','Testing deduplicated manager count','PENDING',now())`;
    await sql`INSERT INTO approval_steps (id,workspace_id,approval_request_id,approver_user_id,step_order,status) VALUES (${stepId},${workspaceId},${reqId},${approverId},1,'PENDING')`;
    await sql.end();

    await page.goto('/login');
    await page.fill('#email', 'e3-manager@example.com');
    await page.fill('#password', 'password123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(new RegExp(`/workspaces/${workspaceId}/tasks`));

    // Open Manager Dashboard
    await page.goto(`/workspaces/${workspaceId}/manager-dashboard`);
    await expect(page.getByRole('heading', { name: 'Manager dashboard' })).toBeVisible();

    // Prove pending_approvals = 1 (deduplicated across the 2 teams)
    const approvalsSection = page.locator('section').filter({ hasText: 'Pending approvals' });
    await expect(approvalsSection).toBeVisible();
    await expect(approvalsSection.getByText('1', { exact: true }).first()).toBeVisible();

    // Click KPI link and verify exact drilldown URL
    await page.getByRole('link', { name: 'View pending approvals' }).click();
    await expect(page).toHaveURL(`/workspaces/${workspaceId}/approvals?view=managed&status=PENDING`);

    // Verify Approval list displays exactly the canonical matching request once
    await expect(page.getByText('Deterministic Managed Request')).toBeVisible();
    const rows = page.locator('div[role="tabpanel"] > div');
    await expect(rows).toHaveCount(1);
  });

  test('phase10 e2e 4 task comment -> mention -> notification -> selected task', async ({ page }) => {
    const { sql } = createDatabase(databaseUrl);
    const author = await auth.api.signUpEmail({ body: { email: 'e4-author@example.com', password: 'password123', name: 'Author Alice' } });
    const mentioned = await auth.api.signUpEmail({ body: { email: 'e4-mentioned@example.com', password: 'password123', name: 'Mentioned Bob' } });
    const authorId = String(author.user.id);
    const mentionedId = String(mentioned.user.id);
    const workspaceId = 'a8ee46bf-5d8f-4ba1-b3fb-0750fb9e7e7c';
    const memberRoleId = String((await sql`SELECT id FROM roles WHERE code='MEMBER'`)[0].id);
    await sql`INSERT INTO workspaces (id,name,slug,timezone,created_by,is_active) VALUES (${workspaceId},'E4 Work','e4-work','UTC',${authorId},true)`;
    await sql`INSERT INTO workspace_memberships (workspace_id,user_id,role_id,status) VALUES (${workspaceId},${authorId},${memberRoleId},'ACTIVE'),(${workspaceId},${mentionedId},${memberRoleId},'ACTIVE')`;
    const workflow = (await sql`SELECT id FROM workflows WHERE workspace_id=${workspaceId} AND code='DEFAULT'`)[0];
    const todoId = String((await sql`SELECT id FROM task_statuses WHERE workflow_id=${workflow.id} AND code='TODO'`)[0].id);
    const taskId = String((await sql`INSERT INTO tasks (workspace_id,task_key,title,workflow_id,status_id,priority,creator_id) VALUES (${workspaceId},'E4-1','Collaboration Task',${workflow.id},${todoId},'HIGH',${authorId}) RETURNING id`)[0].id);
    await sql.end();

    const login = async (email: string) => {
      await page.goto('/login');
      await page.fill('#email', email);
      await page.fill('#password', 'password123');
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL(new RegExp(`/workspaces/${workspaceId}/tasks`));
    };

    // 1. Author opens Task and posts comment with structured mention
    await login('e4-author@example.com');
    await page.goto(`/workspaces/${workspaceId}/tasks?selected_task_id=${taskId}`);
    const detail = page.getByRole('dialog', { name: 'Task details' });
    await expect(detail).toBeVisible();

    // Fill comment composer
    const commentInput = detail.locator(`textarea#comment-composer-${taskId}`);
    await expect(commentInput).toBeVisible();
    await commentInput.fill('Hey, please review the latest updates on this task.');

    // Select structured mention
    await detail.getByRole('button', { name: /Mention.*(Member|team member)/i }).click();
    await expect(detail.getByRole('option', { name: /Mentioned Bob/ })).toBeVisible();
    await detail.getByRole('option', { name: /Mentioned Bob/ }).click();
    // Close mention picker by toggling button again
    await detail.getByRole('button', { name: /Mention.*(Member|team member)/i }).click();

    // Submit comment
    await detail.getByRole('button', { name: 'Post Comment' }).click();
    await expect(detail.getByText('Hey, please review the latest updates on this task.')).toBeVisible();
    await expect(detail.getByText('@Mentioned Bob')).toBeVisible();

    // 2. Mentioned user receives COMMENT_MENTIONED notification
    await page.context().clearCookies();
    await login('e4-mentioned@example.com');
    await page.waitForTimeout(2000);

    const notifButton = page.getByRole('button', { name: /Notifications/i });
    let notifFound = false;
    for (let i = 0; i < 20; i++) {
      await notifButton.click();
      const notifItem = page.getByRole('button', { name: /You were mentioned/i });
      if (await notifItem.isVisible().catch(() => false)) {
        notifFound = true;
        await notifItem.click();
        break;
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }
    expect(notifFound).toBe(true);

    // 3. Assert exact final URL and selected task state
    await expect(page).toHaveURL(`/workspaces/${workspaceId}/tasks?selected_task_id=${taskId}`);
    const selectedTaskDetail = page.getByRole('dialog', { name: 'Task details' });
    await expect(selectedTaskDetail).toBeVisible();
    await expect(selectedTaskDetail.getByText('Collaboration Task')).toBeVisible();
    await expect(selectedTaskDetail.getByText('Hey, please review the latest updates on this task.')).toBeVisible();
    await expect(selectedTaskDetail.getByText('@Mentioned Bob')).toBeVisible();
  });
});

const workflowWorkspaceId = 'aaee46bf-5d8f-4ba1-b3fb-0750fb9e7e7c';
const workflowPath = `/workspaces/${workflowWorkspaceId}/settings/workflows`;
const workflowStatuses = [['TRIAGE', 'TODO'], ['DEV', 'IN_PROGRESS'], ['QA', 'IN_PROGRESS'], ['PROD', 'DONE']] as const;
const workflowEdges = [['TRIAGE', 'DEV'], ['DEV', 'QA'], ['QA', 'PROD']];

async function workflowLogin(page: Page, email = 'workflow-admin@example.com') {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(`/workspaces/${workflowWorkspaceId}/tasks`);
}

async function configureWorkflow(page: Page, code = 'CUSTOM', teamId = ''): Promise<WorkflowDetail> {
  await page.goto(workflowPath);
  await page.getByRole('button', { name: 'New Workflow' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create Workflow' });
  await dialog.locator('#wf_name').fill(code);
  await dialog.locator('#wf_code').fill(code);
  await dialog.locator('#wf_team').selectOption(teamId);
  for (let i = 0; i < 3; i++) await dialog.getByRole('button', { name: 'Remove', exact: true }).first().click();
  for (const [name, category] of workflowStatuses) {
    await dialog.getByPlaceholder('Name', { exact: true }).fill(name);
    await dialog.getByPlaceholder('CODE', { exact: true }).fill(name);
    await dialog.getByPlaceholder('CODE', { exact: true }).locator('..').getByRole('combobox').selectOption(category);
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  }
  await dialog.getByPlaceholder('Name', { exact: true }).locator('../..').locator('div').filter({ has: page.getByText('TRIAGE', { exact: true }) }).filter({ has: page.getByRole('button', { name: 'Set Initial' }) }).last().getByRole('button', { name: 'Set Initial' }).click();
  for (const [from, to] of workflowEdges) await dialog.getByRole('checkbox', { name: `Transition from ${from} to ${to}`, exact: true }).check();
  expect(await dialog.locator('input[type="checkbox"]:checked').count()).toBe(3);
  const created = page.waitForResponse(r => r.url().endsWith(`/workspaces/${workflowWorkspaceId}/workflows`) && r.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  const response = await created;
  expect(response.ok()).toBe(true);
  const workflow: WorkflowDetail = (await response.json()).data;
  await expect(dialog).toBeHidden();
  const defaultResponse = page.waitForResponse(r => r.url().endsWith(`/workflows/${workflow.id}/set-default`) && r.request().method() === 'POST');
  await page.getByRole('region', { name: 'Workflow Details' }).getByRole('button', { name: 'Set Default' }).click();
  expect((await defaultResponse).ok()).toBe(true);
  await expect(page.getByText('Workflow set as default.', { exact: true })).toBeVisible();
  return workflow;
}

async function workflowTask(page: Page, title: string, teamId = '') {
  await page.goto(`/workspaces/${workflowWorkspaceId}/tasks`);
  await page.getByRole('button', { name: 'New Task' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create Task' });
  await dialog.locator('#title').fill(title);
  if (teamId) await dialog.locator('#team_id').selectOption(teamId);
  const posted = page.waitForResponse(r => r.url().endsWith(`/workspaces/${workflowWorkspaceId}/tasks`) && r.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  const response = await posted;
  expect(response.ok()).toBe(true);
  expect(response.request().postDataJSON()).not.toHaveProperty('workflow_id');
  if (teamId) expect(response.request().postDataJSON().team_id).toBe(teamId);
  await expect(dialog).toBeHidden();
  return (await response.json()).data;
}

test.describe('Phase11 Task12 workflow browser acceptance', () => {
  test.beforeEach(async () => {
    await resetDb();
    const { sql } = createDatabase(databaseUrl);
    try {
      for (const [email, role] of [['workflow-admin@example.com', 'ADMIN'], ['workflow-admin2@example.com', 'ADMIN'], ['workflow-member@example.com', 'MEMBER']]) {
        const user = await auth.api.signUpEmail({ body: { email, password: 'password123', name: email } });
        if (email === 'workflow-admin@example.com') await sql`INSERT INTO workspaces (id,name,slug,created_by,is_active) VALUES (${workflowWorkspaceId},'Workflow acceptance','workflow-acceptance',${String(user.user.id)},true)`;
        await sql`INSERT INTO workspace_memberships (workspace_id,user_id,role_id,status) SELECT ${workflowWorkspaceId},${String(user.user.id)},id,'ACTIVE' FROM roles WHERE code=${role}`;
      }
    } finally { await sql.end(); }
  });

  test('A admin configures custom workflow; member creates and traverses all edges', async ({ page }) => {
    await workflowLogin(page);
    const workflow = await configureWorkflow(page);
    const { sql } = createDatabase(databaseUrl);
    try {
      const statuses = await sql`SELECT id,code,category,is_initial,is_terminal FROM task_statuses WHERE workflow_id=${workflow.id} ORDER BY position`;
      expect(statuses.map(s => [s.code, s.category, s.is_initial, s.is_terminal])).toEqual(workflowStatuses.map(([code, category]) => [code, category, code === 'TRIAGE', code === 'PROD']));
      const edges = await sql`SELECT f.code AS source,t.code AS target FROM workflow_transitions e JOIN task_statuses f ON f.id=e.from_status_id JOIN task_statuses t ON t.id=e.to_status_id WHERE e.workflow_id=${workflow.id} ORDER BY f.position`;
      expect(edges.map(e => [e.source, e.target])).toEqual(workflowEdges);
      await page.context().clearCookies();
      await workflowLogin(page, 'workflow-member@example.com');
      const task = await workflowTask(page, 'Custom member task');
      const initial = (await sql`SELECT workflow_id,status_id,version,completed_at,creator_id FROM tasks WHERE id=${task.id}`)[0];
      expect(initial).toMatchObject({ workflow_id: workflow.id, status_id: statuses[0].id, completed_at: null });
      expect((await sql`SELECT r.code FROM workspace_memberships m JOIN roles r ON r.id=m.role_id WHERE m.workspace_id=${workflowWorkspaceId} AND m.user_id=${initial.creator_id}`)[0].code).toBe('MEMBER');
      const initialVersion = Number(initial.version);
      await page.goto(`/workspaces/${workflowWorkspaceId}/kanban?workflow_id=${workflow.id}`);
      await expect(page.getByRole('region', { name: 'TRIAGE', exact: true }).getByText('Custom member task')).toBeVisible();
      for (let i = 1; i < statuses.length; i++) {
        const response = page.waitForResponse(r => r.url().includes(`/tasks/${task.id}/transitions`) && r.request().method() === 'POST');
        const refreshed = page.waitForResponse(r => r.url().includes('/kanban') && r.request().method() === 'GET' && r.headers()['content-type']?.includes('application/json') === true);
        await page.getByLabel('Change status for Custom member task').selectOption(String(statuses[i].id));
        const transitioned = await response;
        expect(transitioned.ok(), await transitioned.text()).toBe(true);
        await refreshed;
        await expect.poll(async () => (await sql`SELECT status_id,version FROM tasks WHERE id=${task.id}`)[0]).toMatchObject({ status_id: statuses[i].id, version: initialVersion + i });
        await expect(page.getByRole('region', { name: String(statuses[i].code), exact: true }).getByText('Custom member task')).toBeVisible();
        await page.reload();
        await expect(page.getByRole('region', { name: String(statuses[i].code), exact: true }).getByText('Custom member task')).toBeVisible();
      }
      expect((await sql`SELECT completed_at FROM tasks WHERE id=${task.id}`)[0].completed_at).not.toBeNull();
    } finally { await sql.end(); }
  });

  test('B team default takes precedence; Beta falls back to workspace default without workflow_id', async ({ page }) => {
    const { sql } = createDatabase(databaseUrl);
    try {
      const teams = await sql`INSERT INTO teams (workspace_id,name,is_active) VALUES (${workflowWorkspaceId},'Alpha',true),(${workflowWorkspaceId},'Beta',true) RETURNING id,name`;
      const alpha = String(teams.find(t => t.name === 'Alpha')!.id), beta = String(teams.find(t => t.name === 'Beta')!.id);
      await workflowLogin(page);
      const workspace = await configureWorkflow(page, 'WORKSPACE');
      const team = await configureWorkflow(page, 'ALPHA', alpha);
      expect(team.id).not.toBe(workspace.id);
      expect((await sql`SELECT id FROM workflows WHERE workspace_id=${workflowWorkspaceId} AND team_id=${beta} AND is_default`).length).toBe(0);
      expect((await sql`SELECT id FROM workflows WHERE workspace_id=${workflowWorkspaceId} AND is_default AND is_active ORDER BY id`).map(w => w.id).sort()).toEqual([workspace.id, team.id].sort());
      for (const [teamId, workflow, title] of [[alpha, team, 'Alpha task'], [beta, workspace, 'Beta task']] as const) {
        const task = await workflowTask(page, title, teamId);
        const initial = workflow.statuses.find(s => s.is_initial)!;
        expect((await sql`SELECT team_id,workflow_id,status_id FROM tasks WHERE id=${task.id}`)[0]).toMatchObject({ team_id: teamId, workflow_id: workflow.id, status_id: initial.id });
        await page.goto(`/workspaces/${workflowWorkspaceId}/kanban?workflow_id=${workflow.id}`);
        await expect(page.getByRole('region', { name: 'TRIAGE', exact: true }).getByText(title)).toBeVisible();
      }
      expect(team.statuses.find(s => s.is_initial)!.id).not.toBe(workspace.statuses.find(s => s.is_initial)!.id);
    } finally { await sql.end(); }
  });

  test('C occupied archived QA is non-droppable and escapes to PROD', async ({ page }) => {
    await workflowLogin(page);
    const workflow = await configureWorkflow(page);
    const { sql } = createDatabase(databaseUrl);
    try {
      const task = await workflowTask(page, 'QA occupant');
      const active = await workflowTask(page, 'Active source');
      await page.goto(`/workspaces/${workflowWorkspaceId}/kanban?workflow_id=${workflow.id}`);
      for (const name of ['DEV', 'QA']) {
        const response = page.waitForResponse(r => r.url().includes(`/tasks/${task.id}/transitions`) && r.request().method() === 'POST');
        await page.getByLabel('Change status for QA occupant').selectOption({ label: name });
        expect((await response).ok()).toBe(true);
        await expect.poll(async () => (await sql`SELECT s.code FROM tasks t JOIN task_statuses s ON s.id=t.status_id WHERE t.id=${task.id}`)[0].code).toBe(name);
        await page.reload();
      }
      await page.goto(workflowPath);
      await page.getByRole('button', { name: /^CUSTOMDefaultWorkspaceActive$/ }).click();
      await page.getByRole('group', { name: 'QA', exact: true }).getByRole('button', { name: 'Archive', exact: true }).click();
      const archivedResponse = page.waitForResponse(r => r.url().endsWith('/archive') && r.request().method() === 'POST');
      await page.getByRole('dialog', { name: 'Confirm Archive Status' }).getByRole('button', { name: 'Archive', exact: true }).click();
      expect((await archivedResponse).ok()).toBe(true);
      await expect(page.getByRole('dialog', { name: 'Confirm Archive Status' })).toBeHidden();
      await page.goto(`/workspaces/${workflowWorkspaceId}/kanban?workflow_id=${workflow.id}`);
      const column = page.getByRole('region', { name: 'Archived: QA (archived, drop unavailable)', exact: true });
      await expect(column).toBeVisible();
      await expect(column.getByText('QA occupant', { exact: true })).toHaveCount(1);
      await expect(page.getByText('QA occupant', { exact: true })).toHaveCount(1);
      await expect(column.getByText('Drop unavailable')).toBeVisible();
      await expect(column).toHaveClass(/border-dashed/);
      await expect(page.getByLabel('Change status for Active source').getByRole('option', { name: /QA/ })).toHaveCount(0);
      const before = await sql`SELECT id,status_id,version FROM tasks WHERE id IN (${task.id},${active.id}) ORDER BY id`;
      const requests: string[] = [];
      page.on('request', r => { if (/\/tasks\/[^/]+\/transitions?/.test(r.url())) requests.push(r.url()); });
      const transfer = await page.evaluateHandle(() => new DataTransfer());
      await page.getByRole('article').filter({ hasText: 'Active source' }).dispatchEvent('dragstart', { dataTransfer: transfer });
      expect(await column.evaluate(el => el.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() })))).toBe(true);
      await column.dispatchEvent('drop', { dataTransfer: transfer });
      await page.getByRole('article').filter({ hasText: 'Active source' }).dispatchEvent('dragend', { dataTransfer: transfer });
      await page.reload();
      await expect(column.getByText('QA occupant')).toBeVisible();
      expect(requests).toEqual([]);
      expect(await sql`SELECT id,status_id,version FROM tasks WHERE id IN (${task.id},${active.id}) ORDER BY id`).toEqual(before);
      const escaped = page.waitForResponse(r => r.url().includes(`/tasks/${task.id}/transitions`) && r.request().method() === 'POST');
      await page.getByLabel('Change status for QA occupant').selectOption({ label: 'PROD' });
      expect((await escaped).ok()).toBe(true);
      await expect.poll(async () => (await sql`SELECT status_id FROM tasks WHERE id=${task.id}`)[0].status_id).toBe(workflow.statuses.find(s => s.code === 'PROD')!.id);
      await page.reload();
      await expect(page.getByRole('region', { name: 'PROD', exact: true }).getByText('QA occupant')).toBeVisible();
      await expect(column).toHaveCount(0);
      await transfer.dispose();
    } finally { await sql.end(); }
  });

  test('D separate admin sessions reject stale transition save once and reload latest aggregate', async ({ page, browser }) => {
    await workflowLogin(page);
    const workflow = await configureWorkflow(page);
    const context = await browser.newContext();
    const second = await context.newPage();
    const { sql } = createDatabase(databaseUrl);
    try {
      await workflowLogin(second, 'workflow-admin2@example.com');
      await second.goto(workflowPath);
      await second.getByRole('button', { name: /^CUSTOMDefaultWorkspaceActive$/ }).click();
      const version = (await sql`SELECT version FROM workflows WHERE id=${workflow.id}`)[0].version;
      for (const session of [page, second]) await expect(session.getByRole('region', { name: 'Workflow Details' }).getByText(`v${version}`, { exact: true })).toBeVisible();
      const matrix = second.getByRole('region', { name: 'Transitions', exact: true });
      await matrix.getByRole('checkbox', { name: 'Transition from TRIAGE to PROD', exact: true }).check();
      const reordered = page.waitForResponse(r => r.url().endsWith(`/workflows/${workflow.id}/statuses/reorder`) && r.request().method() === 'PUT');
      await page.getByRole('button', { name: 'Move QA up', exact: true }).click();
      const reorderResponse = await reordered;
      expect(reorderResponse.ok()).toBe(true);
      const latest: WorkflowDetail = (await reorderResponse.json()).data;
      expect(latest.version).toBe(version + 1);
      expect((await sql`SELECT version FROM workflows WHERE id=${workflow.id}`)[0].version).toBe(version + 1);
      const saves: number[] = [];
      second.on('request', r => { if (r.url().endsWith(`/workflows/${workflow.id}/transitions`) && r.method() === 'PUT') saves.push(r.postDataJSON().version); });
      const conflict = second.waitForResponse(r => r.url().endsWith(`/workflows/${workflow.id}/transitions`) && r.request().method() === 'PUT');
      await matrix.getByRole('button', { name: 'Save', exact: true }).click();
      const failed = await conflict;
      expect(failed.status()).toBe(409);
      expect(await failed.text()).toContain('VERSION_CONFLICT');
      await expect(matrix.getByRole('alert')).toContainText('Configuration changed elsewhere');
      await expect(matrix.getByRole('checkbox', { name: 'Transition from TRIAGE to PROD', exact: true })).toBeChecked();
      const reload = second.waitForResponse(r => r.url().endsWith(`/workflows/${workflow.id}`) && r.request().method() === 'GET');
      await matrix.getByRole('alert').getByRole('button', { name: 'Reload Configuration' }).click();
      expect((await reload).ok()).toBe(true);
      await expect(second.getByRole('region', { name: 'Workflow Details' }).getByText(`v${version + 1}`, { exact: true })).toBeVisible();
      const order = latest.statuses.slice().sort((a, b) => a.position - b.position);
      expect(order.map(s => s.code)).toEqual(['TRIAGE', 'QA', 'DEV', 'PROD']);
      expect(await second.getByRole('region', { name: 'Statuses', exact: true }).locator('[data-status-id]').evaluateAll(elements => elements.map(el => el.getAttribute('data-status-id')))).toEqual(order.map(s => s.id));
      for (const from of latest.statuses) for (const to of latest.statuses) {
        if (from.id !== to.id) await expect(matrix.getByRole('checkbox', { name: `Transition from ${from.name} to ${to.name}`, exact: true })).toBeChecked({ checked: latest.transitions.some(e => e.from_status_id === from.id && e.to_status_id === to.id) });
      }
      await expect(matrix.getByRole('alert')).toHaveCount(0);
      await expect(matrix.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
      expect(saves).toEqual([version]);
      expect((await sql`SELECT version FROM workflows WHERE id=${workflow.id}`)[0].version).toBe(version + 1);
    } finally { await sql.end(); await context.close(); }
  });
});
