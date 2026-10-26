/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseDropdown, chooseFileAction, closeDialog, disableNativeSavePicker, openExportDialog, readDownloadBytes } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { inspectWavBlobPcm } from '../../src/common/editor/wav-import.js';
import { createWavBlobPcmChunkReader } from '../../src/common/editor/wav-pcm-chunk-reader.ts';

for (const emptyPrimary of [false, true]) test(`File Export delivers a secondary mastering order (empty primary:${emptyPrimary})`, async ({ page }) => {
	const ids = emptyPrimary ? ['cut'] : ['main', 'cut'];
	const source = createAudioSource({ id: 'programme', frameCount: 48_000, channelCount: 1, sampleRate: 48_000 });
	const project = createSoundscaperProject({ id: `secondary-mastering-${String(emptyPrimary)}`, title: 'Two programmes', masterChannels: 2,
		primarySequenceId: 'main', sequences: [{ id: 'main', trackIds: emptyPrimary ? [] : ['main-track'] }, { id: 'cut', trackIds: ['cut-track'] }],
		sources: [source], clips: ids.map(id => createAudioClip({ id: `${id}-clip`, sourceId: source.id, durationFrames: 48_000, sourceDurationFrames: 48_000 })),
		tracks: ids.map(id => createAudioTrack({ id: `${id}-track`, gain: id === 'cut' ? 2 : 1, clipIds: [`${id}-clip`] })),
		timelineAnnotations: ids.map(id => ({ id: `${id}-region`, sequenceId: id, name: `${id} region`, kind: 'region', anchor: 'sample',
			startFrame: 0, endFrame: 24_000, color: 'auto', batchId: null, opaqueExtensions: {} })),
		masteringSequences: [{ id: 'cut-order', sequenceId: 'cut', name: 'Cut order', entries: [{ id: 'entry', annotationId: 'cut-region' }] }],
	});
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: project.id });
	let blob;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([new Float32Array(source.frameCount).fill(.1)]); await writer.commit();
		blob = (await exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: 'Two programmes.sscape', mimeType: 'application/zip', buffer: Buffer.from(await blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id);
	if (!emptyPrimary) {
		const primary = await exportProgramme(page, editor);
		expect(primary.length).toBe(48_000); expect(primary[12_000]).toBeCloseTo(.1 * Math.SQRT1_2, 5);
	}
	const cut = await exportProgramme(page, editor, 'Cut order');
	expect(cut.length).toBe(24_000); expect(cut[12_000]).toBeCloseTo(.2 * Math.SQRT1_2, 5);
});

async function exportProgramme(page, editor, output) {
	const dialog = await openExportDialog(page, editor);
	if (output) await chooseDropdown(page, dialog.locator('[data-export-field="output"]'), output);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'WAV');
	const link = dialog.locator('[data-export-download]');
	const previous = await link.count() ? await link.getAttribute('href') : null;
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	await expect(link).toBeVisible(); await expect.poll(() => link.getAttribute('href')).not.toBe(previous);
	const file = new Blob([await readDownloadBytes(page, link)]);
	const descriptor = await inspectWavBlobPcm(file);
	const samples = (await createWavBlobPcmChunkReader(file, { descriptor }).readChunk(0)).channels[0];
	await closeDialog(dialog); return samples;
}
