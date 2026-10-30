/* SPDX-License-Identifier: AGPL-3.0-only */

// Run explicitly: node --import tsx scripts/benchmark-editor-projections.mjs
// Exploratory wall-clock measurements stay outside the deterministic Node gate.
import assert from 'node:assert/strict';
import { recordingPreviewWaveformWindow } from '../src/common/editor/ui/timeline/preview.ts';
import { assignAup4OverlapLanes } from '../src/common/editor/aup4-export-overlap-lanes.ts';
import { legacyOverlapLanes } from '../tests/helpers/runtime100-aup4-overlap-legacy.ts';

function median(values) {
	return [...values].sort((left, right) => left - right)[values.length >>> 1];
}

function measurePair(baseline, current, warmups, repetitions) {
	for (let warmup = 0; warmup < warmups; warmup++) { baseline(); current(); }
	const baselineTimes = [], currentTimes = [];
	const run = (work, times) => {
		const start = performance.now();
		for (let repeat = 0; repeat < repetitions; repeat++) work();
		times.push((performance.now() - start) / repetitions);
	};
	for (let trial = 0; trial < 9; trial++) {
		if (trial % 2) { run(current, currentTimes); run(baseline, baselineTimes); }
		else { run(baseline, baselineTimes); run(current, currentTimes); }
	}
	return { baselineMilliseconds: median(baselineTimes), currentMilliseconds: median(currentTimes), baselineTimes, currentTimes };
}

function legacyWindow(channel, clip) {
	const pairCount = Math.max(1, Math.floor(channel.length / 2));
	const startPair = Math.max(0, Math.min(pairCount - 1, Math.floor(clip.waveformStartFrame / clip.durationFrames * pairCount)));
	const endPair = Math.max(startPair + 1, Math.min(pairCount, Math.ceil(clip.waveformEndFrame / clip.durationFrames * pairCount)));
	return Array.from(channel.slice(startPair * 2, endPair * 2));
}

const clip = { durationFrames: 8192, waveformStartFrame: 0, waveformEndFrame: 8192 };
for (const length of [64, 4096]) {
	const channel = Float32Array.from({ length }, (_, index) => index / length);
	assert.deepEqual(recordingPreviewWaveformWindow(channel, clip), legacyWindow(channel, clip));
	console.log(JSON.stringify({ workload: 'recording-peaks', length,
		...measurePair(() => legacyWindow(channel, clip), () => recordingPreviewWaveformWindow(channel, clip), 20, 200) }));
}

const dense = Array.from({ length: 4000 }, (_, index) => ({ id: `c${index}`, timelineStartFrame: 0, durationFrames: 100 }));
const sparse = Array.from({ length: 30000 }, (_, index) => ({ id: `c${index}`, timelineStartFrame: index * 2, durationFrames: 1 }));
const tail = sparse.map(value => ({ ...value, timelineStartFrame: value.timelineStartFrame + 1000 }));
for (const [workload, clips] of [
	['dense', dense], ['sparse', sparse], ['dense-then-sparse', [...dense.slice(0, 256), ...tail]],
	['wide-dense-then-sparse', [...dense, ...tail]],
]) {
	assert.deepEqual(assignAup4OverlapLanes(clips), legacyOverlapLanes(clips));
	console.log(JSON.stringify({ workload,
		...measurePair(() => legacyOverlapLanes(clips), () => assignAup4OverlapLanes(clips), 10, 5) }));
}
