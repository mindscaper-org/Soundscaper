/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

for (const mode of ['normal', 'long-gap', 'short-gap', 'phase-gap']) test(`metronome follows the audible timeline through ${mode}`, async ({ page }) => {
	await page.addInitScript(() => {
		globalThis.__metroClicks = [];
		globalThis.__metroStarts = [];
		const begin = AudioBufferSourceNode.prototype.start;
		AudioBufferSourceNode.prototype.start = function (...args) {
			if (this.context instanceof AudioContext) globalThis.__metroStarts.push({
				time: args[0] ?? this.context.currentTime, frames: this.buffer?.length,
			});
			return Reflect.apply(begin, this, args);
		};
		const Worklet = AudioWorkletNode;
		globalThis.AudioWorkletNode = new Proxy(Worklet, { construct(target, args) {
			const node = Reflect.construct(target, args);
			if (args[1] === 'kw-audio-chunk-stream') {
				const post = node.port.postMessage;
				node.port.postMessage = function (value, ...rest) {
					if (value.type === 'play-stream') globalThis.__metroStarts.push({
						time: value.contextStartFrame / node.context.sampleRate, stream: true,
					});
					return Reflect.apply(post, this, [value, ...rest]);
				};
			}
			return node;
		} });
		const start = OscillatorNode.prototype.start;
		OscillatorNode.prototype.start = function (...args) {
			const click = { time: args[0] ?? this.context.currentTime, peak: 0 };
			globalThis.__metroClicks.push(click);
			const analyser = this.context.createAnalyser(), silence = this.context.createGain();
			silence.gain.value = 0;
			this.connect(analyser); analyser.connect(silence); silence.connect(this.context.destination);
			const samples = new Float32Array(analyser.fftSize);
			let reads = 0;
			const read = () => {
				analyser.getFloatTimeDomainData(samples);
				click.peak = Math.max(click.peak, ...samples.map(sample => Math.abs(sample)));
				if (++reads < 60 && click.peak < .01) requestAnimationFrame(read);
				else { analyser.disconnect(); silence.disconnect(); }
			};
			requestAnimationFrame(read);
			return Reflect.apply(start, this, args);
		};
	});
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 144_000, channelCount: 1 });
	const cutStart = 22_800;
	const cutEnd = mode === 'long-gap' ? 46_800 : mode === 'phase-gap' ? 39_600 : 25_200;
	const project = createSoundscaperProject({ id: `cut-metronome-${mode}`, sampleRate: 48_000, sources: [source],
		tempo: { bpm: 120, timeSignature: { numerator: 4, denominator: 4 } },
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 144_000, sourceDurationFrames: 144_000 })],
		tracks: [createAudioTrack({ id: 'track', name: 'Programme', clipIds: ['clip'] })],
		selection: { startFrame: cutStart, endFrame: cutEnd, trackIds: ['track'], clipIds: [] },
	});
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	let blob;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		for (let offset = 0; offset < source.frameCount; offset += source.chunkFrames) await writer.write([
			Float32Array.from({ length: Math.min(source.chunkFrames, source.frameCount - offset) }, (_, frame) =>
				.01 * Math.sin(2 * Math.PI * 512 * (offset + frame) / 48_000)),
		]);
		await writer.commit(); blob = (await exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Click programme.sscape', mimeType: 'application/zip',
		buffer: Buffer.from(await blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	await editor.getByRole('button', { name: 'Customize toolbar', exact: true }).click();
	await page.getByRole('dialog', { name: 'Customize toolbar', exact: true }).getByRole('checkbox', { name: 'Metronome', exact: true }).click();
	await page.keyboard.press('Escape');
	await editor.getByRole('button', { name: 'Metronome', exact: true }).click();
	if (mode === 'normal') await editor.getByRole('button', { name: 'Play', exact: true }).click();
	else {
		await editor.getByRole('button', { name: 'Play options', exact: true }).click();
		await page.getByRole('menu', { name: 'Play options', exact: true }).getByRole('menuitem', { name: 'Cut preview', exact: true }).click();
	}
	await expect.poll(() => page.evaluate(() => {
		const start = globalThis.__metroStarts[0]?.time;
		return start === undefined ? 0 : globalThis.__metroClicks.filter(click => click.peak > .01 && click.time - start >= .475).length;
	})).toBeGreaterThanOrEqual(2);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	const data = await page.evaluate(() => ({ clicks: globalThis.__metroClicks, starts: globalThis.__metroStarts }));
	const start = data.starts[0]; expect(start).toBeTruthy();
	const times = data.clicks.filter(click => click.peak > .01).map(click => click.time - start.time);
	const sourceTimes = times.map(time => mode === 'normal' || time < cutStart / 48_000 ? time : time + (cutEnd - cutStart) / 48_000);
	expect(sourceTimes.every(time => Math.abs(time / .5 - Math.round(time / .5)) < .02)).toBe(true);
});
