/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseDropdown, disableNativeSavePicker, downloadBytes, openExportDialog, waitForEditor, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { SOUNDSCAPER_DATABASE_NAME } from './helpers/editor-databases.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

test('interrupted recording publishes only channel-verified checkpoints and exports their stereo PCM', async ({ page }) => {
	test.setTimeout(90_000);
	await disableNativeSavePicker(page);
	const sources = ['first', 'last'].map(id => createAudioSource({ id, name: 'Mic', frameCount: 4800, channelCount: 2, sampleRate: 48_000 }));
	const clips = sources.map((source, index) => createAudioClip({ id: `clip-${index}`, sourceId: source.id,
		timelineStartFrame: index * 4800, durationFrames: 4800, sourceDurationFrames: 4800 }));
	const project = createSoundscaperProject({ id: 'p3-recovery-channels', sources, clips,
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: clips.map(clip => clip.id) })] });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	let archive;
	try {
		for (const source of sources) {
			const writer = await store.beginSourceWrite(source.storageKey, source);
			await writer.write([new Float32Array(4800).fill(.25), new Float32Array(4800).fill(.5)]); await writer.commit();
		}
		const { blob } = await exportScapeProject(project, store);
		archive = { name: 'Recording.sscape', mimeType: 'application/zip', buffer: Buffer.from(await blob.arrayBuffer()) };
	} finally { await store.close(); }
	let editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles(archive);
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	// Model an interrupted durable recording: its base has no committed clips, both PCM checkpoints exist,
	// and only the final journal's channel description was damaged before restart.
	await page.evaluate(async ({ databaseName, projectId }) => {
		const request = operation => new Promise((resolve, reject) => { operation.onsuccess = () => resolve(operation.result); operation.onerror = () => reject(operation.error); });
		const database = await request(indexedDB.open(databaseName));
		try {
			const transaction = database.transaction(['projects', 'analysis'], 'readwrite');
			const projects = transaction.objectStore('projects'); const saved = await request(projects.get(projectId));
			const base = { ...saved, sources: [], clips: [], tracks: saved.tracks.map(track => ({ ...track, clipIds: [] })) };
			projects.put(base);
			transaction.objectStore('analysis').put({ key: `recording-recovery-v1:${encodeURIComponent(projectId)}`, value: {
				version: 1, projectId, id: 'capture', base,
				lanes: [{ id: 'mic', destination: { trackId: 'voice', startFrame: 0, sourceOffsetFrames: 0, sampleRate: 48_000, selection: null },
					segments: saved.sources.map((source, index) => ({ sourceId: source.id, frameStart: index * 4800, frameCount: 4800,
						metadata: { name: 'Mic', channelCount: index === 0 ? 2 : 1 } })) }],
				decision: null, targetBase: null, target: null, lostCheckpointCount: 0,
			} });
			await new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error); });
		} finally { database.close(); }
	}, { databaseName: SOUNDSCAPER_DATABASE_NAME, projectId: project.id });
	await page.reload(); editor = await waitForEditor(page);
	const recovery = page.getByRole('dialog', { name: 'Interrupted recording', exact: true });
	await expect(recovery).toBeVisible();
	await recovery.getByRole('button', { name: 'Recover recording', exact: true }).click();
	await expect(recovery).toBeHidden(); await waitForProjectActivation(editor);
	await expect(editor.locator('.clip-display')).toHaveCount(1);
	const exported = await openExportDialog(page, editor);
	await chooseDropdown(page, exported.locator('[data-export-field="format"]'), 'WAV');
	await chooseDropdown(page, exported.locator('[data-export-field="bitDepth"]'), '16-bit PCM');
	await exported.getByRole('button', { name: 'Export', exact: true }).click();
	const link = exported.locator('[data-export-download]'); await expect(link).toBeVisible();
	const downloading = page.waitForEvent('download'); await link.click();
	const bytes = await downloadBytes(await downloading);
	const result = await page.evaluate(async bytes => {
		const context = new AudioContext({ sampleRate: 48_000 });
		try {
			const buffer = await context.decodeAudioData(Uint8Array.from(bytes).buffer);
			return { channels: buffer.numberOfChannels, frames: buffer.length, samples: [buffer.getChannelData(0)[2400], buffer.getChannelData(1)[2400]] };
		} finally { await context.close(); }
	}, [...bytes]);
	expect(result.frames).toBe(4800); expect(result.channels).toBe(2);
	expect(result.samples[0]).toBeCloseTo(.25, 3); expect(result.samples[1]).toBeCloseTo(.5, 3);
});
