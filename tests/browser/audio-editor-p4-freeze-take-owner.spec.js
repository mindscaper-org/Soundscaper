/* SPDX-License-Identifier: AGPL-3.0-only */
import { assertPcmSamplesEqual } from '../helpers/assert-pcm-samples.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import { readFile } from 'node:fs/promises';
import { BlobReader, BlobWriter, ZipReader } from '@zip.js/zip.js/index-native.js';
import { bootEditor, chooseNestedCommandAction, chooseFileAction, chooseExportProjectFileAction, collectClientErrors, disableNativeSavePicker, registerAudioEditorHooks, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { exportScapeProject, SCAPE_MIME_TYPE } from '../../src/common/editor/scape-project.js';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { SOUNDSCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

registerAudioEditorHooks();
for (const retainedTake of [true, false]) test(`Freeze Commit ${retainedTake ? 'retains a recording still owned by another take group' : 'removes an otherwise unreferenced recording'}`, async ({ page }) => {
	const errors = collectClientErrors(page);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Freeze-take-owner.sscape', mimeType: SCAPE_MIME_TYPE, buffer: await archive(retainedTake) });
	await expect(editor).toHaveAttribute('data-project-id', 'freeze-take-owner');
	await editor.locator('[data-track-row][data-track-id="voice"] [data-track-header]').click();
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Freeze', 'Freeze track']);
	await expect.poll(async () => (await savedProject(page))?.tracks.find(({ id }) => id === 'voice')?.audioFreeze?.derivedSourceId).toBeTruthy();
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Freeze', 'Commit frozen track']);
	await expect.poll(async () => (await savedProject(page))?.tracks.find(({ id }) => id === 'voice')?.audioFreeze).toBeUndefined();
	await chooseFileAction(page, editor, 'Save project');
	const saved = await savedProject(page);
	expect(saved.takeGroups).toHaveLength(retainedTake ? 1 : 0);
	expect(saved.sources.some(({ id }) => id === 'recording')).toBe(retainedTake);
	expect(saved.tracks.find(({ id }) => id === 'voice').effects).toEqual([]);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect.poll(async () => (await savedProject(page))?.tracks.find(({ id }) => id === 'voice')?.audioFreeze).toBeTruthy();
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect.poll(async () => (await savedProject(page))?.tracks.find(({ id }) => id === 'voice')?.audioFreeze).toBeUndefined();
	await page.reload(); await expect(editor).toHaveAttribute('data-project-id', 'freeze-take-owner'); await waitForProjectActivation(editor);
	const reopened = await savedProject(page); expect(reopened.takeGroups).toEqual(saved.takeGroups);
	const downloading = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const download = await downloading, path = await download.path(); expect(path).toBeTruthy();
	const reader = new ZipReader(new BlobReader(new Blob([await readFile(path)])));
	try {
		const entry = (await reader.getEntries()).find(({ filename }) => filename === 'audio/recording.f32c');
		if (retainedTake) {
			expect(entry).toBeTruthy(); const body = await (await entry.getData(new BlobWriter())).arrayBuffer();
			expect(new DataView(body).getUint32(0, true)).toBe(4800);
			assertPcmSamplesEqual(new Float32Array(body.slice(4)), originalPcm());
		} else expect(entry).toBeUndefined();
	} finally { await reader.close(); }
	expect(errors).toEqual([]);
});

async function archive(retainedTake) {
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `p4-freeze-take-${retainedTake}` });
	try {
		const source = createAudioSource({ id: 'recording', storageKey: 'recording', name: 'Recorded take.wav', frameCount: 4800, channelCount: 1, sampleRate: 48000 });
		const samples = originalPcm();
		const writer = await store.beginSourceWrite(source.storageKey, source); await writer.write([samples]); await writer.commit();
		const project = createSoundscaperProject({ id: 'freeze-take-owner', title: 'Freeze take owner', sources: [source],
			clips: [createAudioClip({ id: 'ordinary', sourceId: source.id, durationFrames: 4800, sourceDurationFrames: 4800 })],
			tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['ordinary'], effects: [{ id: 'filter', type: 'highpass', enabled: true, params: { cutoff: 20 } }] }), createAudioTrack({ id: 'takes', name: 'Retained takes', clipIds: [] })],
			takeGroups: retainedTake ? [{ id: 'group', sequenceId: 'main-sequence', trackId: 'takes', startSample: 0, endSample: 4800,
				laneOrder: ['lane'], lanes: [{ id: 'lane' }], takes: [{ id: 'take', laneId: 'lane', sourceId: source.id, startSample: 0, endSample: 4800, sourceStartSample: 0 }],
				compRegions: [{ id: 'region', takeId: 'take', startSample: 0, endSample: 4800 }] }] : [] });
		const exported = await exportScapeProject(project, store); return Buffer.from(await exported.blob.arrayBuffer());
	} finally { await store.close(); }
}
function originalPcm() { return Float32Array.from({ length: 4800 }, (_, frame) => .2 * Math.sin(2 * Math.PI * 330 * frame / 48000)); }
async function savedProject(page) {
	return page.evaluate(databaseName => new Promise((resolve, reject) => {
		const request = indexedDB.open(databaseName); request.onerror = () => reject(request.error);
		request.onsuccess = () => { const database = request.result; const row = database.transaction('projects').objectStore('projects').get('freeze-take-owner');
			row.onsuccess = () => { database.close(); resolve(row.result); }; row.onerror = () => { database.close(); reject(row.error); }; };
	}), SOUNDSCAPER_DATABASE_NAME);
}
