/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, closeClipProperties, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { readClipGain, setClipGain } from './audio-editor-clip-settings-test-helpers.js';

for (const [channelCount, duration] of [[16, 1], [1, .1]]) test(`Peak normalization accepts ${channelCount} channels lasting ${duration} seconds`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'peak-normalize.wav', duration, frequency: 523, channelCount })]);
	const clip = editor.locator('[data-clip-id]').first();
	let properties = await openClipProperties(page, editor, clip, { additional: false });
	await setClipGain(properties, -20); await closeClipProperties(properties);
	await clip.click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Normalize to −1 dBFS', exact: true }).click();
	properties = await openClipProperties(page, editor, clip, { additional: false });
	await expect.poll(() => readClipGain(properties), { timeout: 15_000 }).toBeGreaterThan(0);
	await expect.poll(() => readClipGain(properties)).toBeLessThan(12);
});
