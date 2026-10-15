import { test, expect } from '@playwright/test';

test.describe('Phase 13 E2E Integration Contract', () => {
  test('Phase 13 public routes render expected DOM elements without errors', async ({ page }) => {
    // 1. Check Login and Register Page
    await page.goto('/login');
    await expect(page.getByRole('link', { name: 'Daftar akun' })).toHaveAttribute('href', '/register');
    await expect(page.getByRole('img', { name: 'Floz' })).toBeVisible();

    await page.goto('/register');
    await expect(page.getByRole('heading', { name: 'Daftar Akun Floz' })).toBeVisible();
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.locator('#full_name')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Daftar Akun' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Masuk', exact: true })).toHaveAttribute('href', '/login');
    await expect(page.getByRole('img', { name: 'Floz' })).toBeVisible();

    // 2. Check Verify Email Page
    await page.goto('/verify-email');
    await expect(page.getByRole('heading', { name: 'Verifikasi Email' })).toBeVisible();
    await expect(page.locator('#resend_email')).toBeVisible();

    // 3. Check Join Page
    await page.goto('/join');
    await expect(page.getByRole('heading', { name: 'Gabung Workspace' })).toBeVisible();
    await expect(page.locator('#join_input')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Periksa' })).toBeVisible();
  });
});
