/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { multipleAudioOriginFixture } from './fixtures/multiple-audio-origin-fixture.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, collectClientErrors, disableNativeSavePicker, importFiles, chooseExportProjectFileAction, downloadBytes, waitForEditor, waitForProjectActivation } from './audio-editor-test-helpers.js';

for (const variant of ['aligned', 'delayed-default', 'long-primary']) test(`multi-audio import keeps its chosen programme in sync: ${variant}`, async ({ page }, testInfo) => {
	test.setTimeout(60_000); const errors = collectClientErrors(page); await disableNativeSavePicker(page);
	await page.addInitScript(() => {
		window.nativeAudioObservations = [];
		const original = BaseAudioContext.prototype.decodeAudioData;
		BaseAudioContext.prototype.decodeAudioData = function (...args) {
			const encodedBytes = args[0]?.byteLength;
			const pending = original.apply(this, args);
			void pending.then(buffer => {
				// Scalar diagnostics only; never retain decoded buffers or unbounded arrays.
				if (window.nativeAudioObservations.length >= 8 || buffer.length < buffer.sampleRate / 5) return;
				const pcm = buffer.getChannelData(0), start = Math.round(.1 * buffer.sampleRate), end = Math.round(.2 * buffer.sampleRate);
				const amplitudes = [440, 880].map(frequency => {
					let re = 0, im = 0;
					for (let frame = start; frame < end; frame++) {
						const phase = 2 * Math.PI * frequency * frame / buffer.sampleRate;
						re += pcm[frame] * Math.cos(phase); im += pcm[frame] * Math.sin(phase);
					}
					return Math.hypot(re, im) / (end - start);
				});
				window.nativeAudioObservations.push({ encodedBytes, frames: buffer.length, channels: buffer.numberOfChannels, rate: buffer.sampleRate, amplitudes });
			}).catch(() => {});
			return pending;
		};
	});
	const editor = await bootEditor(page, '/embed/en/'), original = multipleAudioOriginFixture(variant);
	await importFiles(editor, [{ name: 'Multiple.mp4', mimeType: 'video/mp4', buffer: original }]);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const saving = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await saving)), project = JSON.parse(strFromU8(entries['project.json']));
	const audio = project.sources.find(source => source.kind === 'audio'), video = project.sources.find(source => source.kind === 'video');
	expect(audio).toMatchObject({ channelCount: 1, sampleRate: 48_000 });
	expect(video).toMatchObject({ width: 64, height: 32, sourceFrameCount: 75 });
	const savedOriginal = Buffer.from(entries[`media/${video.id}/original`]);
	expect(savedOriginal.length).toBe(original.length); expect(savedOriginal.equals(original)).toBe(true);
	const pcm = Buffer.from(entries[`audio/${audio.id}.f32c`]);
	const sample = frame => pcm.readFloatLE(frame * 4 + 4 * (Math.floor(frame / audio.chunkFrames) + 1));
	const spectrum = (frequency, start = .8) => {
		let re = 0, im = 0;
		for (let frame = start * 48_000; frame < (start + .1) * 48_000; frame++) {
			const phase = 2 * Math.PI * frequency * frame / 48_000;
			re += sample(frame) * Math.cos(phase); im += sample(frame) * Math.sin(phase);
		}
		return Math.hypot(re, im) / 4800;
	};
	const amplitudes = [spectrum(440), spectrum(880)], first = amplitudes[0] > amplitudes[1];
	let energy = 0; for (let frame = 4800; frame < 9600; frame++) energy += sample(frame) ** 2;
	const leadingRms = Math.sqrt(energy / 4800), native = await page.evaluate(() => window.nativeAudioObservations);
	await testInfo.attach('programme-observation.json', { body: JSON.stringify({ variant, native, amplitudes, first, leadingRms, frameCount: audio.frameCount }), contentType: 'application/json' });
	expect(amplitudes[first ? 0 : 1]).toBeGreaterThan(.04);
	expect(amplitudes[first ? 1 : 0]).toBeLessThan(.005);
	if (first) {
		expect(leadingRms).toBeGreaterThan(.05); expect(audio.frameCount).toBe(144_000);
	} else {
		if (variant === 'aligned') expect(leadingRms).toBeGreaterThan(.05);
		else expect(leadingRms).toBeLessThan(1e-6);
		if (variant === 'long-primary') {
			expect(audio.frameCount).toBeGreaterThan(144_000); expect(audio.frameCount).toBeLessThanOrEqual(264_000);
			expect(spectrum(880, 4)).toBeGreaterThan(.04);
		} else expect(audio.frameCount).toBe(144_000);
	}
	await page.reload(); await waitForEditor(page); await waitForProjectActivation(editor);
	await expect(editor).toHaveAttribute('data-clip-count', '2'); expect(errors).toEqual([]);
});
