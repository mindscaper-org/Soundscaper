/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, waitForProjectActivation, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { installNativeOutputPeer, NATIVE_OUTPUT_PEER_WEBKIT_REASON } from './helpers/native-output-peer.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

for (const edit of [false, true]) test(`Stop survives cold worklet readiness and a stopped mixer edit=${edit}`, async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', NATIVE_OUTPUT_PEER_WEBKIT_REASON);
	await installNativeOutputPeer(page);
	await page.addInitScript(() => {
		window.__stoppedWarmup = { armed: false, entered: [], finished: 0 };
		const Native = AudioContext;
		window.AudioContext = new Proxy(Native, { construct(target, args) {
			const context = Reflect.construct(target, args), add = context.audioWorklet.addModule.bind(context.audioWorklet);
			window.__stoppedWarmup.context = context;
			context.audioWorklet.addModule = async (...values) => {
				const actual = add(...values), state = window.__stoppedWarmup;
				if (state.armed) {
					state.entered.push(String(values[0]));
					await Promise.all([actual, state.gate]);
					state.finished++;
				} else await actual;
			};
			return context;
		} });
	});
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 240_000, channelCount: 1 });
	const project = createSoundscaperProject({ id: `stopped-worklet-${edit}`, sources: [source],
		clips: [createAudioClip({ id: 'clip', title: 'Programme', sourceId: source.id, durationFrames: source.frameCount })],
		tracks: [createAudioTrack({ id: 'track', name: 'Programme', clipIds: ['clip'], effects: [
			{ id: 'tremolo', type: 'tremolo', enabled: true, params: { depth: 40 } },
		] })] });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	let bytes;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		for (let offset = 0; offset < source.frameCount; offset += source.chunkFrames) await writer.write([
			Float32Array.from({ length: Math.min(source.chunkFrames, source.frameCount - offset) }, (_, frame) =>
				.2 * Math.sin(2 * Math.PI * 440 * (offset + frame) / source.sampleRate)),
		]);
		await writer.commit();
		bytes = Buffer.from(await (await exportScapeProject(project, store)).blob.arrayBuffer());
	} finally { await store.close(); }
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Warmup.sscape', mimeType: 'application/zip', buffer: bytes });
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	await editor.getByRole('button', { name: 'Audio setup', exact: true }).click();
	const setup = editor.getByRole('dialog', { name: 'Audio setup', exact: true });
	await setup.getByRole('combobox', { name: 'Host', exact: true }).selectOption('alsa');
	await expect(setup.getByRole('combobox', { name: 'Speakers', exact: true })).toBeEnabled();
	await page.keyboard.press('Escape');
	await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
	await page.evaluate(() => {
		const state = window.__stoppedWarmup;
		state.gate = new Promise(resolve => { state.release = resolve; });
		state.armed = true;
	});
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(() => page.evaluate(() => window.__stoppedWarmup.entered.length)).toBeGreaterThan(0);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	await expect(editor.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
	if (edit) {
		const fader = editor.locator('.kw-audio-editor__mixer-channel--master').getByRole('slider', { name: /volume$/u });
		await expect(fader).toBeEnabled();
		const before = await fader.getAttribute('aria-valuenow');
		await fader.press('ArrowDown'); await expect(fader).not.toHaveAttribute('aria-valuenow', before);
	}
	const fence = await page.evaluate(() => {
		window.__stoppedWarmup.armed = false;
		window.__stoppedWarmup.release();
		return window.__stoppedWarmup.context.currentTime;
	});
	await expect.poll(() => page.evaluate(() => window.__stoppedWarmup.finished)).toBeGreaterThan(0);
	await expect.poll(() => page.evaluate(() => window.__stoppedWarmup.context.currentTime)).toBeGreaterThan(fence + .5);
	const stopped = await page.evaluate(() => ({ rms: window.__nativeOutput.channelRms, loss: window.__nativeOutput.loss }));
	expect(stopped.loss).toEqual([]);
	// No packets is also silence: a canceled start need not connect a source to the native output.
	expect(Math.max(0, ...stopped.rms), 'a stopped fader edit must not revive the retired Play request').toBeLessThan(.00001);
	await expect(editor.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(() => page.evaluate(() => Math.max(0, ...window.__nativeOutput.channelRms))).toBeGreaterThan(.03);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	expect(await page.evaluate(() => window.__nativeOutput.loss)).toEqual([]);
});

for (const canceled of [false, true]) test(`late startup resource failure belongs to its current Play, canceled=${canceled}`, async ({ page }) => {
	let armed = false, release;
	const ready = new Promise(resolve => { release = resolve; }), requests = [];
	await page.route('**/*.wasm*', async route => {
		if (!armed || !route.request().url().includes('pffft')) return route.continue();
		requests.push(route.request().url());
		await ready;
		await route.fulfill({ status: 503, contentType: 'application/wasm', body: 'Temporary failure' });
	});
	await page.addInitScript(() => {
		const outputs = [], connect = AudioNode.prototype.connect;
		AudioNode.prototype.connect = function (destination, ...ports) {
			const result = Reflect.apply(connect, this, [destination, ...ports]);
			if (destination === this.context.destination && this.context instanceof AudioContext) {
				const analyser = this.context.createAnalyser();
				analyser.fftSize = 1024;
				Reflect.apply(connect, this, [analyser, ...ports]);
				outputs.push(analyser);
			}
			return result;
		};
		window.__latePlayPeak = () => {
			let peak = 0;
			for (const analyser of outputs) {
				if (analyser.context.state === 'closed') continue;
				const data = new Float32Array(analyser.fftSize);
				analyser.getFloatTimeDomainData(data);
				for (const sample of data) peak = Math.max(peak, Math.abs(sample));
			}
			return peak;
		};
	});
	const old = await startupFailureProgramme(true), plain = await startupFailureProgramme(false);
	const editor = await bootEditor(page, '/embed/en/');
	try {
		await editor.locator('[data-aup4-input]').setInputFiles(old.file);
		await expect(editor).toHaveAttribute('data-project-id', old.id); await waitForProjectActivation(editor);
		armed = true;
		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		await expect.poll(() => requests.length).toBeGreaterThan(0);
		if (canceled) {
			await editor.getByRole('button', { name: 'Stop', exact: true }).click();
			await editor.locator('[data-aup4-input]').setInputFiles(plain.file);
			await expect(editor).toHaveAttribute('data-project-id', plain.id); await waitForProjectActivation(editor);
			await editor.getByRole('button', { name: 'Play', exact: true }).click();
			await expect.poll(() => page.evaluate(() => window.__latePlayPeak())).toBeGreaterThan(.03);
		}
		armed = false;
		const failure = page.waitForResponse(response => requests.includes(response.url()) && response.status() === 503);
		release(); await (await failure).finished();
		await page.evaluate(() => new Promise(resolve => { requestAnimationFrame(() => { requestAnimationFrame(resolve); }); }));
		if (canceled) {
			await expect(editor.getByRole('alert')).toHaveCount(0);
			await expect.poll(() => page.evaluate(() => window.__latePlayPeak())).toBeGreaterThan(.03);
			await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		} else await expect(editor.getByRole('alert')).toContainText('Could not load PFFFT WASM');
	} finally { release(); }
});

async function startupFailureProgramme(compressor) {
	const id = `late-play-${compressor}`;
	const source = createAudioSource({ id: `source-${id}`, sampleRate: 48_000, frameCount: 240_000, channelCount: 1 });
	const project = createSoundscaperProject({ id, sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: source.frameCount })],
		tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'], effects: compressor ? [
			{ id: 'compressor', type: 'audacity-compressor', enabled: true, params: { lookaheadMs: 100 } },
		] : [] })] });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		for (let offset = 0; offset < source.frameCount; offset += source.chunkFrames) await writer.write([
			Float32Array.from({ length: Math.min(source.chunkFrames, source.frameCount - offset) }, (_, frame) =>
				.2 * Math.sin(2 * Math.PI * 440 * (offset + frame) / source.sampleRate)),
		]);
		await writer.commit();
		return { id, file: { name: 'Late worklet.sscape', mimeType: 'application/zip',
			buffer: Buffer.from(await (await exportScapeProject(project, store)).blob.arrayBuffer()) } };
	} finally { await store.close(); }
}
