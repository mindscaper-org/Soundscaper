/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, collectClientErrors, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { createEffect } from '../../src/common/editor/effects.js';
import { calculateAudioSpectrum } from '../../src/common/editor/audio-spectrum.ts';

test.use({ browserCoverage: false });

for (const renderOtherTrack of [false, true]) test(`isolated Mix & Render preserves another track's pitched loop, render=${renderOtherTrack}`, async ({ page }, testInfo) => {
	test.setTimeout(60_000);
	await installOutputObserver(page);
	const project = createSoundscaperProject({ id: `isolated-render-${renderOtherTrack}`, sampleRate: 48_000,
		sources: ['tone', 'print'].map(id => createAudioSource({ id, sampleRate: 48_000, frameCount: 96_000, channelCount: 1 })),
		clips: ['tone', 'print'].map(id => createAudioClip({ id: `clip-${id}`, sourceId: id,
			sourceDurationFrames: 96_000, durationFrames: 96_000, pitchCents: id === 'tone' ? 1200 : 0 })),
		tracks: ['tone', 'print'].map(id => createAudioTrack({ id: `track-${id}`, name: id, clipIds: [`clip-${id}`],
			effects: id === 'print' ? [createEffect('highpass')] : [] })),
		loop: { enabled: true, startFrame: 0, endFrame: 96_000 },
	});
	const blob = await projectFile(project);
	const editor = await bootEditor(page, '/embed/en/'), errors = collectClientErrors(page);
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Loop.sscape', mimeType: 'application/zip', buffer: Buffer.from(await blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	const selected = editor.locator('[data-track-id="track-print"] [data-clip-id="clip-print"]').first();
	await selected.click(); await selected.press('Enter');
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(async () => Math.abs((await outputPeak(page))?.frequency - 1000), { timeout: 30_000 }).toBeLessThan(15);
	const initial = await page.evaluate(() => ({ rate: window.__cacheOutput.context.sampleRate, starts: window.__cacheStarts }));
	expect(initial.rate).toBe(48_000);
	expect(initial.starts.some(start => Math.abs(start.frequency - 1000) < 15 && start.rate === 1)).toBe(true);
	let dialog;
	try {
		if (renderOtherTrack) {
			await chooseNestedCommandAction(page, editor, 'Tracks', ['Mix & Render']);
			dialog = page.getByRole('dialog', { name: 'Mix & Render', exact: true });
			await page.evaluate(() => { window.__holdCacheRender = true; });
			await dialog.getByRole('button', { name: 'Mix & Render', exact: true }).click();
			// The real native render completes; only its promise settlement waits.
			await expect.poll(() => page.evaluate(() => Boolean(window.__releaseCacheRender))).toBe(true);
			await expect(dialog.locator('form')).toHaveAttribute('aria-busy', 'true');
		}
		const before = await page.evaluate(() => window.__cacheStarts.length);
		await expect.poll(() => page.evaluate(() => window.__cacheStarts.length), { timeout: 10_000 }).toBeGreaterThan(before + 2);
		const peak = await outputPeak(page), starts = await page.evaluate(() => window.__cacheStarts);
		await testInfo.attach('live-pitched-loop.json', { body: JSON.stringify({ renderOtherTrack, initial, peak, starts }), contentType: 'application/json' });
		expect(Math.abs(peak.frequency - 1000)).toBeLessThan(15);
	} finally {
		await page.evaluate(() => { window.__holdCacheRender = false; window.__releaseCacheRender?.(); });
	}
	if (dialog) {
		await expect(dialog).not.toBeVisible({ timeout: 15_000 });
		await expect(editor).toHaveAttribute('data-clip-count', '2');
		await expect(editor.locator('[data-clip-id="clip-tone"]').first()).toBeVisible();
		await expect.poll(async () => Math.abs((await outputPeak(page))?.frequency - 1000)).toBeLessThan(15);
	}
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	expect(errors).toEqual([]);
});

async function projectFile(project) {
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	try {
		for (const source of project.sources) {
			const writer = await store.beginSourceWrite(source.storageKey, source);
			for (let start = 0; start < source.frameCount; start += source.chunkFrames) {
				await writer.write([Float32Array.from({ length: Math.min(source.chunkFrames, source.frameCount - start) }, (_, frame) =>
					(source.id === 'tone' ? .25 : .0001) * Math.sin(2 * Math.PI * (source.id === 'tone' ? 500 : 100) * (frame + start) / 48_000))]);
			}
			await writer.commit();
		}
		return (await exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
}

async function outputPeak(page) {
	const observed = await page.evaluate(() => {
		const tap = window.__cacheOutput; if (!tap) return null;
		const pcm = new Float32Array(8192); tap.analyser.getFloatTimeDomainData(pcm);
		return { channels: [Array.from(pcm)], sampleRate: tap.context.sampleRate };
	});
	if (!observed) return null;
	return calculateAudioSpectrum(observed.channels.map(channel => Float32Array.from(channel)), observed.sampleRate, { size: 8192, average: false })
		.bins.reduce((best, bin) => bin.amplitude > best.amplitude ? bin : best);
}

async function installOutputObserver(page) {
	await page.addInitScript(() => {
		const connect = AudioNode.prototype.connect, start = AudioBufferSourceNode.prototype.start;
		const render = OfflineAudioContext.prototype.startRendering;
		const taps = new WeakMap();
		window.__cacheStarts = [];
		OfflineAudioContext.prototype.startRendering = function (...args) {
			const pending = Reflect.apply(render, this, args);
			if (!window.__holdCacheRender) return pending;
			return pending.then(buffer => new Promise(resolve => { window.__releaseCacheRender = () => resolve(buffer); }));
		};
		AudioNode.prototype.connect = function (...args) {
			const result = Reflect.apply(connect, this, args);
			if (this.context instanceof AudioContext && args[0] === this.context.destination) {
				let tap = taps.get(this.context);
				if (!tap) {
					const analyser = this.context.createAnalyser(), silent = this.context.createGain();
					analyser.fftSize = 8192; silent.gain.value = 0; tap = { analyser, context: this.context };
					taps.set(this.context, tap);
					Reflect.apply(connect, analyser, [silent]); Reflect.apply(connect, silent, [args[0]]);
				}
				window.__cacheOutput = tap;
				Reflect.apply(connect, this, [tap.analyser]);
			}
			return result;
		};
		AudioBufferSourceNode.prototype.start = function (...args) {
			if (this.context instanceof AudioContext && this.buffer && window.__cacheStarts.length < 64) {
				const pcm = this.buffer.getChannelData(0), from = Math.floor(pcm.length / 3), end = Math.min(pcm.length, from + 8192);
				let crossings = 0; for (let frame = from + 1; frame < end; frame++) if (pcm[frame - 1] < 0 && pcm[frame] >= 0) crossings++;
				window.__cacheStarts.push({ when: args[0], now: this.context.currentTime, frequency: crossings * this.buffer.sampleRate / (end - from), rate: this.playbackRate.value, frames: pcm.length });
			}
			return Reflect.apply(start, this, args);
		};
	});
}
