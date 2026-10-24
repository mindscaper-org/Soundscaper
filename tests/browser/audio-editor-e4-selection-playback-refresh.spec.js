/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, collectClientErrors, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

for (const mode of ['selected', 'ordinary', 'spectral']) test(`adding a track preserves ${mode} playback bounds`, async ({ page }) => {
	const selected = mode !== 'ordinary';
	await page.addInitScript(() => {
		globalThis.__selectionRefreshStarts = [];
		const connect = AudioNode.prototype.connect;
		AudioNode.prototype.connect = function (destination, ...ports) {
			if (destination === this.context.destination && this.context instanceof AudioContext) {
				const analyser = this.context.createAnalyser(); analyser.fftSize = 16_384; analyser.smoothingTimeConstant = 0;
				connect.call(this, analyser, ...ports); connect.call(analyser, destination);
				globalThis.__selectionRefreshSpectrum = () => {
					const bins = new Float32Array(analyser.frequencyBinCount); analyser.getFloatFrequencyData(bins);
					const peak = frequency => { const index = Math.round(frequency * analyser.fftSize / this.context.sampleRate); return Math.max(...bins.slice(index - 2, index + 3)); };
					return { inside: peak(512), outside: peak(4096) };
				};
				return destination;
			}
			return connect.call(this, destination, ...ports);
		};
		const start = AudioBufferSourceNode.prototype.start;
		AudioBufferSourceNode.prototype.start = function (...args) {
			if (this.context instanceof AudioContext && this.buffer?.length === 480_000) {
				globalThis.__selectionRefreshStarts.push({ offset: args[1] ?? 0, duration: args[2] ?? this.buffer.duration });
			}
			return Reflect.apply(start, this, args);
		};
	});
	const source = createAudioSource({ id: 'recording', sampleRate: 48_000, frameCount: 480_000, channelCount: 1 });
	const project = createSoundscaperProject({ id: `selection-refresh-${mode}`, sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: source.frameCount, sourceDurationFrames: source.frameCount })],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['clip'] })],
		selection: { startFrame: 0, endFrame: 240_000, trackIds: ['voice'], clipIds: [], ...(mode === 'spectral' ? { frequencyRange: { minimumFrequency: 300, maximumFrequency: 900 } } : {}) } });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() }); let blob;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		for (let offset = 0; offset < source.frameCount; offset += source.chunkFrames) await writer.write([
			Float32Array.from({ length: Math.min(source.chunkFrames, source.frameCount - offset) }, (_, frame) => .1 * (Math.sin(2 * Math.PI * 512 * (offset + frame) / 48_000) + Math.sin(2 * Math.PI * 4096 * (offset + frame) / 48_000))),
		]);
		await writer.commit(); blob = (await exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	const errors = collectClientErrors(page); const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Selection.sscape', mimeType: 'application/zip', buffer: Buffer.from(await blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	if (selected) {
		await editor.getByRole('button', { name: 'Play options', exact: true }).click();
		await page.getByRole('menu', { name: 'Play options', exact: true }).getByRole('menuitem', { name: mode === 'spectral' ? 'Play selected frequencies' : /^Play selection(?:\s|$)/u }).click();
	} else await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__selectionRefreshStarts.length)).toBeGreaterThan(0);
	if (mode === 'spectral') await expect.poll(() => page.evaluate(() => { const spectrum = globalThis.__selectionRefreshSpectrum(); return spectrum.inside - spectrum.outside; })).toBeGreaterThan(20);
	const before = await page.evaluate(() => globalThis.__selectionRefreshStarts.length);
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'Audio track']);
	await expect(editor.locator('[data-track-row]')).toHaveCount(2);
	await expect.poll(() => page.evaluate(() => globalThis.__selectionRefreshStarts.length)).toBeGreaterThan(before);
	const resumed = await page.evaluate(before => globalThis.__selectionRefreshStarts.slice(before), before);
	console.log('rescheduled playback after Add track', { selected, resumed });
	for (const start of resumed) expect(start.offset + start.duration).toBeCloseTo(selected ? 5 : 10, 4);
	if (mode === 'spectral') await expect.poll(() => page.evaluate(() => { const spectrum = globalThis.__selectionRefreshSpectrum(); return spectrum.inside - spectrum.outside; })).toBeGreaterThan(20);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	if (mode === 'spectral') {
		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		await expect.poll(() => page.evaluate(() => globalThis.__selectionRefreshSpectrum().outside)).toBeGreaterThan(-40);
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	}
	expect(errors).toEqual([]);
});
