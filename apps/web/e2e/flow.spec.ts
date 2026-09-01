import { test, expect } from '@playwright/test';
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
    await page.getByLabel('Change status for Kanban Task').selectOption({ label: 'In progress' });
    await expect(page.locator('section').filter({ hasText: 'In progress' }).getByText('1', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: /Kanban Task/ }).click();
    await expect(page.getByText('Change Status')).toBeVisible();
    await expect(page.locator('span').filter({ hasText: /In progress/i }).first()).toBeVisible();
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
    await sql`INSERT INTO workflows (id,workspace_id,code,name,is_default,is_active,created_by) VALUES (${workflowId},${workspaceId},'CALENDAR','Calendar workflow',true,true,${String(admin.user.id)})`;
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
    const deadline = page.getByRole('button', { name: /Deadline task/ });
    await expect(deadline).toBeVisible();
    await expect(deadline).toContainText('Deadline only');
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
    await page.getByRole('button', { name: /Scheduled/ }).click();
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
    const start = new Date(); start.setUTCHours(0, 0, 0, 0);
    const tomorrow = new Date(start); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const afterTomorrow = new Date(tomorrow); afterTomorrow.setUTCDate(afterTomorrow.getUTCDate() + 1);
    const yesterday = new Date(start); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
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
    await expect(page.getByRole('table', { name: 'Workload by team' })).toBeVisible();
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
});
