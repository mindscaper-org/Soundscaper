/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, disableNativeSavePicker, importFiles, chooseExportProjectFileAction, downloadBytes } from './audio-editor-test-helpers.js';
import { strFromU8, unzipSync } from 'fflate';
import { safeScapeEntryId } from '../../src/common/editor/scape-archive-media.ts';

for (const form of ['NFC', 'NFD']) test(`spreadsheet chooses the actual ${form} recording for a canonical filename reference`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'Template.wav', duration: 0.1 })]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Clip spreadsheet']);
	const grid = editor.locator('[data-workspace-panel="clip-spreadsheet"]').getByRole('grid');
	const cell = grid.locator('[data-row="0"][data-column="source"]');
	const original = await cell.textContent();
	await cell.dblclick();
	const field = grid.getByRole('textbox', { name: 'Source file', exact: true });
	await field.fill('/recordings/' + 'Été.wav'.normalize(form === 'NFC' ? 'NFD' : 'NFC'));
	await field.press('Enter');
	const dialog = page.getByRole('dialog', { name: 'Clip spreadsheet', exact: true });
	const choosing = page.waitForEvent('filechooser');
	await dialog.getByRole('button', { name: 'Load referenced files', exact: true }).click();
	const name = 'Été.wav'.normalize(form);
	await (await choosing).setFiles(createWavFixture({ name, duration: 0.1, frequency: 550, channelCount: 1, channelAmplitudes: [0.25] }));
	await expect(dialog).toHaveCount(0);
	await expect(cell).not.toHaveText(original);
	const download = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await download));
	const project = JSON.parse(strFromU8(entries['project.json']));
	const source = project.sources.find(candidate => candidate.id === project.clips[0].sourceId);
	expect(source.name).toBe(name);
	expect(source.frameCount).toBe(4800);
	const pcm = entries[`audio/${safeScapeEntryId(source.id)}.f32c`];
	expect(pcm).toBeDefined();
	const samples = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
	expect(samples.getUint32(0, true)).toBe(4800);
	expect(samples.getFloat32(8, true)).toBeCloseTo(0.25 * Math.sin(2 * Math.PI * 550 / 48000), 4);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(cell).toHaveText(original);
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect(cell).toHaveText(source.id);
});
