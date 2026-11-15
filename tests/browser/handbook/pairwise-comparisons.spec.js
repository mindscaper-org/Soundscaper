/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect } from '@playwright/test';
import { test } from '../audio-editor-test-fixtures.js';
import { handbookPlan } from '../../../scripts/lib/product-web-routing.mjs';

const BASE = handbookPlan('soundscaper').scope;

test('readers can choose an editor or Web and compare it with Desktop using the full matrix', async ({ page }) => {
	await page.goto(`${BASE}start/how-soundscaper-compares/`);
	await page.getByRole('link', { name: 'compare Soundscaper Desktop with one editor', exact: true }).click();
	await expect(page.getByRole('heading', { level: 1, name: 'Soundscaper comparisons', exact: true })).toBeVisible();
	await expect(page.getByRole('main').getByRole('link', { name: /^Soundscaper vs /u })).toHaveCount(10);
	await page.getByRole('main').getByRole('link', { name: 'Soundscaper vs Audition', exact: true }).click();
	await expect(page.getByRole('heading', { level: 1, name: 'Soundscaper vs Audition', exact: true })).toBeVisible();
	const platform = page.getByRole('region', { name: 'Platform and terms', exact: true });
	const linux = platform.getByRole('row', { name: /^Runs on Linux /u });
	await expect(linux.getByRole('cell')).toHaveCount(2);
	await expect(linux.getByRole('cell').nth(0).getByRole('img', { name: 'Supported', exact: true })).toBeVisible();
	await expect(linux.getByRole('cell').nth(1).getByRole('img', { name: 'Unavailable', exact: true })).toBeVisible();
	await expect(page.getByRole('heading', { level: 2, name: 'Machine assistance', exact: true })).toBeVisible();
	await expect(page.getByRole('figure', { name: 'Soundscaper Desktop', exact: true })).toBeAttached();
	await expect(page.getByRole('figure', { name: 'Audition', exact: true })).toBeAttached();

	await page.getByRole('link', { name: 'Choose another comparison', exact: true }).click();
	await page.getByRole('main').getByRole('link', { name: 'Soundscaper vs Soundscaper Web', exact: true }).click();
	await expect(page.getByRole('heading', { level: 1, name: 'Soundscaper vs Soundscaper Web', exact: true })).toBeVisible();
	const bsd = page.getByRole('region', { name: 'Platform and terms', exact: true }).getByRole('row', { name: /^Runs on BSD /u });
	await expect(bsd.getByRole('cell').nth(0).getByRole('img', { name: 'Unavailable', exact: true })).toBeVisible();
	await expect(bsd.getByRole('cell').nth(1).getByRole('img', { name: 'Supported', exact: true })).toBeVisible();
	await page.getByRole('main').getByRole('link', { name: 'How Soundscaper compares', exact: true }).click();
	await expect(page.getByRole('heading', { level: 1, name: 'How Soundscaper compares', exact: true })).toBeVisible();
});
