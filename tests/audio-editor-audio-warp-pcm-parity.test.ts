/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	renderExactAudioWarpPcm,
	renderRealtimeAudioWarpPcmProjection,
} from '../src/common/editor/audio-warp-render-parity.ts';

const PROJECT = Object.freeze({
	sampleRate: 48_000,
	tempoMap: {
		mode: 'musical' as const,
		events: [{ id: 'tempo', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }],
	},
});
const CLIP = Object.freeze({
	id: 'pcm-parity', kind: 'audio', anchor: 'sample', timelineStartFrame: 100,
	durationFrames: 2_048, sourceStartFrame: 128, sourceDurationFrames: 3_072,
	warpMap: {
		feature: 'audio-warp' as const,
		points: [
			{ outer: 0, source: 128, mode: 'forward' as const },
			{ outer: 512, source: 768, mode: 'forward' as const },
			{ outer: 1_300, source: 2_048, mode: 'forward' as const },
			{ outer: 2_048, source: 3_200, mode: 'forward' as const },
		],
	},
});
const RANGE = Object.freeze({ startFrame: 100, endFrame: 2_148, sourceSampleRate: 48_000 });

test('piecewise scheduler projection and exact evaluator interpolation agree within budget', () => {
	const source = deterministicSource(4_096);
	const exact = renderExactAudioWarpPcm(PROJECT, CLIP, RANGE, source);
	const realtime = renderRealtimeAudioWarpPcmProjection(PROJECT, CLIP, RANGE, source);
	assert.equal(exact.length, 2);
	assert.equal(exact[0]?.length, 2_048);
	assertPcmParity(exact, realtime);
});

test('fractional breakpoints preserve exact PCM projection across every output frame', () => {
	const clip = {
		...CLIP,
		warpMap: {
			...CLIP.warpMap,
			points: CLIP.warpMap.points.map((point, index) => index === 1
				? { ...point, outer: { num: 1_025, den: 2 } }
				: point),
		},
	};
	const source = deterministicSource(4_096);
	const exact = renderExactAudioWarpPcm(PROJECT, clip, RANGE, source);
	const realtime = renderRealtimeAudioWarpPcmProjection(PROJECT, clip, RANGE, source);
	assert.equal(exact[0]?.length, RANGE.endFrame - RANGE.startFrame);
	assertPcmParity(exact, realtime);
});

function deterministicSource(frameCount: number): readonly Float32Array[] {
	const left = new Float32Array(frameCount);
	const right = new Float32Array(frameCount);
	for (let frame = 0; frame < frameCount; frame += 1) {
		left[frame] = Math.sin(frame * 0.013) * 0.7 + ((frame % 509) === 0 ? 0.2 : 0);
		right[frame] = Math.cos(frame * 0.019) * 0.5 - ((frame % 307) === 0 ? 0.15 : 0);
	}
	return Object.freeze([left, right]);
}

function assertPcmParity(exact: readonly Float32Array[], realtime: readonly Float32Array[]): void {
	assert.equal(realtime.length, exact.length);
	for (let channel = 0; channel < exact.length; channel += 1) {
		assert.equal(realtime[channel]!.length, exact[channel]!.length);
		for (let frame = 0; frame < exact[channel]!.length; frame += 1) {
			assert.ok(Math.abs(exact[channel]![frame]! - realtime[channel]![frame]!) <= 0.000_001,
				`channel ${String(channel)} frame ${String(frame)}`);
		}
	}
}
