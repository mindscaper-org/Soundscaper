/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, collectClientErrors, disableNativeSavePicker, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { exportSamples } from './helpers/round2-audio-export.js';

for (const lookahead of [0, .1]) test(`saved limiter ${lookahead}s lookahead keeps its release on the audible clock`, async ({ page }) => {
	const source = createAudioSource({ id: 'recording', sampleRate: 48_000, frameCount: 24_000, channelCount: 1 });
	const project = createSoundscaperProject({ id: `limiter-release-${lookahead}`, sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 24_000, sourceDurationFrames: 24_000 })],
		tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'], effects: [{ id: 'saved-limiter', type: 'limiter', enabled: true,
			params: { ceiling: 20 * Math.log10(.5), lookahead, release: .01 } }] })] });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() }); let blob;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		const samples = new Float32Array(source.frameCount).fill(.1); samples[12_000] = 1;
		await writer.write([samples]); await writer.commit(); blob = (await exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	const errors = collectClientErrors(page); await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Limiter.sscape', mimeType: 'application/zip', buffer: Buffer.from(await blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	const actual = await exportSamples(page, editor);
	console.log('limiter release after transient', { lookahead, transient: actual[12_000], next: actual[12_001], oneRelease: actual[12_480] });
	expect(actual[12_000]).toBeCloseTo(.5 * Math.SQRT1_2, 5);
	for (const distance of [1, 120, 480, 960]) {
		const expected = .1 * (1 - .5 * Math.exp(-distance / 480)) * Math.SQRT1_2;
		expect(Math.abs(actual[12_000 + distance] - expected)).toBeLessThan(.0001);
	}
	expect(errors).toEqual([]);
});
