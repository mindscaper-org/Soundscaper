/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	createPackagedRuntimeAudioWave,
	packagedRuntimeAudioArguments,
} from './browser/helpers/packaged-runtime-audio-fixture.js';

test('packaged audio fixture supplies a deterministic non-silent PCM microphone', () => {
	const wave = createPackagedRuntimeAudioWave();

	assert.equal(wave.length, 96_044);
	assert.equal(createHash('sha256').update(wave).digest('hex'), '72f5cc120696e11ed82e561b972b9b1549fc9700cb2c7815e279b895219ab2f6');
	assert.equal(wave.toString('ascii', 0, 4), 'RIFF');
	assert.equal(wave.toString('ascii', 8, 12), 'WAVE');
	assert.equal(wave.readUInt16LE(20), 1);
	assert.equal(wave.readUInt16LE(22), 1);
	assert.equal(wave.readUInt32LE(24), 48_000);
	assert.equal(wave.readUInt16LE(34), 16);
	assert.equal(wave.toString('ascii', 36, 40), 'data');
	assert.equal(wave.readUInt32LE(40), 96_000);
	assert.ok(wave.subarray(44).some((sample) => sample !== 0));
});

test('long capture fixtures keep continuous 440 Hz PCM throughout the requested duration', () => {
	const wave = createPackagedRuntimeAudioWave({ durationSeconds: 180 });
	const sampleRate = wave.readUInt32LE(24);
	const frameCount = wave.readUInt32LE(40) / 2;
	assert.equal(sampleRate, 48_000);
	assert.equal(frameCount, sampleRate * 180);
	assert.equal(wave.length, 44 + frameCount * 2);
	assert.equal(wave.readUInt32LE(4), wave.length - 8);
	assert.equal(wave.readUInt16LE(22), 1);
	assert.equal(wave.readUInt16LE(34), 16);
	for (const start of [0, sampleRate - 8, sampleRate * 90, frameCount - sampleRate / 2]) {
		let crossings = 0;
		let energy = 0;
		for (let frame = start; frame < start + sampleRate / 2; frame += 1) {
			const current = wave.readInt16LE(44 + frame * 2);
			const previous = frame === 0 ? 0 : wave.readInt16LE(44 + (frame - 1) * 2);
			if (previous <= 0 && current > 0) crossings += 1;
			energy += (current / 32_767) ** 2;
		}
		assert.equal(crossings * 2, 440, `440 Hz at frame ${start}`);
		assert.ok(Math.abs(Math.sqrt(energy / (sampleRate / 2)) - 0.25 / Math.sqrt(2)) < 0.0001);
	}
});

test('capture fixture durations are bounded and resolve to at least one PCM frame', () => {
	const wave = createPackagedRuntimeAudioWave({ durationSeconds: 0.25 });
	assert.equal(wave.readUInt32LE(40), 24_000);
	assert.equal(wave.length, 24_044);
	for (const durationSeconds of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 181, 1e-8]) {
		assert.throws(() => createPackagedRuntimeAudioWave({ durationSeconds }), /duration/u);
	}
});

test('packaged audio fixture launch arguments require an absolute wave path', () => {
	assert.deepEqual(packagedRuntimeAudioArguments('/tmp/soundscaper-input.wav'), [
		'--use-fake-device-for-media-stream',
		'--use-file-for-fake-audio-capture=/tmp/soundscaper-input.wav',
	]);
	assert.throws(() => packagedRuntimeAudioArguments('relative.wav'), /absolute/u);
});
