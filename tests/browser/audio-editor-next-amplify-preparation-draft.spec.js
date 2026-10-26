/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, closeClipProperties, importFiles, openClipProperties } from './audio-editor-test-helpers.js';

test('Amplify keeps an edited gain draft while the current audio default is still being prepared', async ({ page }) => {
	let release;
	const held = new Promise(resolve => { release = resolve; });
	let pending = 0;
	await page.route('**/staffpad-*.wasm', async route => { pending++; await held; await route.continue(); });
	try {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [createWavFixture({ name: 'Quiet.wav', duration: 1, frequency: 500, channelCount: 1 })]);
		const clip = editor.locator('[data-clip-id]').first();
		const properties = await openClipProperties(page, editor, clip, { additional: false });
		const pitch = properties.getByRole('textbox', { name: 'Pitch', exact: true });
		await pitch.fill('12'); await pitch.press('Enter');
		await closeClipProperties(properties);
		await clip.focus();
		await expect(clip).toBeFocused();
		await clip.press('Enter');
		await expect(clip.locator('.clip-display')).toHaveClass(/clip-display--selected/u);
		await chooseNestedCommandAction(page, editor, 'Effect', ['Volume and compression', 'Amplify']);
		const dialog = page.locator('[data-selection-effects-dialog]');
		const gain = dialog.locator('[data-effect-param="gainDb"]');
		const input = gain.locator('input[type="number"]');
		await expect.poll(() => pending).toBeGreaterThan(0);
		await input.fill('6');
		release();
		const slider = gain.getByRole('slider');
		await expect(slider).not.toHaveValue('0', { timeout: 30_000 });
		await expect(input).toHaveValue('6');
		await input.press('Tab');
		await expect(slider).toHaveValue('6');
	} finally { release(); }
});
