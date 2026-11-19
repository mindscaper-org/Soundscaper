/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect } from '@playwright/test';
import { test } from '../audio-editor-test-fixtures.js';
import { handbookPlan } from '../../../scripts/lib/product-web-routing.mjs';

const BASE = handbookPlan('soundscaper').scope;

for (const [slug, title] of [
	['save-session-snapshots', 'Save and restore a session snapshot'],
	['process-one-clip', 'Apply realtime effects to one clip'],
	['turn-audio-into-midi', 'Turn recorded notes into editable MIDI'],
]) {
	test(`readers reach ${slug} from the Soundscaper overview`, async ({ page }) => {
		await page.goto(`${BASE}soundscaper/`);
		await page.getByRole('main').getByRole('link', { name: title, exact: true }).click();
		await expect(page).toHaveURL(new RegExp(`${BASE}soundscaper/${slug}/$`, 'u'));
		await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
		for (const name of ['Before you start', 'Steps', 'Check the result', 'Limits and recovery']) {
			await expect(page.getByRole('heading', { level: 2, name, exact: true })).toBeVisible();
		}
		await expect(page.getByRole('main').locator('ol')).toHaveCount(1);
	});
}

for (const locale of ['de', 'ja', 'ar']) {
	test(`${locale} feature navigation and related links retain the reader's language`, async ({ page }) => {
		await page.goto(`${BASE}${locale}/soundscaper/`);
		const guide = page.getByRole('main').locator(`a[href="${BASE}${locale}/soundscaper/reduce-microphone-bleed/"]`);
		await expect(guide).toBeVisible();
		const title = await guide.textContent();
		expect(title?.trim()).toBeTruthy();
		await guide.click();
		await expect(page.getByRole('heading', { level: 1, name: title.trim(), exact: true })).toBeVisible();
		await expect(page.locator('html')).toHaveAttribute('lang', locale);
		await expect(page.getByRole('main').getByRole('heading', { level: 2 })).toHaveCount(4);
		// The related-guide link is authored without a locale or deployment base.
		await page.goto(`${BASE}${locale}/soundscaper/edit-a-transcript/`);
		const snapshot = page.getByRole('main').locator(`a[href="${BASE}${locale}/soundscaper/save-session-snapshots/"]`);
		await expect(snapshot).toBeVisible();
		await snapshot.click();
		await expect(page).toHaveURL(new RegExp(`${BASE}${locale}/soundscaper/save-session-snapshots/$`, 'u'));
	});
}
