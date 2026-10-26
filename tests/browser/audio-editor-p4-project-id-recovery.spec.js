/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { strFromU8, unzipSync } from 'fflate';
import { bootEditor, chooseFileAction, chooseExportProjectFileAction, chooseDropdown, disableNativeSavePicker,
	downloadBytes, openExportDialog, closeDialog, collectClientErrors, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { installOscillatorMicrophone, persistedProject } from './helpers/complex-editing-workflows.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { parseScapeProjectDocument } from '../../src/common/editor/scape-project-document.ts';
import { inspectWavBlobPcm } from '../../src/common/editor/wav-import.js';

test.use({ browserCoverage: false });
for (const id of ['padded', ' padded ', 'e\u0301']) test(`native project ${JSON.stringify(id)} records, saves, exports and reopens with exact identity`, async ({ page }) => {
	test.setTimeout(90_000);
	const clientErrors = collectClientErrors(page);
	await installOscillatorMicrophone(page); await disableNativeSavePicker(page);
	await page.addInitScript(() => {
		window.__projectIdRecordingChunks = 0;
		const NativeNode = AudioWorkletNode;
		window.AudioWorkletNode = class extends NativeNode {
			constructor(context, name, options) {
				super(context, name, options);
				if (name === 'kw-audio-recorder') {
					this.port.addEventListener('message', ({ data }) => { if (data.type === 'audio-chunk') window.__projectIdRecordingChunks++; });
					this.port.start();
				}
			}
		};
	});
	const project = createSoundscaperProject({ id, title: 'Recording project', tracks: [createAudioTrack({ id: 'voice', name: 'Voice', armed: true })] });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() }); let archive;
	try { archive = (await exportScapeProject(project, store)).blob; } finally { await store.close(); }
	const editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
	const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: 'Recording project.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', id);
	await waitForProjectActivation(editor);
	await expect.poll(() => editor.getAttribute('data-edit-block-reason')).toBeNull();
	const record = editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button');
	await record.click(); await expect(record).toHaveAttribute('aria-pressed', 'true');
	await expect.poll(() => page.evaluate(() => window.__projectIdRecordingChunks)).toBeGreaterThanOrEqual(2);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	await expect(record).toHaveAttribute('aria-pressed', 'false');
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect.poll(() => editor.getAttribute('data-edit-block-reason')).toBeNull();
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const persisted = await persistedProject(page, id);
	expect(persisted.id).toBe(id); expect(persisted.sources[0].frameCount).toBeGreaterThan(4096);
	const saving = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const native = await saving; let bytes;
	try { bytes = await downloadBytes(native); } finally { await native.delete(); }
	const saved = parseScapeProjectDocument(strFromU8(unzipSync(bytes)['project.json']), { currentProjectSchemaFamily: 'soundscaper' });
	expect(saved.id).toBe(id); expect(saved.sources[0].frameCount).toBe(persisted.sources[0].frameCount);
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="bitDepth"]'), '32-bit Float');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]'); await expect(link).toBeVisible({ timeout: 30_000 });
	const downloading = page.waitForEvent('download'); await link.click(); const wavDownload = await downloading;
	let wav; try { wav = await downloadBytes(wavDownload); } finally { await wavDownload.delete(); }
	const pcm = await inspectWavBlobPcm(new Blob([wav]));
	expect(pcm.frameCount).toBe(persisted.sources[0].frameCount); expect(pcm.sampleRate).toBe(48_000);
	const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength); let peak = 0;
	for (let frame = 0; frame < pcm.frameCount; frame++) peak = Math.max(peak, Math.abs(view.getFloat32(pcm.dataOffset + frame * pcm.blockAlign, true)));
	expect(peak).toBeGreaterThan(.05); await closeDialog(dialog);
	await page.reload(); await expect(editor).toHaveAttribute('data-project-id', id); await waitForProjectActivation(editor);
	await expect(editor).toHaveAttribute('data-clip-count', '1'); await expect.poll(() => editor.getAttribute('data-edit-block-reason')).toBeNull();
	expect(clientErrors).toEqual([]);
});
