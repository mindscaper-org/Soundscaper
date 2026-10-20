/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createControllerResources } from '../src/common/editor/controller/composition/controller-resources.ts';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { parallelStackPlaybackEnabled } from '../src/common/editor/engine/parallel-stack-playback.ts';
import { readParallelStackPreferences, writeParallelStackPreferences } from '../src/common/editor/engine/parallel-stack-preferences.ts';

const callbacks = {
	copy: { staffPadRangeWarning: '{stageCount} stages', ffmpegLoading: 'Loading' },
	onPosition() {}, onMeter() {}, onState() {}, setStatus() {}, updateExportProgress() {},
};

test('parallel processing registers both browser and desktop Soundscaper playback engines only', async () => {
	const preferences = readParallelStackPreferences();
	try {
		writeParallelStackPreferences({ ...preferences, enabled: true });
		for (const [productId, desktop, expected] of [
			['soundscaper', false, true], ['soundscaper', true, true], ['framescaper', false, false],
		] as const) {
			const resources = createControllerResources({
				productId, fileService: createAudioEditorFileService({ bridge: desktop ? {} : null }),
			}, callbacks);
			try {
				assert.equal(parallelStackPlaybackEnabled(resources.engine), expected);
			} finally {
				await resources.clipTimePitchCache.dispose?.();
				await resources.engine.dispose();
				resources.ffmpeg.dispose();
				resources.nyquistClient?.dispose();
				await resources.store.close();
			}
		}
	} finally { writeParallelStackPreferences(preferences); }
});

test('controller resources give workers owned PCM without detaching resident channel views', async () => {
	const samples = Float32Array.of(0.25, -0.5);
	let renders = 0;
	const resources = createControllerResources({ staffPadRenderClient: {
		render(request: { readonly channels: Float32Array[] }, options: { readonly transferInput?: boolean } = {}) {
			renders += 1;
			assert.deepEqual(request.channels[0], samples);
			assert.notEqual(request.channels[0]?.buffer, samples.buffer);
			assert.equal(options.transferInput, true);
			const channels = request.channels.map(channel => channel.slice());
			structuredClone(request.channels, { transfer: request.channels.map(channel => channel.buffer) });
			return Promise.resolve({ channels });
		},
	} }, callbacks);
	try {
		await resources.store.ready();
		resources.sourceBuffers.set('source', {
			length: 2, numberOfChannels: 1, sampleRate: 48_000,
			getChannelData: () => samples,
		});
		await resources.clipTimePitchCache.prepareCommittedOutput(
			{ id: 'clip', sourceId: 'source', durationFrames: 2, pitchCents: 100 },
			{ id: 'source', frameCount: 2, channelCount: 1, sampleRate: 48_000 },
		);
		assert.equal(renders, 1);
		assert.deepEqual([...samples], [0.25, -0.5]);
	} finally {
		await resources.clipTimePitchCache.dispose?.();
		await resources.engine.dispose();
		resources.ffmpeg.dispose();
		resources.nyquistClient?.dispose();
		await resources.store.close();
	}
});

test('injected Nyquist evaluation does not construct a second client', async () => {
	const evaluate = async () => ({ output: 'injected' });
	const resources = createControllerResources({ nyquistEvaluator: evaluate }, callbacks);
	try {
		assert.equal(resources.nyquistClient, null);
		assert.equal(resources.nyquistEvaluator, evaluate);
	} finally {
		await resources.clipTimePitchCache.dispose?.();
		await resources.engine.dispose();
		resources.ffmpeg.dispose();
		await resources.store.close();
	}
});
