/* SPDX-License-Identifier: GPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareWaveformGpuGeometry } from '../src/common/editor/controller/source/internal/waveform-gpu-geometry.ts';

test('GPU instances share physical column boundaries and retain quiet one-pixel spans', () => {
	const plan = { channels: [{ minimum: Float32Array.of(0), maximum: Float32Array.of(0), rms: null }] };
	const geometry = prepareWaveformGpuGeometry(plan, { channel: 0, width: 3, centerY: 10, maxAmplitude: 8,
		pixelRatioX: 1.5, pixelRatioY: 2, channelTop: 0, channelHeight: 20, showRms: false });
	assert.deepEqual(Array.from(geometry), [
		0, 2, 20, 22, 0, 0, 0,
		2, 3, 20, 22, 0, 0, 1,
		3, 5, 20, 22, 0, 0, 2,
	]);
});

test('GPU geometry preserves clipped extrema, RMS, half-wave and envelope gain', () => {
	const plan = { channels: [{ minimum: Float32Array.of(-0.25), maximum: Float32Array.of(0.75), rms: Float32Array.of(0.5) }] };
	const geometry = prepareWaveformGpuGeometry(plan, { channel: 0, width: 1, centerY: 10, maxAmplitude: 8,
		pixelRatioX: 1, pixelRatioY: 1, channelTop: 0, channelHeight: 20, showRms: true, envelopeGain: () => 2 });
	assert.deepEqual(Array.from(geometry), [0, 1, 0, 14, 2, 14, 0]);
	const half = prepareWaveformGpuGeometry(plan, { channel: 0, width: 1, centerY: 10, maxAmplitude: 8,
		pixelRatioX: 1, pixelRatioY: 1, channelTop: 0, channelHeight: 20, showRms: true, halfWave: true });
	assert.deepEqual(Array.from(half), [0, 1, 4, 10, 6, 10, 0]);
});

test('hidden RMS is never read while preparing GPU geometry', () => {
	const channel = { minimum: Float32Array.of(-1), maximum: Float32Array.of(1), get rms(): null { return assert.fail('hidden RMS read'); } };
	assert.equal(prepareWaveformGpuGeometry({ channels: [channel] }, { channel: 0, width: 4, centerY: 10, maxAmplitude: 8,
		pixelRatioX: 1, pixelRatioY: 1, channelTop: 0, channelHeight: 20, showRms: false }).length, 28);
});
