/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAcxComplianceReport } from '../src/common/editor/acx-compliance.ts';
import { analyzeAudioChannels, createStreamingAudioAnalyzer } from '../src/common/editor/analysis.js';

const passing = { sampleRate: 44_100, channelCount: 1, frameCount: 44_100,
	peakDbfs: -3, rmsDbfs: -20, noiseFloorDbfs: -65 };

test('ACX checks use inclusive published audio limits and distinguish missing measurements', () => {
	assert.equal(createAcxComplianceReport(passing).status, 'pass');
	for (const rmsDbfs of [-23, -18]) assert.equal(createAcxComplianceReport({ ...passing, rmsDbfs }).status, 'pass');
	assert.equal(createAcxComplianceReport({ ...passing, noiseFloorDbfs: -60 }).status, 'pass');
	assert.equal(createAcxComplianceReport({ ...passing, frameCount: 44_100 * 7_200 }).status, 'pass');
	for (const changes of [
		{ peakDbfs: -2.999 }, { rmsDbfs: -23.001 }, { rmsDbfs: -17.999 }, { noiseFloorDbfs: -59.999 },
		{ sampleRate: 48_000 }, { channelCount: 6 }, { frameCount: 44_100 * 7_200 + 1 },
	]) assert.equal(createAcxComplianceReport({ ...passing, ...changes }).status, 'fail');
	const incomplete = createAcxComplianceReport({ ...passing, noiseFloorDbfs: null });
	assert.equal(incomplete.status, 'unmeasured');
	assert.equal(incomplete.checks.find(check => check.id === 'noiseFloor')?.status, 'unmeasured');
	for (const value of [null, {}, { ...passing, frameCount: 0 }, { ...passing, rmsDbfs: Number.NaN }]) {
		assert.notEqual(createAcxComplianceReport(value).status, 'pass');
	}
});

test('noise floor measures the quietest complete 400 ms window across arbitrary PCM chunks', () => {
	const sampleRate = 8_000;
	const signal = Float32Array.from({ length: sampleRate * 2 }, (_, i) => i >= 5_600 && i < 8_800 ? 0.0001 : 0.1);
	const oneShot = analyzeAudioChannels([signal], sampleRate);
	assert.ok(Math.abs(Number(oneShot.noiseFloorDbfs) + 80) < 0.001);
	const streamed = createStreamingAudioAnalyzer({ sampleRate, channelCount: 1 });
	for (let offset = 0; offset < signal.length; offset += 173) streamed.push([signal.subarray(offset, offset + 173)]);
	assert.equal(streamed.finish().noiseFloorDbfs, oneShot.noiseFloorDbfs);
	assert.equal(analyzeAudioChannels([signal.subarray(0, 3_199)], sampleRate).noiseFloorDbfs, null);
});

test('noise floor combines stereo energy without cancellation and includes the final complete window', () => {
	const left = new Float32Array(3_200).fill(0.0001);
	const right = new Float32Array(3_200).fill(-0.0001);
	assert.ok(Math.abs(Number(analyzeAudioChannels([left, right], 8_000).noiseFloorDbfs) + 80) < 0.001);
	const silent = analyzeAudioChannels([new Float32Array(3_200)], 8_000);
	assert.equal(silent.noiseFloorDbfs, -120);
	assert.equal(createAcxComplianceReport(silent).status, 'fail', 'digital silence fails the RMS requirement');
});
