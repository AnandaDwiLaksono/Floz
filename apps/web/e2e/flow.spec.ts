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
    await expect(page.getByRole('heading', { name: /In progress/ })).toBeVisible();
    await page.getByRole('button', { name: /Kanban Task/ }).click();
    await expect(page.getByText('Change Status')).toBeVisible();
    await expect(page.locator('span').filter({ hasText: 'In progress' }).first()).toBeVisible();
    await page.goto(`/workspaces/${workspaceId}/kanban`);
    await expect(page.getByLabel('Change status for Kanban Task')).toBeVisible();
    const stale = createDatabase(databaseUrl);
    await stale.sql`UPDATE tasks SET version=version+1 WHERE title='Kanban Task'`;
    await stale.sql.end();
    await page.getByLabel('Change status for Kanban Task').selectOption({ label: 'Done' });
    await expect(page.getByText('VERSION_CONFLICT')).toBeVisible();
    await expect(page.getByText('Kanban Task')).toBeVisible();
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
    await page.goto(`/workspaces/${workspaceId}/tasks?create=1&prefill_start_at=2026-08-18T09:00&prefill_due_at=2026-08-18T10:00&prefill_timezone=Asia%2FJakarta`);
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
});
