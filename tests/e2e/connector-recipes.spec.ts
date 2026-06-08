import { test, expect } from '@playwright/test';

const SHARED_RECIPES = [
  {
    id: 'recipe-shared-1',
    workspaceId: 'system',
    recipeName: 'Sales Operations Setup',
    description: 'CRM + billing integration for revenue operations teams.',
    category: 'sales',
    connectorsConfig: [
      { connectorId: 'hubspot', type: 'hubspot', syncFrequency: 'hourly' },
      { connectorId: 'stripe', type: 'stripe', syncFrequency: 'daily' },
    ],
    glossaryTerms: [
      { term: 'MQL', definition: 'Marketing Qualified Lead' },
      { term: 'ARR', definition: 'Annual Recurring Revenue' },
    ],
    workflows: [],
    authorUserId: 'system',
    shared: true,
    usageCount: 42,
    version: 1,
    avgRating: 4.5,
    reviewCount: 12,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'recipe-shared-2',
    workspaceId: 'system',
    recipeName: 'Finance & Compliance',
    description: 'QuickBooks + Stripe for financial reporting.',
    category: 'finance',
    connectorsConfig: [
      { connectorId: 'quickbooks', type: 'quickbooks', syncFrequency: 'daily' },
    ],
    glossaryTerms: [{ term: 'COGS', definition: 'Cost of Goods Sold' }],
    workflows: [],
    authorUserId: 'system',
    shared: true,
    usageCount: 18,
    version: 1,
    avgRating: 4.0,
    reviewCount: 5,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const CLONED_RECIPE = {
  ...SHARED_RECIPES[0],
  id: 'recipe-cloned-1',
  workspaceId: 'ws-test',
  recipeName: 'Sales Operations Setup (copy)',
  shared: false,
};

test.describe('Connector Recipe Marketplace', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/recipes/shared*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: SHARED_RECIPES }),
      }),
    );
    await page.route('**/api/v1/recipes/predefined*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      }),
    );
  });

  test('shows recipe gallery with shared recipes', async ({ page }) => {
    await page.goto('/recipes');
    await expect(page.getByText('Recipe Marketplace')).toBeVisible();
    await expect(page.getByText('Sales Operations Setup')).toBeVisible();
    await expect(page.getByText('Finance & Compliance')).toBeVisible();
  });

  test('displays recipe stats bar', async ({ page }) => {
    await page.goto('/recipes');
    await expect(page.getByText('Total Recipes')).toBeVisible();
    await expect(page.getByText('Installed')).toBeVisible();
    await expect(page.getByText('Categories')).toBeVisible();
  });

  test('filters recipes by category', async ({ page }) => {
    await page.goto('/recipes');
    await page.getByRole('button', { name: 'Finance' }).click();
    await expect(page.getByText('Finance & Compliance')).toBeVisible();
    await expect(page.getByText('Sales Operations Setup')).not.toBeVisible();
  });

  test('searches recipes by name', async ({ page }) => {
    await page.goto('/recipes');
    await page.getByPlaceholder('Search recipes…').fill('sales');
    await expect(page.getByText('Sales Operations Setup')).toBeVisible();
    await expect(page.getByText('Finance & Compliance')).not.toBeVisible();
  });

  test('searches recipes by connector name', async ({ page }) => {
    await page.goto('/recipes');
    await page.getByPlaceholder('Search recipes…').fill('quickbooks');
    await expect(page.getByText('Finance & Compliance')).toBeVisible();
    await expect(page.getByText('Sales Operations Setup')).not.toBeVisible();
  });

  test('shows empty state when no recipes match', async ({ page }) => {
    await page.goto('/recipes');
    await page.getByPlaceholder('Search recipes…').fill('nonexistent-xyz');
    await expect(page.getByText('No recipes found')).toBeVisible();
  });

  test('shows recipe connector tags', async ({ page }) => {
    await page.goto('/recipes');
    await expect(page.getByText('hubspot').first()).toBeVisible();
    await expect(page.getByText('stripe')).toBeVisible();
  });
});

test.describe('Recipe Installation Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/recipes/shared*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: SHARED_RECIPES }),
      }),
    );
    await page.route('**/api/v1/recipes/predefined*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) }),
    );
    await page.route('**/api/v1/recipes/recipe-shared-1/clone', (route) =>
      route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ data: CLONED_RECIPE }),
      }),
    );
    await page.route('**/api/v1/recipes/recipe-shared-1/apply-to-workspace', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { applied: true } }),
      }),
    );
  });

  test('opens install modal when Install button clicked', async ({ page }) => {
    await page.goto('/recipes');
    await page.getByRole('button', { name: 'Install' }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('Install "Sales Operations Setup"')).toBeVisible();
  });

  test('shows connector list in install modal', async ({ page }) => {
    await page.goto('/recipes');
    await page.getByRole('button', { name: 'Install' }).first().click();
    await expect(page.getByText('Included connectors')).toBeVisible();
    await expect(page.getByText('hubspot')).toBeVisible();
  });

  test('shows glossary terms in install modal', async ({ page }) => {
    await page.goto('/recipes');
    await page.getByRole('button', { name: 'Install' }).first().click();
    await expect(page.getByText('MQL')).toBeVisible();
  });

  test('completes installation flow', async ({ page }) => {
    await page.goto('/recipes');
    await page.getByRole('button', { name: 'Install' }).first().click();
    await page.getByRole('button', { name: 'Install Recipe' }).click();
    await expect(page.getByText('Recipe installed!')).toBeVisible();
  });

  test('shows success notification after install', async ({ page }) => {
    await page.goto('/recipes');
    await page.getByRole('button', { name: 'Install' }).first().click();
    await page.getByRole('button', { name: 'Install Recipe' }).click();
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByText('"Sales Operations Setup" installed successfully!')).toBeVisible();
  });

  test('cancels install via Cancel button', async ({ page }) => {
    await page.goto('/recipes');
    await page.getByRole('button', { name: 'Install' }).first().click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('closes modal by clicking backdrop', async ({ page }) => {
    await page.goto('/recipes');
    await page.getByRole('button', { name: 'Install' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.mouse.click(10, 10);
    await expect(dialog).not.toBeVisible();
  });
});

test.describe('Recipe Creation', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/recipes/shared*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) }),
    );
    await page.route('**/api/v1/recipes/predefined*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) }),
    );
    await page.route('**/api/v1/recipes/templates', (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ data: { id: 'new-recipe-1', recipeName: 'My Recipe' } }),
        });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
    });
  });

  test('navigates to create form', async ({ page }) => {
    await page.goto('/recipes');
    await page.getByRole('button', { name: '+ Create Recipe' }).click();
    await expect(page.getByText('Create New Recipe')).toBeVisible();
  });

  test('shows back to gallery button in create mode', async ({ page }) => {
    await page.goto('/recipes');
    await page.getByRole('button', { name: '+ Create Recipe' }).click();
    await expect(page.getByRole('button', { name: 'Back to Gallery' })).toBeVisible();
  });

  test('create form has required fields', async ({ page }) => {
    await page.goto('/recipes');
    await page.getByRole('button', { name: '+ Create Recipe' }).click();
    await expect(page.getByPlaceholder('e.g. Sales Operations Setup')).toBeVisible();
    await expect(page.getByPlaceholder('What does this recipe do?')).toBeVisible();
  });

  test('cancels recipe creation', async ({ page }) => {
    await page.goto('/recipes');
    await page.getByRole('button', { name: '+ Create Recipe' }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Recipe Marketplace')).toBeVisible();
    await expect(page.getByText('Create New Recipe')).not.toBeVisible();
  });
});
