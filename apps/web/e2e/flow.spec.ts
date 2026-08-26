import { test, expect } from '@playwright/test';
import { createDatabase } from '@floz/database';
import { sql } from 'drizzle-orm';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { accounts, sessions, users, verifications } from '@floz/database';

const databaseUrl = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5433/floz';

const auth = betterAuth({
  database: drizzleAdapter(createDatabase(databaseUrl).db, {
    provider: 'pg',
    schema: { user: users, account: accounts, session: sessions, verification: verifications }
  }),
  emailAndPassword: { enabled: true },
  advanced: {
    database: { generateId: 'uuid' }
  }
});

async function resetDb() {
  const { db, sql: client } = createDatabase(databaseUrl);
  await db.execute(sql`TRUNCATE team_memberships, teams, workspace_memberships, workspaces, roles, sessions, accounts, users, verifications RESTART IDENTITY CASCADE`);
  // Seed basic roles
  await db.execute(sql`INSERT INTO roles (code, name) VALUES ('ADMIN', 'Admin'), ('MEMBER', 'Member') ON CONFLICT DO NOTHING`);
  await client.end();
}

test.describe('Floz E2E Web Verification Flow', () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  test('happy path: signup -> login -> protected routes -> workspace selection -> create task -> detail -> edit -> assign -> transition -> soft delete', async ({ page }) => {
    page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
    page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));

    // 1. Unauthenticated protected route redirects to login
    await page.goto('/workspaces/some-id/tasks');
    await expect(page).toHaveURL(/\/login/);

    // Seed a real user and workspace for test login
    const { db, sql: client } = createDatabase(databaseUrl);
    
    // Sign up via Better Auth API directly
    const admin = await auth.api.signUpEmail({ body: { email: 'admin@example.com', password: 'password123', name: 'Admin User' } });
    const member = await auth.api.signUpEmail({ body: { email: 'member@example.com', password: 'password123', name: 'Member User' } });
    
    const adminId = String(admin.user.id);
    const memberId = String(member.user.id);

    // Fetch seeded roles
    const adminRoleId = (await db.execute(sql`SELECT id FROM roles WHERE code = 'ADMIN'`))[0].id;
    const memberRoleId = (await db.execute(sql`SELECT id FROM roles WHERE code = 'MEMBER'`))[0].id;

    // Create workspace
    const workspaceId = 'a8ee46bf-5d8f-4ba1-b3fb-0750fb9e7e7c';
    await db.execute(sql`
      INSERT INTO workspaces (id, name, slug, created_by, is_active)
      VALUES (${workspaceId}, 'Test Work', 'test-work', ${adminId}, true)
    `);

    // Workspace membership
    await db.execute(sql`
      INSERT INTO workspace_memberships (workspace_id, user_id, role_id, status)
      VALUES (${workspaceId}, ${adminId}, ${adminRoleId}, 'ACTIVE'),
             (${workspaceId}, ${memberId}, ${memberRoleId}, 'ACTIVE')
    `);

    // Get auto-created workflow and initial status
    const wfRow = (await db.execute(sql`SELECT id FROM workflows WHERE workspace_id = ${workspaceId} LIMIT 1`))[0];
    const workflowId = String(wfRow.id);
    const initialStatusId = (await db.execute(sql`SELECT id FROM task_statuses WHERE workflow_id = ${workflowId} AND is_initial LIMIT 1`))[0].id;
    const todoStatusId = (await db.execute(sql`SELECT id FROM task_statuses WHERE workflow_id = ${workflowId} AND code = 'TODO' LIMIT 1`))[0].id;

    await client.end();

    // 2. Invalid credentials login
    await page.goto('/login');
    console.log('CURRENT URL:', page.url());
    console.log('BODY CONTENT:', await page.locator('body').innerHTML());
    await page.fill('#email', 'admin@example.com');
    await page.fill('#password', 'wrongpassword');
    await page.click('button[type="submit"]');
    await expect(page.locator('text=Invalid email or password.')).toBeVisible();

    // 3. Successful login establishes cookie and redirects to workspace tasks page
    await page.fill('#password', 'password123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(new RegExp(`/workspaces/${workspaceId}/tasks`));

    // 4. Authenticated application shell matches workspace and user profile
    await expect(page.locator('header h1')).toContainText('Test Work');
    await expect(page.locator('aside')).toContainText('Admin User');

    // 5. Create task from UI
    await page.click('button:has-text("New Task")');
    await page.fill('input#title', 'New E2E Task');
    await page.fill('textarea#description', 'E2E description');
    // Select priority
    await page.selectOption('select#priority', 'HIGH');
    // Select status
    await page.selectOption('select#initial_status', initialStatusId);
    await page.click('button:has-text("Create")');

    // 6. Task appears in list
    const listItem = page.locator('li:has-text("New E2E Task")');
    await expect(listItem).toBeVisible();
    await expect(listItem).toContainText('HIGH');

    // 7. Open Detail
    await listItem.click();
    await expect(page.locator('h3:has-text("New E2E Task")')).toBeVisible();

    // 8. Edit fields
    await page.click('button:has-text("Edit Fields")');
    await page.fill('form input', 'New E2E Task - Updated');
    await page.click('button:has-text("Save Changes")');
    await expect(page.locator('h3:has-text("New E2E Task - Updated")')).toBeVisible();

    // 9. Assign user
    // Toggle member check in assignment list
    await page.click('input[type="checkbox"] >> nth=1'); // Member User check
    await page.click('button:has-text("Save Assignment Changes")');
    await expect(page.locator('h3:has-text("New E2E Task - Updated")')).toBeVisible();

    // 10. Transition status
    await page.click('button:has-text("To In progress")');
    await expect(page.locator('span:has-text("In progress")')).toBeVisible();

    // 11. Concurrency (409 conflict handling)
    // Modify version in backend directly to trigger a version conflict on next patch
    const { db: dbCon, sql: clientCon } = createDatabase(databaseUrl);
    await dbCon.execute(sql`UPDATE tasks SET version = 100 WHERE workspace_id = ${workspaceId}`);
    await clientCon.end();

    await page.click('button:has-text("Edit Fields")');
    await page.fill('form input', 'New E2E Task - Conflicted');
    await page.click('button:has-text("Save Changes")');
    
    // Visible conflict state
    await expect(page.locator('text=Version Conflict')).toBeVisible();
    
    // Choose Reload State
    await page.click('button:has-text("Reload State")');
    await expect(page.locator('text=Version Conflict')).not.toBeVisible();
    await expect(page.locator('h3:has-text("New E2E Task - Updated")')).toBeVisible(); // State matches db (version updated, edit skipped)

    // 12. Soft Delete
    await page.click('button:has-text("Close")');
    await listItem.click();
    
    // Confirm dialogue
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('Are you sure');
      await dialog.accept();
    });
    await page.click('button:has(svg.lucide-trash-2)'); // Delete icon in detail modal

    // Task disappears from list
    await expect(listItem).not.toBeVisible();
  });
});
