/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect } from '@playwright/test';
import { test } from '../audio-editor-test-fixtures.js';
import { handbookPlan } from '../../../scripts/lib/product-web-routing.mjs';

const BASE = handbookPlan('soundscaper').scope;

test('readers can choose an editor or Web and compare it with Desktop using the full matrix', async ({ page }) => {
	await page.goto(`${BASE}start/how-soundscaper-compares/`);
	await page.getByRole('link', { name: 'compare Soundscaper Desktop with one editor', exact: true }).click();
	await expect(page.getByRole('heading', { level: 1, name: 'Soundscaper comparisons', exact: true })).toBeVisible();
	const comparisonIndex = page.getByRole('main');
	await expect(comparisonIndex.getByRole('link', { name: /^Soundscaper vs /u })).toHaveCount(13);
	for (const product of ['Ableton Live 13 Suite (beta 26)', 'Pro Tools Studio 2026.11.1', 'SoundCraft 0.20.1']) {
		await expect(comparisonIndex.getByRole('link', { name: `Soundscaper vs ${product}`, exact: true })).toBeVisible();
	}
	await comparisonIndex.getByRole('link', { name: 'Soundscaper vs Audition 27.0', exact: true }).click();
	await expect(page.getByRole('heading', { level: 1, name: 'Soundscaper vs Audition 27.0', exact: true })).toBeVisible();
	const platform = page.getByRole('region', { name: 'Platform and terms', exact: true });
	const linux = platform.getByRole('row', { name: /^Runs on Linux /u });
	await expect(linux.getByRole('cell')).toHaveCount(2);
	await expect(linux.getByRole('cell').nth(0).getByRole('img', { name: 'Supported', exact: true })).toBeVisible();
	await expect(linux.getByRole('cell').nth(1).getByRole('img', { name: 'Unavailable', exact: true })).toBeVisible();
	await expect(page.getByRole('heading', { level: 2, name: 'Machine assistance', exact: true })).toBeVisible();
	await expect(page.getByRole('figure', { name: 'Soundscaper Desktop', exact: true })).toBeAttached();
	await expect(page.getByRole('figure', { name: 'Audition 27.0', exact: true })).toBeAttached();

	await page.getByRole('link', { name: 'Choose another comparison', exact: true }).click();
	await page.getByRole('main').getByRole('link', { name: 'Soundscaper vs REAPER 7.86', exact: true }).click();
	await expect(page.getByRole('heading', { level: 1, name: 'Soundscaper vs REAPER 7.86', exact: true })).toBeVisible();
	const subprojects = page.getByRole('region', { name: 'Project and session model', exact: true })
		.getByRole('row', { name: /^Nested subprojects with automatic proxy updates /u });
	await expect(subprojects.getByRole('cell')).toHaveCount(2);
	await expect(subprojects.getByRole('cell').nth(0).getByRole('img', { name: 'Supported', exact: true })).toBeVisible();
	await expect(subprojects.getByRole('cell').nth(1).getByRole('img', { name: 'Supported', exact: true })).toBeVisible();
	const reaperProject = page.getByRole('region', { name: 'Project format support', exact: true })
		.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'REAPER (.rpp)', exact: true }) });
	await expect(reaperProject.getByRole('cell').nth(0).getByRole('img', { name: 'Limited', exact: true })).toBeVisible();
	await expect(reaperProject.getByRole('cell').nth(1).getByRole('img', { name: 'Supported', exact: true })).toBeVisible();
	await expect(page.getByRole('figure', { name: 'REAPER 7.86', exact: true })).toBeAttached();

	for (const [product, project] of [['Apple Logic Pro 13.0 for Mac', 'Logic Pro (.logicx)'], ['Cubase Pro 16.0.5', 'Cubase (.cpr)']]) {
		await page.getByRole('link', { name: 'Choose another comparison', exact: true }).click();
		await page.getByRole('main').getByRole('link', { name: `Soundscaper vs ${product}`, exact: true }).click();
		await expect(page.getByRole('heading', { level: 1, name: `Soundscaper vs ${product}`, exact: true })).toBeVisible();
		const nativeProject = page.getByRole('region', { name: 'Project format support', exact: true })
			.getByRole('row').filter({ has: page.getByRole('rowheader', { name: project, exact: true }) });
		await expect(nativeProject.getByRole('cell').nth(0).getByRole('img', { name: 'Unavailable', exact: true })).toBeVisible();
		await expect(nativeProject.getByRole('cell').nth(1).getByRole('img', { name: 'Supported', exact: true })).toBeVisible();
		await expect(page.getByRole('figure', { name: product, exact: true })).toBeAttached();
	}

	await page.getByRole('link', { name: 'Choose another comparison', exact: true }).click();
	await page.getByRole('main').getByRole('link', { name: 'Soundscaper vs Soundscaper Web', exact: true }).click();
	await expect(page.getByRole('heading', { level: 1, name: 'Soundscaper vs Soundscaper Web', exact: true })).toBeVisible();
	const bsd = page.getByRole('region', { name: 'Platform and terms', exact: true }).getByRole('row', { name: /^Runs on BSD /u });
	await expect(bsd.getByRole('cell').nth(0).getByRole('img', { name: 'Unavailable', exact: true })).toBeVisible();
	await expect(bsd.getByRole('cell').nth(1).getByRole('img', { name: 'Supported', exact: true })).toBeVisible();
	const slicing = page.getByRole('region', { name: 'Timeline editing', exact: true })
		.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Beat slicing and gap smoothing', exact: true }) });
	const desktopSlicing = slicing.getByRole('cell').nth(0);
	await expect(desktopSlicing.getByRole('img', { name: 'Limited', exact: true })).toBeVisible();
	await expect(desktopSlicing.getByRole('button', { name: /Split at beat labels/u }))
		.toHaveAccessibleDescription(/Beat Finder or the optional Beat This model.*gap smoothing are planned\./u);
	const webSlicing = slicing.getByRole('cell').nth(1);
	await expect(webSlicing.getByRole('img', { name: 'Limited', exact: true })).toBeVisible();
	await expect(webSlicing.getByRole('button', { name: /Split at beat labels/u }))
		.toHaveAccessibleDescription(/Beat Finder.*Split labeled audio.*gap smoothing are planned\./u);
	await page.getByRole('main').getByRole('link', { name: 'How Soundscaper compares', exact: true }).click();
	await expect(page.getByRole('heading', { level: 1, name: 'How Soundscaper compares', exact: true })).toBeVisible();
});
