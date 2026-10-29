import { expect, type Page, test } from '@playwright/test';

const AUTHOR = { email: 'priya.sharma@email.com', password: 'BookLeaf@Author1' };
const ADMIN = { email: 'isha.verma@bookleaf.test', password: 'BookLeaf@Admin1' };

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password', { exact: true }).fill(who.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

test('an author asks, the team replies, and the reply appears without a refresh', async ({ browser }) => {
  const subject = `Royalty statement for my tax return ${Date.now()}`;

  // Author files a query about a specific book.
  const authorPage = await (await browser.newContext()).newPage();
  await signIn(authorPage, AUTHOR);
  await expect(authorPage.getByRole('heading', { name: /Priya\./ })).toBeVisible();
  await authorPage.goto('/support/new');
  await authorPage.getByRole('combobox', { name: 'Book' }).click();
  await authorPage.getByRole('option', { name: /Whispers of the Ganges/ }).click();
  await authorPage.getByLabel('Subject').fill(subject);
  await authorPage
    .getByLabel('Describe the issue')
    .fill(
      'Could you send me a statement of the royalties paid for Whispers of the Ganges this financial year?',
    );
  await authorPage.getByRole('button', { name: 'Send to BookLeaf' }).click();
  await expect(authorPage.getByRole('heading', { name: subject })).toBeVisible();
  await expect(authorPage.getByText("We've got your query")).toBeVisible();

  // A specialist finds it in the queue and replies.
  const adminPage = await (await browser.newContext()).newPage();
  await signIn(adminPage, ADMIN);
  await expect(adminPage.getByRole('heading', { name: 'The Desk' })).toBeVisible();
  await adminPage.getByLabel('Search tickets').fill('tax return');
  await Promise.all([
    adminPage.waitForURL(/\/desk\/tickets\/BL-\d+$/, { timeout: 45_000 }),
    adminPage.getByRole('link', { name: new RegExp(subject) }).click(),
  ]);
  await expect(adminPage.getByText("Leaf's read")).toBeVisible();
  await adminPage
    .getByLabel(/Reply to Priya/)
    .fill('Hi Priya, I have emailed you a statement of every payout for Whispers of the Ganges this year.');
  await adminPage.getByRole('button', { name: 'Send reply' }).click();
  await expect(adminPage.getByText('Reply sent')).toBeVisible();

  // The author's open page updates by itself (Server-Sent Events).
  await expect(authorPage.getByText('I have emailed you a statement of every payout')).toBeVisible({
    timeout: 25_000,
  });
  await expect(authorPage.getByText('Being handled')).toBeVisible();
});

test('authors cannot open the support desk', async ({ page }) => {
  await signIn(page, AUTHOR);
  await page.goto('/desk');
  await expect(page).toHaveURL(/\/home$/);
});

test('a wrong password is explained, not swallowed', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(AUTHOR.email);
  await page.getByLabel('Password', { exact: true }).fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText("That email and password don't match a BookLeaf account.")).toBeVisible();
});

test('demo personas sign in with one click', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: /Aarav Mehta/ }).click();
  await expect(page).toHaveURL(/\/desk$/);
  await expect(page.getByRole('heading', { name: 'The Desk' })).toBeVisible();
});
