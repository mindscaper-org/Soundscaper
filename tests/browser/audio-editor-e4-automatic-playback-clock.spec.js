/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, collectClientErrors, disableNativeSavePicker, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { exportSamples } from './helpers/round2-audio-export.js';

for (const frequency of [1000, 30_000]) test(`automatic playback honors a 96k project with a ${frequency} Hz filter`, async ({ page }) => {
	await observeNativeAudio(page);
	const archive = await projectArchive(96_000, frequency);
	const errors = collectClientErrors(page);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await openProject(editor, archive);
	const offline = await exportSamples(page, editor);
	expect(offline.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0)).toBeGreaterThan(.1);
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect(editor.locator('[data-transport="play"]').getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
	await expect.poll(() => page.evaluate(() => globalThis.__automaticPlaybackPeak())).toBeGreaterThan(.1);
	expect(await page.evaluate(() => globalThis.__automaticPlaybackOutputContext.sampleRate)).toBe(96_000);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	expect(errors).toEqual([]);
});

test('an active microphone meter retains its input clock until it is disabled after project replacement', async ({ page }) => {
	await observeNativeAudio(page);
	await page.addInitScript(() => {
		Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
			enumerateDevices: async () => [{ kind: 'audioinput', deviceId: 'default', groupId: 'input', label: 'Microphone' }],
			async getUserMedia() {
				const context = new AudioContext({ sampleRate: 48_000 });
				const oscillator = context.createOscillator(); oscillator.frequency.value = 500;
				const destination = context.createMediaStreamDestination();
				oscillator.connect(destination); oscillator.start(); await context.resume();
				return destination.stream;
			},
		} });
		const create = AudioContext.prototype.createMediaStreamSource;
		AudioContext.prototype.createMediaStreamSource = function (...args) {
			globalThis.__automaticPlaybackInputContext = this;
			return Reflect.apply(create, this, args);
		};
	});
	const initial = await projectArchive(48_000, 1000), replacement = await projectArchive(96_000, 1000);
	const errors = collectClientErrors(page);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await openProject(editor, initial);
	await chooseCommandAction(page, editor, 'Window', 'Recording meter');
	const meter = editor.locator('[data-workspace-panel="recording-meter"]');
	if (!await meter.count()) await chooseCommandAction(page, editor, 'Window', 'Recording meter');
	await meter.getByRole('button', { name: 'Record level', exact: true }).click();
	await page.getByRole('checkbox', { name: 'Show mic metering when not recording', exact: true }).check();
	await page.keyboard.press('Escape');
	const level = () => meter.locator('.kw-audio-editor__playback-meter-peak').first().evaluate(element =>
		Number.parseFloat(getComputedStyle(element).getPropertyValue('--playback-meter-peak')));
	await expect.poll(level).toBeGreaterThan(50);
	expect(await page.evaluate(() => globalThis.__automaticPlaybackInputContext.sampleRate)).toBe(48_000);
	await openProject(editor, replacement);
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__automaticPlaybackPeak())).toBeGreaterThan(.1);
	expect(await page.evaluate(() => globalThis.__automaticPlaybackInputContext.state)).not.toBe('closed');
	expect(await page.evaluate(() => globalThis.__automaticPlaybackOutputContext.sampleRate)).toBe(48_000);
	await expect.poll(level).toBeGreaterThan(50);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	await meter.getByRole('button', { name: 'Record level', exact: true }).click();
	await page.getByRole('checkbox', { name: 'Show mic metering when not recording', exact: true }).uncheck();
	await page.keyboard.press('Escape');
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__automaticPlaybackOutputContext.sampleRate)).toBe(96_000);
	await expect.poll(() => page.evaluate(() => globalThis.__automaticPlaybackPeak())).toBeGreaterThan(.1);
	expect(await page.evaluate(() => globalThis.__automaticPlaybackInputContext.state)).toBe('closed');
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	expect(errors).toEqual([]);
});

async function observeNativeAudio(page) {
	await page.addInitScript(() => {
		const analysers = [];
		const connect = AudioNode.prototype.connect;
		AudioNode.prototype.connect = function (destination, ...ports) {
			const result = Reflect.apply(connect, this, [destination, ...ports]);
			if (destination === this.context.destination && this.context instanceof AudioContext) {
				const analyser = this.context.createAnalyser(); analyser.fftSize = 2048;
				Reflect.apply(connect, this, [analyser, ...ports]); analysers.push(analyser);
				globalThis.__automaticPlaybackOutputContext = this.context;
			}
			return result;
		};
		globalThis.__automaticPlaybackPeak = () => {
			let peak = 0;
			for (const analyser of analysers) {
				if (analyser.context.state === 'closed') continue;
				const pcm = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(pcm);
				for (const sample of pcm) peak = Math.max(peak, Math.abs(sample));
			}
			return peak;
		};
	});
}

async function projectArchive(sampleRate, frequency) {
	const source = createAudioSource({ id: 'recording', sampleRate, frameCount: sampleRate, channelCount: 2 });
	const project = createSoundscaperProject({ id: `automatic-clock-${sampleRate}-${frequency}`, sampleRate, sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: sampleRate, sourceDurationFrames: sampleRate })],
		loop: { enabled: true, startFrame: 0, endFrame: sampleRate },
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['clip'], effects: [
			{ id: 'filter', type: 'lowpass-filter', params: { frequency, rolloff: 6 } },
		] })] });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		for (let offset = 0; offset < source.frameCount; offset += source.chunkFrames) {
			const pcm = Float32Array.from({ length: Math.min(source.chunkFrames, source.frameCount - offset) },
				(_, frame) => .25 * Math.sin(2 * Math.PI * 500 * (offset + frame) / sampleRate));
			await writer.write([pcm, pcm]);
		}
		await writer.commit();
		const { blob } = await exportScapeProject(project, store);
		return { id: project.id, bytes: Buffer.from(await blob.arrayBuffer()) };
	} finally { await store.close(); }
}

async function openProject(editor, archive) {
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Playback.sscape', mimeType: 'application/zip', buffer: archive.bytes });
	await expect(editor).toHaveAttribute('data-project-id', archive.id);
	await waitForProjectActivation(editor);
}
