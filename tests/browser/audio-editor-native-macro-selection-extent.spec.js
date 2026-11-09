/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, closeDialog, importFiles, disableNativeSavePicker,
	chooseExportProjectFileAction, downloadBytes } from './audio-editor-test-helpers.js';
import { validateSoundscaperProject } from '../../src/soundscaper/editor-project.ts';

for (const [fields, expected] of [
	['Start="0.1" End="0.2"', [4800, 9600]],
	['Start="100" End="101"', [4_800_000, 4_848_000]],
	['Start="100"', [0, 4_800_000]],
]) test(`native time selection retains its declared extent: ${fields}`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false }); await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	const choosing = page.waitForEvent('filechooser');
	await manager.getByRole('button', { name: 'Import macro', exact: true }).click();
	await (await choosing).setFiles({ name: 'Native exact selection.txt', mimeType: 'text/plain',
		buffer: Buffer.from(`SelectTime:${fields} RelativeTo="ProjectStart"\n`) });
	await expect(manager.getByRole('textbox', { name: 'Macro name', exact: true })).toHaveValue('Native exact selection');
	await manager.getByRole('button', { name: 'Run macro', exact: true }).click();
	await expect(editor.locator('[data-status]')).toHaveText('Done'); await closeDialog(manager);
	const downloading = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const download = await downloading, bytes = await downloadBytes(download); await download.delete();
	const project = JSON.parse(strFromU8(unzipSync(bytes)['project.json']));
	expect(validateSoundscaperProject(project)).toBe(true);
	expect([project.selection.startFrame, project.selection.endFrame]).toEqual(expected);
});
