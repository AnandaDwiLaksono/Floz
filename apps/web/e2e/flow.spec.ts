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
    await sql`INSERT INTO workspaces (id,name,slug,created_by,is_active) VALUES (${workspaceId},'Test Work','test-work',${String(admin.user.id)},true)`;
    await sql`INSERT INTO workspace_memberships (workspace_id,user_id,role_id,status) VALUES (${workspaceId},${String(admin.user.id)},${adminRoleId},'ACTIVE')`;
    await sql.end();

    await page.goto('/login');
    await page.fill('#email', 'admin2@example.com');
    await page.fill('#password', 'password123');
    await page.click('button[type="submit"]');
    await page.goto(`/workspaces/${workspaceId}/tasks?create=1&prefill_start_at=2026-08-18T09:00&prefill_due_at=2026-08-18T10:00`);
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.locator('input#start_at')).toHaveValue('2026-08-18T09:00');
    await expect(page.locator('input#due_at')).toHaveValue('2026-08-18T10:00');
  });
});
