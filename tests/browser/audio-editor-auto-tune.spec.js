/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseCommandAction, chooseDropdown, chooseNestedCommandAction, clipByName,
	collectClientErrors, commitInput, effectSourceMetadata, importFiles, registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('Auto-Tune selection effect', () => {
	registerAudioEditorHooks();
	test('opens from Effect, configures musical controls, previews, applies and undoes', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
		const voice = createWavFixture({ name: 'detuned-voice.wav', frequency: 450, duration: 3, sampleRate: 48000 });
		await importFiles(editor, [voice]);
		await chooseCommandAction(page, editor, 'Select', 'Select all');
		await chooseNestedCommandAction(page, editor, 'Effect', ['Distortion and modulation', 'Auto-Tune']);
		const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
		await chooseDropdown(page, dialog.getByRole('group', { name: 'Key', exact: true }), 'A');
		await chooseDropdown(page, dialog.getByRole('group', { name: 'Scale', exact: true }), 'Natural minor');
		await commitInput(dialog.getByRole('spinbutton', { name: 'Retune speed', exact: true }), '0');
		await commitInput(dialog.getByRole('spinbutton', { name: 'Correction amount', exact: true }), '80');
		await expect(dialog.getByRole('spinbutton', { name: 'Mix', exact: true })).toHaveValue('100');
		await dialog.getByRole('button', { name: 'Preview', exact: true }).click();
		const stopPreview = dialog.getByRole('button', { name: 'Stop preview', exact: true });
		await expect(stopPreview).toBeVisible({ timeout: 20000 });
		await stopPreview.click();
		await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click();
		await expect(dialog).toBeHidden({ timeout: 20000 });
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
		await expect.poll(async () => (await effectSourceMetadata(page))
			.find(source => source.name.includes('Auto-Tune'))?.frameCount).toBe(144000);
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(clipByName(editor, voice.name)).toHaveCount(1);
		await editor.getByRole('button', { name: 'Redo', exact: true }).click();
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10000 });
		expect(errors).toEqual([]);
	});
});
