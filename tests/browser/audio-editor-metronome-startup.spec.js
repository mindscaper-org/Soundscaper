/* SPDX-License-Identifier: AGPL-3.0-only */
import { installLiveOutputObserver } from './helpers/live-output-observer.js';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

// Permit the test-only blob worklet without changing the shipped script policy.
test.use({ browserCoverage: false, bypassCSP: true });

async function observeActualClicks(page) {
	await installLiveOutputObserver(page, '__metronomeMaster', { observeMaster: false });
	await page.addInitScript(() => {
		globalThis.__selectionMetronome = { starts: [], clicks: [], context: null, contexts: [] };
		const NativeContext = AudioContext;
		globalThis.AudioContext = new Proxy(NativeContext, { construct(target, args) {
			const context = Reflect.construct(target, args);
			globalThis.__selectionMetronome.contexts.push(context);
			return context;
		} });
		const begin = AudioBufferSourceNode.prototype.start;
		AudioBufferSourceNode.prototype.start = function (...args) {
			if (this.context instanceof NativeContext && this.buffer?.length >= 48_000) {
				globalThis.__selectionMetronome.context = this.context;
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
					if (value.type === 'play-stream') {
						globalThis.__selectionMetronome.context = node.context;
						globalThis.__selectionMetronome.starts.push(value.contextStartFrame / node.context.sampleRate);
					}
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
			const stop = globalThis.__observeLiveOutput(gain, sample => {
				click.peak = Math.max(click.peak, sample.peak);
				if (sample.time > click.time + .3) { click.finished = true; stop(); }
			});
			return Reflect.apply(start, this, args);
		};
	});
}

for (const { name, lookahead, rate } of [
	{ name: 'dry selection', lookahead: 0, rate: 1 },
	{ name: 'latency-compensated selection', lookahead: 100, rate: 1 },
	{ name: 'double-speed playback', lookahead: 0, rate: 2 },
]) test(`metronome starts on the original frame-zero downbeat during ${name}`, async ({ page }) => {
	await observeActualClicks(page);
	const source = createAudioSource({ id: 'silence', sampleRate: 48_000, frameCount: 96_000, channelCount: 1 });
	const project = createSoundscaperProject({ id: `initial-metronome-${lookahead}-${rate}`, sampleRate: 48_000, sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: source.frameCount, sourceDurationFrames: source.frameCount })],
		tracks: [createAudioTrack({ id: 'track', name: 'Silent bed', clipIds: ['clip'],
			effects: lookahead ? [{ id: 'compressor', type: 'audacity-compressor', enabled: true, params: { lookaheadMs: lookahead } }] : [] })],
		selection: { startFrame: 0, endFrame: 19_200, trackIds: ['track'], clipIds: [] } });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	let blob;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		for (let offset = 0; offset < source.frameCount; offset += source.chunkFrames) {
			await writer.write([new Float32Array(Math.min(source.chunkFrames, source.frameCount - offset))]);
		}
		await writer.commit();
		blob = (await exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Metronome.sscape', mimeType: 'application/zip', buffer: Buffer.from(await blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	await page.evaluate(() => Promise.all(globalThis.__selectionMetronome.contexts
		.filter(context => context.state !== 'closed').map(context => globalThis.__prepareLiveOutputObservation(context))));
	await editor.getByRole('button', { name: 'Customize toolbar', exact: true }).click();
	await page.getByRole('dialog', { name: 'Customize toolbar', exact: true }).getByRole('checkbox', { name: 'Metronome', exact: true }).click();
	await page.keyboard.press('Escape'); await editor.getByRole('button', { name: 'Metronome', exact: true }).click();
	if (rate !== 1) {
		await editor.getByRole('button', { name: 'Play options', exact: true }).click();
		const slider = page.getByRole('menu', { name: 'Play options', exact: true }).getByRole('slider', { name: 'Playback speed', exact: true });
		await expect(slider).toHaveValue('1');
		await slider.focus();
		for (let step = 0; step < 100; step++) await page.keyboard.press('ArrowRight');
		await expect(slider).toHaveValue(String(rate));
		await page.keyboard.press('Escape');
		await editor.getByRole('button', { name: 'Play at speed', exact: true }).click();
	} else {
		await editor.getByRole('button', { name: 'Play options', exact: true }).click();
		await page.getByRole('menu', { name: 'Play options', exact: true }).getByRole('menuitem', { name: /^Play selection(?:\s|$)/u }).click();
	}
	await expect.poll(() => page.evaluate(() => globalThis.__selectionMetronome.starts.length)).toBeGreaterThan(0);
	await expect.poll(() => page.evaluate(() => {
		const observation = globalThis.__selectionMetronome;
		return observation.context.currentTime - observation.starts[0];
	})).toBeGreaterThan(1.1);
	if (rate !== 1) await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	await expect(editor.getByRole('button', { name: rate === 1 ? 'Play' : 'Play at speed', exact: true })).toBeVisible();
	const { starts, clicks } = await page.evaluate(() => ({ starts: globalThis.__selectionMetronome.starts, clicks: globalThis.__selectionMetronome.clicks }));
	const initial = clicks.find(click => Math.abs(click.time - starts[0] - lookahead / 1000) < 1 / 48_000);
	expect(initial, 'the audio-clock frame-zero pulse must be queued before it becomes late').toBeDefined();
	expect(initial.peak, 'the real post-envelope click must be audible').toBeGreaterThan(.01);
});
