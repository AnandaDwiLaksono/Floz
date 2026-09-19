import { test, expect } from '@playwright/test';

test.describe('Phase 13 E2E Integration Contract', () => {
  test('Phase 13 public routes render expected DOM elements without errors', async ({ page }) => {
    // 1. Check Register Page
    await page.goto('/register');
    await expect(page.getByRole('heading', { name: 'Create your Floz Account' })).toBeVisible();
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.locator('#full_name')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create Account' })).toBeVisible();

    // 2. Check Verify Email Page
    await page.goto('/verify-email');
    await expect(page.getByRole('heading', { name: 'Email Verification' })).toBeVisible();
    await expect(page.locator('#resend_email')).toBeVisible();

    // 3. Check Join Page
    await page.goto('/join');
    await expect(page.getByRole('heading', { name: 'Join a Workspace' })).toBeVisible();
    await expect(page.locator('#join_input')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Check' })).toBeVisible();
  });
});
