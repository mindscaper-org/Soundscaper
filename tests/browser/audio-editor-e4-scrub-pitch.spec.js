/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, collectClientErrors, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

for (const [warm, pitchCents] of [[false, 1200], [true, 1200], [false, 0]]) test(`${warm ? 'warmed' : 'fresh'} timeline scrub retains ${pitchCents}cents clip pitch`, async ({ page }) => {
	const errors = collectClientErrors(page);
	await page.addInitScript(() => {
		globalThis.__scrubFrequencies = [];
		const scheduled = new WeakMap(), setValueAtTime = AudioParam.prototype.setValueAtTime;
		AudioParam.prototype.setValueAtTime = function (value, time) {
			scheduled.set(this, value); return Reflect.apply(setValueAtTime, this, [value, time]);
		};
		const start = AudioBufferSourceNode.prototype.start;
		AudioBufferSourceNode.prototype.start = function (...args) {
			if (this.context instanceof AudioContext && this.buffer?.length > 12_000) {
				const pcm = this.buffer.getChannelData(0), first = Math.floor(pcm.length / 4), end = Math.floor(pcm.length * 3 / 4);
				let crossings = 0;
				for (let frame = first + 1; frame < end; frame++) if (pcm[frame - 1] < 0 && pcm[frame] >= 0) crossings++;
				globalThis.__scrubFrequencies.push(crossings * this.buffer.sampleRate / (end - first) * (scheduled.get(this.playbackRate) ?? this.playbackRate.value));
			}
			return Reflect.apply(start, this, args);
		};
	});
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 96_000, channelCount: 1 });
	const project = createSoundscaperProject({ id: `scrub-${warm}-${pitchCents}`, sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, sourceDurationFrames: 96_000, durationFrames: 96_000,
			pitchCents, speedRatio: 1, linkPitchAndTempo: false })], tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'] })] });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() }); let file;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		for (let offset = 0; offset < source.frameCount; offset += source.chunkFrames) await writer.write([
			Float32Array.from({ length: Math.min(source.chunkFrames, source.frameCount - offset) },
				(_, frame) => .25 * Math.sin(2 * Math.PI * 1000 * (offset + frame) / 48_000)),
		]);
		await writer.commit(); const archive = await exportScapeProject(project, store); expect(archive.blob).toBeInstanceOf(Blob);
		file = { name: 'Pitched.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) };
	} finally { await store.close(); }
	const editor = await bootEditor(page, '/embed/en/'); await editor.locator('[data-aup4-input]').setInputFiles(file);
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	if (warm) {
		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		await expect.poll(() => page.evaluate(() => globalThis.__scrubFrequencies.length)).toBeGreaterThan(0);
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	}
	await page.evaluate(() => { globalThis.__scrubFrequencies = []; });
	const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true }); await playhead.press('Home');
	const box = await playhead.locator('.playhead-cursor__icon').boundingBox(); expect(box).not.toBeNull();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
	try {
		await expect.poll(() => page.evaluate(() => globalThis.__scrubFrequencies.length)).toBeGreaterThan(0);
		const frequency = await page.evaluate(() => globalThis.__scrubFrequencies.at(-1));
		expect(Math.abs(frequency - (pitchCents ? 2000 : 1000))).toBeLessThan(8);
	} finally { await page.mouse.up(); }
	expect(errors).toEqual([]);
});
