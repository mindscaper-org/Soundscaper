/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { resetProductionMeterSessionV21, sampleProductionMeterSessionV21 } from '../src/common/editor/engine/production-meter-runtime-session-v21.ts';

function reading(sequence: number) {
	return { peak: .25, rms: .1, dbfs: -12, loudness: {
		standard: 'ebu-r128', momentaryLufs: -20, shortTermLufs: -21, integratedLufs: -22,
		maximumMomentaryLufs: -19, maximumShortTermLufs: -20, loudnessRangeLu: 3,
		loudnessRangeStable: false, truePeakDbtp: -11, maximumTruePeakDbtp: -10,
		measuredSeconds: sequence / 10, state: 'running',
	} };
}

test('live production history retires full-capacity readings without shifting retained entries', (context) => {
	const owner = {};
	const project = {};
	for (let sequence = 1; sequence <= 6000; sequence++) sampleProductionMeterSessionV21(owner, project, null, reading(sequence));
	const original = Array.prototype.splice;
	const splice = context.mock.fn(original);
	Array.prototype.splice = splice;
	context.after(() => { Array.prototype.splice = original; });
	const next = sampleProductionMeterSessionV21(owner, project, null, reading(6001)).productionLoudnessHistory;
	assert.ok(next);
	assert.equal(next.history.length, 6000);
	assert.equal(next.history[0]?.sequence, 2);
	assert.equal(next.history.at(-1)?.sequence, 6001);
	assert.equal(splice.mock.callCount(), 0, 'retiring one sample must not shift 5999 retained history references');
});

test('live history retains detached chronological publication through ring wraps and session reset', () => {
	const owner = {};
	const project = {};
	const firstReading = reading(1);
	const first = sampleProductionMeterSessionV21(owner, project, null, firstReading).productionLoudnessHistory;
	assert.ok(first);
	assert.ok(Object.isFrozen(first));
	assert.ok(Object.isFrozen(first.history));
	assert.ok(Object.isFrozen(first.history[0]));
	assert.strictEqual(sampleProductionMeterSessionV21(owner, project, null, firstReading).productionLoudnessHistory, first);
	firstReading.loudness.measuredSeconds = 999;
	assert.equal(first.current.loudness.measuredSeconds, .1, 'the published reading owns its values');
	assert.strictEqual(sampleProductionMeterSessionV21(owner, project, null, { peak: NaN }).productionLoudnessHistory, first);
	for (let sequence = 2; sequence <= 12_003; sequence++) sampleProductionMeterSessionV21(owner, project, null, reading(sequence));
	const wrapped = sampleProductionMeterSessionV21(owner, project, null, null).productionLoudnessHistory;
	assert.ok(wrapped);
	assert.deepEqual(wrapped.history.map(entry => entry.sequence), Array.from({ length: 6000 }, (_, offset) => offset + 6004));
	assert.deepEqual(first.history.map(entry => entry.sequence), [1]);
	assert.equal(first.current.loudness.measuredSeconds, .1);
	resetProductionMeterSessionV21(owner);
	assert.equal(sampleProductionMeterSessionV21(owner, project, null, null).productionLoudnessHistory, undefined);
	assert.deepEqual(sampleProductionMeterSessionV21(owner, project, null, reading(1)).productionLoudnessHistory?.history.map(entry => entry.sequence), [1]);
	assert.equal(sampleProductionMeterSessionV21(owner, {}, null, null).productionLoudnessHistory, undefined);
	assert.equal(wrapped.history[0]?.sequence, 6004, 'reset does not mutate an already published array');
});
