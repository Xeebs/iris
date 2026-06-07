import { test, expect } from '@playwright/test';

test.describe('Workspace Onboarding Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Mock onboarding API endpoints
    await page.route('**/api/v1/onboarding/status', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { started: false, status: null, currentStep: null, completedSteps: [], totalSteps: 7 } }),
      }),
    );
    await page.route('**/api/v1/onboarding/start', (route) =>
      route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ data: { started: true, status: 'in_progress', currentStep: 1, completedSteps: [], totalSteps: 7 } }),
      }),
    );
    await page.route('**/api/v1/onboarding/step', (route) => {
      const req = route.request();
      return req.postDataJSON().then((body: { step: number }) => {
        const step = body.step;
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              started: true,
              status: step === 7 ? 'completed' : 'in_progress',
              currentStep: step,
              completedSteps: Array.from({ length: step }, (_, i) => i),
              totalSteps: 7,
              completedAt: step === 7 ? new Date().toISOString() : null,
            },
          }),
        });
      });
    });
    await page.route('**/api/v1/onboarding/glossary-templates*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            industry: 'finance',
            terms: [
              { term: 'ARR', definition: 'Annual Recurring Revenue' },
              { term: 'MRR', definition: 'Monthly Recurring Revenue' },
            ],
          },
        }),
      }),
    );
    await page.route('**/api/v1/onboarding/skip', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { status: 'skipped' } }) }),
    );
  });

  test('shows welcome message on onboarding page', async ({ page }) => {
    await page.goto('/onboarding');
    await expect(page.getByText('Welcome to Iris')).toBeVisible();
    await expect(page.getByText("Let's get your workspace set up in under 10 minutes.")).toBeVisible();
  });

  test('renders step 1 workspace setup form', async ({ page }) => {
    await page.goto('/onboarding');
    await expect(page.getByText('Set up your workspace')).toBeVisible();
    await expect(page.getByLabel('Workspace name')).toBeVisible();
    await expect(page.getByLabel('Industry')).toBeVisible();
    await expect(page.getByLabel('Company size')).toBeVisible();
  });

  test('can fill in workspace info and advance to step 2', async ({ page }) => {
    await page.goto('/onboarding');
    await page.getByLabel('Workspace name').fill('Acme Corp');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('Choose your data sources')).toBeVisible();
  });

  test('can skip onboarding setup entirely', async ({ page }) => {
    await page.goto('/onboarding');
    await page.getByRole('button', { name: 'Skip setup' }).click();
    // Should navigate away from onboarding
    await page.waitForURL((url) => !url.pathname.includes('/onboarding'));
  });

  test('shows connector selection grid on step 2', async ({ page }) => {
    await page.goto('/onboarding');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('HubSpot')).toBeVisible();
    await expect(page.getByText('Salesforce')).toBeVisible();
    await expect(page.getByText('Notion')).toBeVisible();
  });

  test('can select connectors and advance', async ({ page }) => {
    await page.goto('/onboarding');
    // Advance to step 2
    await page.getByRole('button', { name: 'Continue' }).click();
    // Select HubSpot
    await page.getByText('HubSpot').click();
    await expect(page.getByText('1/3 selected')).toBeVisible();
    // Continue to step 3
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('Connect your sources')).toBeVisible();
  });

  test('shows progress bar advancing with each step', async ({ page }) => {
    await page.goto('/onboarding');
    // Step 1 should be current (active)
    const step1Indicator = page.locator('[aria-current="step"]');
    await expect(step1Indicator).toContainText('1');
    // Advance to step 2
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.locator('[aria-current="step"]')).toContainText('2');
  });

  test('glossary step shows industry templates', async ({ page }) => {
    await page.goto('/onboarding');
    // Skip through to step 5
    for (let i = 0; i < 4; i++) {
      await page.getByRole('button', { name: 'Continue' }).first().click();
    }
    await expect(page.getByText('Glossary kickstart')).toBeVisible();
  });

  test('can navigate back with Back button', async ({ page }) => {
    await page.goto('/onboarding');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('Choose your data sources')).toBeVisible();
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByText('Set up your workspace')).toBeVisible();
  });
});
