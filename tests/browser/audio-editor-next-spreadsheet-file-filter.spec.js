/* SPDX-License-Identifier: AGPL-3.0-only */

import { encodeAiff } from '../../src/common/editor/aiff.js';
import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';
import { registerFileCapabilityIpc } from '../../desktop/main-file-capability-ipc.mjs';
import { aacLcM4a44_100Fixture } from '../helpers/os-audio-codec-fixtures.ts';

for (const extension of ['aifc', 'mp4', 'm4v']) test(`the spreadsheet referenced-file chooser imports supported ${extension} recordings`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'Template.wav', frequency: 330, duration: extension === 'aifc' ? 0.1 : 0.02 })]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Clip spreadsheet']);
	const grid = editor.locator('[data-workspace-panel="clip-spreadsheet"]').getByRole('grid');
	const sourceCell = grid.locator('[data-row="0"][data-column="source"]');
	const originalSourceId = await sourceCell.textContent();
	await sourceCell.dblclick();
	const input = grid.getByRole('textbox', { name: 'Source file', exact: true });
	await input.fill(`/recordings/Voice.${extension}`);
	await input.press('Enter');
	const dialog = page.getByRole('dialog', { name: 'Clip spreadsheet', exact: true });
	const choosing = page.waitForEvent('filechooser');
	await dialog.getByRole('button', { name: 'Load referenced files', exact: true }).click();
	const chooser = await choosing;
	const accept = await chooser.element().getAttribute('accept');
	expect(accept.split(',')).toContain(`.${extension}`);
	const samples = Float32Array.from({ length: 4_800 }, (_, index) => 0.25 * Math.sin(index / 20));
	const encoded = extension === 'aifc' ? encodeAiff([samples], { sampleRate: 48_000, sampleFormat: 'float32' }) : aacLcM4a44_100Fixture();
	if (extension === 'aifc') expect(Buffer.from(encoded.subarray(8, 12)).toString('ascii')).toBe('AIFC');
	await chooser.setFiles({ name: `Voice.${extension}`, mimeType: '', buffer: Buffer.from(encoded) });
	await expect(dialog).toHaveCount(0);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const project = await persistedProject(page, await editor.getAttribute('data-project-id'));
	const source = project.sources.find(candidate => candidate.id === project.clips[0].sourceId);
	expect(source.name).toBe(`Voice.${extension}`);
	if (extension === 'aifc') expect(source.frameCount).toBe(samples.length);
	else expect(source.frameCount).toBeGreaterThan(0);
	expect(source.sampleRate).toBe(extension === 'aifc' ? 48_000 : 44_100);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(sourceCell).toHaveText(originalSourceId);
});

test('the desktop spreadsheet chooser offers audio-only MP4 and M4V source aliases', async ({ page }) => {
	const handlers = new Map();
	const panels = [];
	registerFileCapabilityIpc({
		channels: { chooseFiles: 'open', releaseRead: 'release', chooseSaveTarget: 'save', releaseSaveTarget: 'release-save',
			beginWrite: 'begin', writeChunk: 'chunk', patchFinalPrefix: 'prefix', finishWrite: 'finish', abortWrite: 'abort' },
		desktopSmokeProbe: { resolveOpenPaths: () => null, resolveSavePath: async () => null },
		dialog: { showOpenDialog: async (_window, options) => { panels.push(options); return { canceled: true, filePaths: [] }; },
			showSaveDialog: async () => ({ canceled: true }) },
		handle: (channel, listener) => { handlers.set(channel, listener); },
		opaqueId: String, ownerFor: () => 'owner', pendingOpenProjects: new Map(),
		readCapabilities: {}, saves: {}, saveTargets: {}, windowFor: () => null,
	});
	await page.exposeBinding('__spreadsheetNativePanel', async (_source, request) => await handlers.get('open')({}, request));
	await page.addInitScript(() => Object.defineProperty(globalThis, 'soundscaperDesktop', { value: { v1: {
		chooseFiles: request => globalThis.__spreadsheetNativePanel(request),
	} } }));
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'Template.wav', duration: 0.1 })]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Clip spreadsheet']);
	const grid = editor.locator('[data-workspace-panel="clip-spreadsheet"]').getByRole('grid');
	await grid.locator('[data-row="0"][data-column="source"]').dblclick();
	const input = grid.getByRole('textbox', { name: 'Source file', exact: true });
	await input.fill('/recordings/Voice.mp4');
	await input.press('Enter');
	const dialog = page.getByRole('dialog', { name: 'Clip spreadsheet', exact: true });
	await dialog.getByRole('button', { name: 'Load referenced files', exact: true }).click();
	await expect.poll(() => panels.length).toBe(1);
	const offered = panels[0].filters.flatMap(filter => filter.extensions);
	for (const extension of ['mp4', 'm4v', 'm4a', 'aifc', 'wav', 'flac']) expect(offered).toContain(extension);
	for (const extension of ['cue', 'txt', 'srt', 'vtt']) expect(offered).not.toContain(extension);
	await expect(dialog).toBeVisible();
	await expect(editor).toHaveAttribute('data-clip-count', '1');
});
