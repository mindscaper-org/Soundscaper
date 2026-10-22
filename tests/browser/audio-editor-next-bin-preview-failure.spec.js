/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles } from './audio-editor-test-helpers.js';

test.use({ serviceWorkers: 'block' });

test('a failed playback module restores the Project Bin Play control', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'Healthy.wav', frequency: 440, duration: 2, channelCount: 1 })]);
	await editor.locator('[data-clip-id]').first().locator('.clip-header').click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Move to Project bin', exact: true }).click();
	let failures = 0;
	const blockedModule = '**/assets/chunk-stream-worklet-*.js';
	await page.route(blockedModule, async route => { failures++; await route.abort('failed'); });
	const card = editor.locator('[data-project-bin-item]').first();
	await card.getByRole('button', { name: /^Play:/u }).click();
	await expect.poll(() => failures).toBeGreaterThan(0);
	await expect(editor.getByRole('alert')).toBeVisible();
	await expect(card.getByRole('button', { name: /^Play:/u })).toBeVisible();
});
