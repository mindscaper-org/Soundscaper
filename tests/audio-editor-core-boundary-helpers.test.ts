/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	browserWebCodecsAudioConfiguration,
	browserWebCodecsAudioFullCodecString,
	probeBrowserWebCodecsAudioEncoding,
} from '../src/common/editor/browser-webcodecs-audio-profile.ts';
import { ComplementaryCrossover } from '../src/common/editor/complementary-crossover.ts';
import { safeFfmpegWorkerFsName } from '../src/common/editor/ffmpeg-workerfs-name.ts';
import {
	DEFAULT_FREQUENCY_WAVEFORM_FINEST_BLOCK_SIZE,
	frequencyWaveformFinestBlockSize,
	frequencyWaveformNeedsWindow,
} from '../src/common/editor/frequency-waveform-resolution.ts';

test('WORKERFS names cannot resolve to a parent or current directory', () => {
	assert.equal(safeFfmpegWorkerFsName('.', 'input.wav'), 'input.wav');
	assert.equal(safeFfmpegWorkerFsName('..', 'input.wav'), 'input.wav');
	assert.equal(safeFfmpegWorkerFsName('../take\\one.wav', 'input.wav'), '..-take-one.wav');
});

test('frequency resolution uses the default until analysis supplies the finest block size', () => {
	assert.equal(frequencyWaveformFinestBlockSize(undefined), DEFAULT_FREQUENCY_WAVEFORM_FINEST_BLOCK_SIZE);
	assert.equal(frequencyWaveformFinestBlockSize(null), DEFAULT_FREQUENCY_WAVEFORM_FINEST_BLOCK_SIZE);
	assert.equal(frequencyWaveformFinestBlockSize({ levels: [{ blockSize: 512 }] }), 512);
	assert.equal(frequencyWaveformNeedsWindow(511.5, { levels: [{ blockSize: 512 }] }), true);
	assert.equal(frequencyWaveformNeedsWindow(512, { levels: [{ blockSize: 512 }] }), false);
	assert.equal(frequencyWaveformNeedsWindow(1_024, { levels: [{ blockSize: 512 }] }), false);
});

test('reset clears crossover history at the latest configured frequency', () => {
	const crossover = new ComplementaryCrossover(48_000, 1, 1_000);
	crossover.configure(5_000);
	for (let index = 0; index < 500; index += 1) {
		crossover.tick();
		crossover.low(index % 2, 0);
	}
	crossover.reset();
	const fresh = new ComplementaryCrossover(48_000, 1, 5_000);
	for (const input of [1, 0, -1, 0.5]) {
		assert.equal(crossover.low(input, 0), fresh.low(input, 0));
	}
});

test('WebCodecs audio profiles preserve their exact codec-specific configuration', () => {
	const geometry = { sampleRate: 48_000, channelCount: 2, bitrate: 192_000 };
	assert.deepEqual(browserWebCodecsAudioConfiguration('aac', geometry), {
		codec: 'mp4a.40.2', sampleRate: 48_000, numberOfChannels: 2, bitrate: 192_000,
		aac: { format: 'aac' },
	});
	assert.deepEqual(browserWebCodecsAudioConfiguration('opus', geometry), {
		codec: 'opus', sampleRate: 48_000, numberOfChannels: 2, bitrate: 192_000,
	});
	assert.equal(browserWebCodecsAudioFullCodecString('opus'), 'opus');
});

test('WebCodecs audio probing contains missing, rejected, and throwing capability probes', async () => {
	const geometry = { sampleRate: 48_000, channelCount: 2, bitrate: 192_000 };
	assert.equal(await probeBrowserWebCodecsAudioEncoding('aac', geometry, undefined), false);
	assert.equal(await probeBrowserWebCodecsAudioEncoding('aac', geometry, {
		isConfigSupported: async () => ({ supported: false }),
	}), false);
	assert.equal(await probeBrowserWebCodecsAudioEncoding('aac', geometry, {
		isConfigSupported: async () => { throw new Error('probe failed'); },
	}), false);
	assert.equal(await probeBrowserWebCodecsAudioEncoding('opus', geometry, {
		isConfigSupported: async () => ({ supported: true }),
	}), true);
});
