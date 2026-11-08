/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

async function observeActualClicks(page) {
	await page.addInitScript(() => {
		globalThis.__selectionMetronome = { starts: [], clicks: [], context: null };
		const NativeContext = AudioContext;
		globalThis.AudioContext = new Proxy(NativeContext, { construct(target, args) {
			const context = Reflect.construct(target, args);
			globalThis.__selectionMetronome.context = context;
			return context;
		} });
		const begin = AudioBufferSourceNode.prototype.start;
		AudioBufferSourceNode.prototype.start = function (...args) {
			if (this.context instanceof NativeContext && this.buffer?.length >= 48_000) {
				globalThis.__selectionMetronome.starts.push(args[0] ?? this.context.currentTime);
			}
			return Reflect.apply(begin, this, args);
		};
		const Worklet = AudioWorkletNode;
		globalThis.AudioWorkletNode = new Proxy(Worklet, { construct(target, args) {
			const node = Reflect.construct(target, args);
			if (args[1] === 'kw-audio-chunk-stream') {
				const post = node.port.postMessage;
				node.port.postMessage = function (value, ...rest) {
					if (value.type === 'play-stream') globalThis.__selectionMetronome.starts.push(value.contextStartFrame / node.context.sampleRate);
					return Reflect.apply(post, this, [value, ...rest]);
				};
			}
			return node;
		} });
		const outputs = new WeakMap(), connect = AudioNode.prototype.connect;
		AudioNode.prototype.connect = function (...args) {
			const result = Reflect.apply(connect, this, args);
			if (args[0] instanceof AudioNode) outputs.set(this, [...(outputs.get(this) ?? []), args[0]]);
			return result;
		};
		const start = OscillatorNode.prototype.start;
		OscillatorNode.prototype.start = function (...args) {
			const gain = (outputs.get(this) ?? []).find(node => node instanceof GainNode);
			if (!gain) throw new Error('The metronome observation requires its actual envelope gain.');
			const click = { time: args[0] ?? this.context.currentTime, peak: 0, finished: false };
			globalThis.__selectionMetronome.clicks.push(click);
			const analyser = this.context.createAnalyser(), silence = this.context.createGain();
			silence.gain.value = 0; gain.connect(analyser); analyser.connect(silence); silence.connect(this.context.destination);
			const values = new Float32Array(analyser.fftSize);
			const read = () => {
				analyser.getFloatTimeDomainData(values);
				click.peak = Math.max(click.peak, ...values.map(Math.abs));
				if (this.context.currentTime < click.time + .3) requestAnimationFrame(read);
				else { click.finished = true; analyser.disconnect(); silence.disconnect(); }
			};
			requestAnimationFrame(read);
			return Reflect.apply(start, this, args);
		};
	});
}

for (const end of [.4, .5, .501, .75]) test(`Play selection has no audible metronome signal beyond ${end}s`, async ({ page }) => {
	await observeActualClicks(page);
	const source = createAudioSource({ id: 'silence', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 });
	const project = createSoundscaperProject({ id: `selection-terminal-${end}`, sampleRate: 48_000, sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 48_000, sourceDurationFrames: 48_000 })],
		tracks: [createAudioTrack({ id: 'track', name: 'Silent bed', clipIds: ['clip'] })],
		selection: { startFrame: 0, endFrame: Math.round(end * 48_000), trackIds: ['track'], clipIds: [] } });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	let blob;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([new Float32Array(source.frameCount)]); await writer.commit();
		blob = (await exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Selection.sscape', mimeType: 'application/zip', buffer: Buffer.from(await blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	await editor.getByRole('button', { name: 'Customize toolbar', exact: true }).click();
	await page.getByRole('dialog', { name: 'Customize toolbar', exact: true }).getByRole('checkbox', { name: 'Metronome', exact: true }).click();
	await page.keyboard.press('Escape'); await editor.getByRole('button', { name: 'Metronome', exact: true }).click();
	await editor.getByRole('button', { name: 'Play options', exact: true }).click();
	await page.getByRole('menu', { name: 'Play options', exact: true }).getByRole('menuitem', { name: /^Play selection(?:\s|$)/u }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__selectionMetronome.starts.length)).toBeGreaterThan(0);
	await expect.poll(() => page.evaluate(() => {
		const observation = globalThis.__selectionMetronome;
		return observation.context.currentTime - observation.starts[0];
	})).toBeGreaterThan(end + .35);
	await expect(editor.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
	const { starts, clicks } = await page.evaluate(() => ({ starts: globalThis.__selectionMetronome.starts, clicks: globalThis.__selectionMetronome.clicks }));
	const audible = clicks.filter(click => click.peak > .01);
	if (end === .75) expect(audible.some(click => Math.abs(click.time - starts[0] - .5) < 1 / 48_000)).toBe(true);
	expect(audible.every(click => click.time - starts[0] < end - 1 / 48_000)).toBe(true);
	for (const click of clicks) {
		const retainedSeconds = Math.max(0, end - (click.time - starts[0]));
		// The actual click ramps .0001 to .12 over 2 ms. A larger post-envelope
		// peak than this retained-prefix bound must have sounded after the end.
		const inRangePeakBound = .0001 * (.12 / .0001) ** Math.min(1, retainedSeconds / .002);
		expect(click.peak).toBeLessThanOrEqual(inRangePeakBound + .000001);
	}
});
