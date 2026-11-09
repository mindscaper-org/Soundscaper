/* SPDX-License-Identifier: AGPL-3.0-only */

import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseExportProjectFileAction, chooseFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';

// Node admits each legacy-encoding, quote and empty-title input independently,
// then checks exact labels after portable archive reopening.
test('a Windows CUE sheet binds accented, quoted, bare and unnamed titles through Labels and Save', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	// CUETools writes the Windows system encoding when all text fits it and
	// "always write UTF-8" is off. These titles fit German Windows-1252.
	const sheet = 'TITLE "Frühlingskonzert"\r\nPERFORMER "René Müller"\r\nFILE "concert.wav" WAVE\r\n'
		+ 'TRACK 01 AUDIO\r\n TITLE ""\r\n INDEX 01 00:00:00\r\n'
		+ 'TRACK 02 AUDIO\r\n TITLE \'97\r\n INDEX 01 00:00:01\r\n'
		+ 'TRACK 03 AUDIO\r\n TITLE \'\r\n INDEX 01 00:00:02\r\n'
		+ 'TRACK 04 AUDIO\r\n TITLE "\'97"\r\n INDEX 01 00:00:03\r\n'
		+ 'TRACK 05 AUDIO\r\n TITLE "Ouvertüre"\r\n INDEX 01 00:00:04\r\n'
		+ 'TRACK 06 AUDIO\r\n TITLE "Straße zum Café"\r\n INDEX 01 00:01:00\r\n';
	const expected = [
		{ title: 'Track 01', startFrame: 0, endFrame: 0 },
		{ title: "'97", startFrame: 640, endFrame: 640 },
		{ title: "'", startFrame: 1280, endFrame: 1280 },
		{ title: "'97", startFrame: 1920, endFrame: 1920 },
		{ title: 'Ouvertüre', startFrame: 2560, endFrame: 2560 },
		{ title: 'Straße zum Café', startFrame: 48_000, endFrame: 48_000 },
	];
	const picking = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Import');
	await (await picking).setFiles({ name: 'concert.cue', mimeType: 'application/x-cue', buffer: Buffer.from(sheet, 'latin1') });
	const dialog = page.getByRole('dialog', { name: 'Import', exact: true });
	await dialog.getByRole('button', { name: 'Labels', exact: true }).click();
	const labels = editor.locator('[data-label-track] [data-label-id]');
	await expect(labels).toHaveCount(expected.length);
	await expect(editor.locator('[data-label-track]')).toContainText('Frühlingskonzert');
	for (const [index, { title }] of expected.entries()) await expect(labels.nth(index)).toHaveAttribute('aria-label', `Edit labels: ${title}`);
	await chooseCommandAction(page, editor, 'Edit', 'Undo'); await expect(labels).toHaveCount(0);
	await chooseCommandAction(page, editor, 'Edit', 'Redo'); await expect(labels).toHaveCount(expected.length);
	const saving = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const project = JSON.parse(strFromU8(unzipSync(await downloadBytes(await saving))['project.json']));
	const saved = project.tracks.flatMap(track => track.type === 'label' ? track.labels : []);
	expect(saved.map(({ title, startFrame, endFrame }) => ({ title, startFrame, endFrame }))).toEqual(expected);
});
