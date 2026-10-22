/* SPDX-License-Identifier: AGPL-3.0-only */

import { encodeAiff } from '../../src/common/editor/aiff.js';
import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';

test('the spreadsheet referenced-file chooser offers supported AIFF-C recordings', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'Template.wav', frequency: 330, duration: 0.1 })]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Clip spreadsheet']);
	const grid = editor.locator('[data-workspace-panel="clip-spreadsheet"]').getByRole('grid');
	const sourceCell = grid.locator('[data-row="0"][data-column="source"]');
	const originalSourceId = await sourceCell.textContent();
	await sourceCell.dblclick();
	const input = grid.getByRole('textbox', { name: 'Source file', exact: true });
	await input.fill('/recordings/Voice.aifc');
	await input.press('Enter');
	const dialog = page.getByRole('dialog', { name: 'Clip spreadsheet', exact: true });
	const choosing = page.waitForEvent('filechooser');
	await dialog.getByRole('button', { name: 'Load referenced files', exact: true }).click();
	const chooser = await choosing;
	const accept = await chooser.element().getAttribute('accept');
	expect(accept.split(',')).toContain('.aifc');
	const samples = Float32Array.from({ length: 4_800 }, (_, index) => 0.25 * Math.sin(index / 20));
	const encoded = encodeAiff([samples], { sampleRate: 48_000, sampleFormat: 'float32' });
	expect(Buffer.from(encoded.subarray(8, 12)).toString('ascii')).toBe('AIFC');
	await chooser.setFiles({ name: 'Voice.aifc', mimeType: '', buffer: Buffer.from(encoded) });
	await expect(dialog).toHaveCount(0);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const project = await persistedProject(page, await editor.getAttribute('data-project-id'));
	const source = project.sources.find(candidate => candidate.id === project.clips[0].sourceId);
	expect(source.name).toBe('Voice.aifc');
	expect(source.frameCount).toBe(samples.length);
	expect(source.sampleRate).toBe(48_000);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(sourceCell).toHaveText(originalSourceId);
});
