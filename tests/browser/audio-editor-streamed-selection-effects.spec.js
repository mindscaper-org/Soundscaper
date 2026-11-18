/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, collectClientErrors, effectSourceMetadata, importFiles } from './audio-editor-test-helpers.js';

test('ordinary Apply streams a long normalization and a realtime effect through the existing menu', async ({ page }) => {
	test.setTimeout(180000);
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [createWavFixture({ name: 'long-selection.wav', frequency: 440, duration: 240, sampleRate: 48000, channelCount: 2 })], { timeout: 60_000 });
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	for (const [category, name] of [['Volume and compression', 'Normalize'], ['Special', 'Invert']]) {
		await chooseNestedCommandAction(page, editor, 'Effect', [category, name]);
		const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
		if (name === 'Normalize') {
			await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click();
			await expect(dialog).toBeHidden({ timeout: 90000 });
		} else await expect(dialog).toHaveCount(0);
		await expect(editor.locator('[data-status]')).toHaveText('Applied the Audacity effect.', { timeout: 60_000 });
		await expect.poll(async () => (await effectSourceMetadata(page)).find(source => source.name.includes(name))?.frameCount).toBe(11520000);
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	}
	expect(errors).toEqual([]);
});
