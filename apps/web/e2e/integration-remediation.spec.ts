import { test, expect } from '@playwright/test';
import { createDatabase, accounts, sessions, users, verifications } from '@floz/database';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { randomUUID } from 'node:crypto';
import { assertQaDatabase } from '../e2e-environment';

const databaseUrl = assertQaDatabase();
const apiUrl = process.env.PLAYWRIGHT_API_URL!;
if (!apiUrl || !/^https?:$/.test(new URL(apiUrl).protocol)) throw new Error('PLAYWRIGHT_API_URL must be an absolute HTTP(S) API URL');
const auth = betterAuth({ secret: process.env.BETTER_AUTH_SECRET!, database: drizzleAdapter(createDatabase(databaseUrl).db as never, { provider: 'pg', schema: { user: users, account: accounts, session: sessions, verification: verifications } }), emailAndPassword: { enabled: true }, advanced: { database: { generateId: 'uuid' } } });

test('authenticated desktop/mobile light/dark, keyboard, storage denial and workspace isolation', async ({ page }, testInfo) => {
  const { sql } = createDatabase(databaseUrl);
  const user = await auth.api.signUpEmail({ body: { email: `final-${randomUUID()}@example.com`, password: 'password123', name: 'Final QA Admin' } });
  const userId = String(user.user.id);
  const workspaceId = randomUUID();
  const otherWorkspaceId = randomUUID();
  try {
    await sql`INSERT INTO roles (code,name) VALUES ('ADMIN','Admin') ON CONFLICT DO NOTHING`;
    const roleId = String((await sql`SELECT id FROM roles WHERE code='ADMIN'`)[0].id);
    await sql`INSERT INTO workspaces (id,name,slug,timezone,created_by) VALUES (${workspaceId},'Final QA Workspace',${workspaceId},'Asia/Jakarta',${userId}),(${otherWorkspaceId},'Inaccessible QA Workspace',${otherWorkspaceId},'UTC',${userId})`;
    await sql`INSERT INTO workspace_memberships (workspace_id,user_id,role_id,status) VALUES (${workspaceId},${userId},${roleId},'ACTIVE')`;
    await sql`INSERT INTO workflows (id,workspace_id,code,name,is_default,is_active,created_by) VALUES (${randomUUID()},${workspaceId},'ARCHIVED_QA','Archived QA workflow',false,false,${userId})`;
    await page.goto('/login');
    await page.getByLabel('Email').fill(user.user.email);
    await page.getByLabel('Kata sandi').fill('password123');
    await page.getByRole('button', { name: 'Masuk', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/workspaces/${workspaceId}/tasks`));
    const allowed = await page.evaluate(async (url) => {
      const response = await fetch(url, { credentials: 'include' });
      return { status: response.status, body: await response.json() };
    }, `${apiUrl}/workspaces/${workspaceId}/tasks`);
    expect(allowed.status).toBe(200);
    expect(allowed.body.data).toEqual(expect.any(Array));
    const denied = await page.evaluate(async (url) => {
      const response = await fetch(url, { credentials: 'include' });
      return { status: response.status, body: await response.json() };
    }, `${apiUrl}/workspaces/${otherWorkspaceId}/tasks`);
    expect(denied.status).toBe(404);
    expect(denied.body.error.code).toBe('NOT_FOUND');

    const routes = ['tasks', 'kanban', 'calendar', 'dashboard', 'manager-dashboard', 'my-work', 'approvals', 'settings/workspace', 'settings/members', 'settings/teams', 'settings/workflows', 'settings/profile'];
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ['light', 'dark']) {
        const themeControl = page.getByRole('radio', { name: theme === 'dark' ? 'Gelap' : 'Terang' });
        await themeControl.click();
        await expect(themeControl).toHaveAttribute('aria-checked', 'true');
        for (const route of routes) {
          const dataPaths: Record<string, string[]> = {
            tasks: ['/tasks'], kanban: ['/kanban'], calendar: ['/calendar/tasks'],
            dashboard: ['/dashboard/member', '/my-work'], 'manager-dashboard': ['/dashboard/manager', '/reports/kpis'],
            'my-work': ['/my-work'], approvals: ['/approval-requests'], 'settings/workspace': [''],
            'settings/members': ['/members', '/invitations'], 'settings/teams': ['/teams'], 'settings/workflows': ['/workflows'],
            'settings/profile': ['/me'],
          };
          const responses = dataPaths[route].map((path) => page.waitForResponse((response) => {
            const target = path === '/me' ? `${apiUrl}/me` : `${apiUrl}/workspaces/${workspaceId}${path}`;
            return new URL(response.url()).pathname === new URL(target).pathname && response.request().method() === 'GET';
          }));
          await page.goto(`/workspaces/${workspaceId}/${route}`);
          for (const response of await Promise.all(responses)) {
            expect(response.ok(), `${route}: ${response.url()}`).toBe(true);
            expect(await response.json()).toHaveProperty('data');
          }
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
          await expect(page.locator('main')).toBeVisible();
          const content: Record<string, () => Promise<void>> = {
            tasks: () => expect(page.getByRole('heading', { name: 'Belum ada tugas', exact: true })).toBeVisible(),
            kanban: () => expect(page.getByLabel('Papan Kanban')).toBeVisible(),
            calendar: () => expect(page.getByText('Belum ada tugas pada rentang ini.', { exact: true })).toBeVisible(),
            dashboard: () => expect(page.getByRole('region', { name: 'Ringkasan pekerjaan' })).toBeVisible(),
            'manager-dashboard': () => expect(page.getByText('Proyeksi langsung dari data tugas saat ini;', { exact: false })).toBeVisible(),
            'my-work': () => expect(page.getByText('Tidak ada tindakan yang diperlukan pada bagian ini.').first()).toBeVisible(),
            approvals: () => expect(page.getByRole('heading', { name: 'Belum ada permohonan persetujuan' })).toBeVisible(),
            'settings/workspace': () => expect(page.getByLabel('Nama workspace')).toHaveValue('Final QA Workspace'),
            'settings/members': () => expect(page.locator('main').getByText(user.user.email, { exact: true }).filter({ visible: true })).toBeVisible(),
            'settings/teams': () => expect(page.getByText('Belum ada tim.', { exact: true })).toBeVisible(),
            'settings/workflows': () => expect(page.getByRole('button', { name: /Archived QA workflow/ })).toBeVisible(),
            'settings/profile': () => expect(page.locator('#profile_email')).toHaveValue(user.user.email),
          };
          await content[route]();
          await expect(page.locator('main [role="alert"]')).toHaveCount(0);
          await expect(page.locator('main .animate-spin')).toHaveCount(0);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
          const colors = await page.locator('main').evaluate((main) => {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 1;
            const context = canvas.getContext('2d')!;
            const luminance = (rgb: number[]) => {
              rgb = rgb.slice(0, 3).map((n) => n / 255).map((n) => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4);
              return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
            };
            const failures: string[] = [];
            const rgba = (color: string) => {
              context.clearRect(0, 0, 1, 1);
              context.fillStyle = color;
              context.fillRect(0, 0, 1, 1);
              const pixel = Array.from(context.getImageData(0, 0, 1, 1).data);
              return [...pixel.slice(0, 3), pixel[3] / 255];
            };
            const over = (front: number[], back: number[]) => {
              const alpha = front[3] + back[3] * (1 - front[3]);
              return [...front.slice(0, 3).map((value, i) => alpha ? (value * front[3] + back[i] * back[3] * (1 - front[3])) / alpha : 0), alpha];
            };
            for (const element of main.querySelectorAll<HTMLElement>('h1,h2,h3,p,button,a,label,dt,dd,span')) {
              if (!element.checkVisibility() || !element.textContent?.trim() || element.querySelector('*') || element.closest(':disabled')) continue;
              const style = getComputedStyle(element);
              const ancestors: Element[] = [];
              for (let parent: Element | null = element; parent; parent = parent.parentElement) ancestors.push(parent);
              const rendered = (pixel: number[]) => {
                for (const parent of ancestors) {
                  const parentStyle = getComputedStyle(parent);
                  pixel = over(pixel, rgba(parentStyle.backgroundColor));
                  pixel[3] *= Number(parentStyle.opacity);
                }
                return luminance(over(pixel, [255, 255, 255, 1]));
              };
              const backdrop = rendered([0, 0, 0, 0]);
              const foreground = rendered(rgba(style.color));
              const ratio = (Math.max(foreground, backdrop) + .05) / (Math.min(foreground, backdrop) + .05);
              const large = parseFloat(style.fontSize) >= 24 || parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700;
              if (ratio + .01 < (large ? 3 : 4.5)) failures.push(`${element.tagName} ${element.textContent?.trim()}: ${ratio.toFixed(2)}`);
            }
            return failures;
          });
          expect(colors, `${route} ${theme} ${width} contrast`).toEqual([]);
          if (route === 'tasks' || route === 'approvals') await page.screenshot({ path: testInfo.outputPath(`${route}-${theme}-${width}.png`), fullPage: true });
        }
      }
    }

    await page.goto(`/workspaces/${workspaceId}/approvals`);
    const create = page.getByRole('button', { name: 'New Approval Request', exact: true });
    await create.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Buat Permintaan Persetujuan Baru' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Close dialog' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(create).toBeFocused();
    const menu = page.getByRole('button', { name: 'Buka navigasi' });
    await menu.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Navigasi' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeFocused();

    await page.addInitScript(() => {
      for (const method of ['getItem', 'setItem']) Object.defineProperty(Storage.prototype, method, { configurable: true, value: () => { throw new DOMException('Denied', 'SecurityError'); } });
    });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByRole('radio', { name: 'Gelap' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('radio', { name: 'Terang' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  } finally { await sql.end(); }
});
