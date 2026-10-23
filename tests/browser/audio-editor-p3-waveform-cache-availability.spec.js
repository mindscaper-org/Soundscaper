/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

for (const failure of ['read', 'write', 'none']) test(`stored audio remains available with optional waveform cache ${failure} failure`, async ({ page }) => {
	const source = createAudioSource({ id: 'source', name: 'Healthy recording', sampleRate: 48_000, frameCount: 24_000, channelCount: 1 });
	const project = createSoundscaperProject({ id: `cache-${failure}`, title: 'Healthy recording', sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, title: 'Healthy recording', timelineStartFrame: 0,
			sourceStartFrame: 0, sourceDurationFrames: 24_000, durationFrames: 24_000 })],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['clip'] })] });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	let file;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([new Float32Array(24_000).fill(.25)]); await writer.commit();
		const archive = await exportScapeProject(project, store); expect(archive.blob).toBeInstanceOf(Blob);
		file = { name: 'Healthy.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) };
	} finally { await store.close(); }
	await page.addInitScript(fault => {
		globalThis.__waveformCacheFault = { enabled: false, count: 0 };
		const method = fault === 'read' ? 'get' : 'put', original = IDBObjectStore.prototype[method];
		IDBObjectStore.prototype[method] = function (...args) {
			const key = method === 'get' ? args[0] : args[0]?.key;
			if (fault !== 'none' && globalThis.__waveformCacheFault.enabled && this.name === 'analysis'
				&& typeof key === 'string' && key.startsWith('audio-editor-peaks-v2:')) {
				globalThis.__waveformCacheFault.count++;
				throw new DOMException('Waveform cache is full', 'QuotaExceededError');
			}
			return Reflect.apply(original, this, args);
		};
	}, failure);
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	await page.evaluate(() => { globalThis.__waveformCacheFault.enabled = true; });
	await editor.locator('[data-aup4-input]').setInputFiles(file);
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	if (failure !== 'none') expect(await page.evaluate(() => globalThis.__waveformCacheFault.count)).toBeGreaterThan(0);
	const samples = await exportSamples(page, editor);
	expect(samples.length).toBeGreaterThan(20_000); expect(Math.max(...samples.map(Math.abs))).toBeGreaterThan(.1);
	const downloading = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const download = await downloading; expect(download.suggestedFilename()).toMatch(/\.sscape$/u);
});
