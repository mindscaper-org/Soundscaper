/* SPDX-License-Identifier: AGPL-3.0-only */

import { Buffer } from 'node:buffer';
import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import {
	bootEditor, importFiles, chooseNestedCommandAction, chooseExportProjectFileAction,
	disableNativeSavePicker, closeDialog, downloadBytes, waitForProjectActivation,
} from './audio-editor-test-helpers.js';

test('SCAPE Open as copy keeps explicit visualizer audio and its saved visual preset', async ({ page }) => {
	test.setTimeout(90_000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'Narration.wav', duration: 1, frequency: 440, channelCount: 1 })]);
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Add Sound Visualizer']);
	const visual = editor.getByRole('group', { name: 'Video clip: Sound Visualizer', exact: true });
	await visual.press('Enter');
	const openInspector = async () => {
		await chooseNestedCommandAction(page, editor, 'Effect', ['Video Finishing', 'Selected Visual Inspector']);
		return page.getByRole('dialog', { name: 'Selected Visual Inspector', exact: true });
	};
	let dialog = await openInspector();
	await dialog.getByRole('checkbox', { name: 'Narration.wav', exact: true }).check();
	await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
	await expect(dialog.getByRole('status')).toHaveText('Selected visual updated.');
	await closeDialog(dialog);
	await chooseNestedCommandAction(page, editor, 'Generate',
		['Video Generators', EDITOR_ENGLISH_COPY['ui.framescaperMenus.saveVideoVisualPreset']]);
	dialog = page.getByRole('dialog', { name: 'Selected Visual Presets', exact: true });
	await dialog.getByRole('textbox', { name: 'Preset name', exact: true }).fill('Saved waveform');
	await dialog.getByRole('button', { name: 'Save selected generator preset', exact: true }).click();
	await expect(dialog.getByRole('status')).toHaveText('Selected visual preset saved.');
	await closeDialog(dialog);
	const download = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const bytes = await downloadBytes(await download);
	const oldId = await editor.getAttribute('data-project-id');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Visualizer.fscape',
		mimeType: 'application/vnd.soundscaper.scape+zip', buffer: Buffer.from(bytes) });
	const collision = page.getByRole('dialog', { name: 'Project already exists', exact: true });
	await collision.getByRole('button', { name: 'Open as copy', exact: true }).click();
	await expect(editor).not.toHaveAttribute('data-project-id', oldId, { timeout: 30_000 });
	await waitForProjectActivation(editor);
	await visual.press('Enter');
	dialog = await openInspector();
	await expect(dialog.getByRole('checkbox', { name: 'Narration.wav', exact: true })).toBeChecked();
	await expect(dialog.getByRole('combobox', { name: 'Visual preset', exact: true })
		.getByRole('option', { name: 'Saved waveform', exact: true })).toHaveCount(1);
});
