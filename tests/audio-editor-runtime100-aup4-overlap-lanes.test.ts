/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { assignAup4OverlapLanes } from '../src/common/editor/aup4-export-overlap-lanes.ts';
import { legacyOverlapLanes } from './helpers/runtime100-aup4-overlap-legacy.ts';
import { createAup4ExportPlan } from '../src/common/editor/aup4-export.js';

function fixture(count = 160) {
	const clips = Array.from({ length: count }, (_, index) => ({ id: `clip-${String(index).padStart(3, '0')}`, sourceId: 'source', timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 100, durationFrames: 100, trimStartFrames: 0, trimEndFrames: 0, envelope: [] })).reverse();
	return { id: 'overlap-project', title: 'Overlap partition', sampleRate: 48000, selection: { startFrame: 0, endFrame: 0, trackIds: [] }, metadata: {}, master: { effects: [] }, sources: [{ id: 'source', name: 'Source', storageKey: 'source', sampleRate: 48000, originalSampleRate: 48000, channelCount: 1, frameCount: 100, sampleFormat: 'float32', mimeType: 'audio/wav' }], clips, tracks: [{ id: 'track', type: 'audio', name: 'Track', clipIds: clips.map(clip => clip.id), effects: [], envelope: [] }] };
}

test('R06 AUP4 public export partitions dense overlaps without scanning every prior lane', context => {
	const project = fixture(), before = JSON.stringify(project);
	const original = Array.prototype.findIndex;
	let probes = 0;
	Array.prototype.findIndex = function (predicate, thisArg) {
		return Reflect.apply(original, this, [(value: unknown, index: number, values: unknown[]) => {
			if (typeof value === 'number') probes++;
			return Reflect.apply(predicate, thisArg, [value, index, values]) as unknown;
		}]) as number;
	};
	let plan: ReturnType<typeof createAup4ExportPlan>;
	try { plan = createAup4ExportPlan(project); } finally { Array.prototype.findIndex = original; }
	const digest = createHash('sha256').update(JSON.stringify(plan)).digest('hex');
	context.diagnostic(`R06 lane findIndex probes: ${probes}; exact plan JSON digest: ${digest}`);
	assert.equal(digest, 'e4d1629646a8d61518f9f530789cc2de6fa720c59fcc64c27f68c36b1170576b');
	assert.equal(plan.project.tracks.length, 160);
	assert.equal(JSON.stringify(project), before);
	assert.ok(probes < 3000, `dense lane scans: ${probes}`);
});

interface InputClip { readonly id: unknown; readonly timelineStartFrame: unknown; readonly durationFrames: unknown }
function linearOracle(clips: readonly InputClip[]): unknown[][] {
	const lanes: unknown[][] = [], ends: number[] = [];
	const frame = (value: unknown, label: string, positive: boolean) => {
		const number = Number(value);
		if (!Number.isSafeInteger(number) || (positive ? number <= 0 : number < 0)) {
			const error = new Error(`${label} is invalid.`) as Error & { code: string };
			error.name = 'Aup4ExportError'; error.code = 'INVALID_SNAPSHOT'; throw error;
		}
		return number;
	};
	for (const clip of clips.slice().sort((a, b) => {
		const delta = Number(a.timelineStartFrame) - Number(b.timelineStartFrame);
		if (delta) return delta;
		const left = String(a.id), right = String(b.id);
		return left < right ? -1 : left > right ? 1 : 0;
	})) {
		const start = frame(clip.timelineStartFrame, `clip ${clip.id as string} timelineStartFrame`, false);
		const end = start + frame(clip.durationFrames, `clip ${clip.id as string} durationFrames`, true);
		let lane = ends.findIndex(previous => previous <= start);
		if (lane === -1) { lane = lanes.length; lanes.push([]); ends.push(0); }
		lanes[lane]!.push(clip.id); ends[lane] = end;
	}
	return lanes.length ? lanes : [[]];
}
function capture(run: () => unknown): unknown {
	try { return { result: run() }; }
	catch (failure) {
		assert.ok(failure instanceof Error);
		return { error: failure.name, message: failure.message, code: (failure as Error & { code?: string }).code };
	}
}

test('overlap lane choice matches an independent first-fit oracle over ties, reuse and invalid frames', () => {
	let seed = 0x19af10;
	const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
	for (let trial = 0; trial < 150; trial++) {
		const clips = Array.from({ length: 100 + random() % 200 }, (_, index) => ({ id: `clip-${index % 63}`, timelineStartFrame: trial % 3 ? random() % 30 : random() % 300, durationFrames: 1 + random() % 150 }));
		const expected = linearOracle(clips);
		assert.deepEqual(assignAup4OverlapLanes(clips), expected, `trial ${trial}`);
		assert.deepEqual(legacyOverlapLanes(clips), expected, `legacy trial ${trial}`);
	}
	for (const value of [-1, -0, 0, Number.NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER, '12', null, undefined]) {
		for (const field of ['timelineStartFrame', 'durationFrames'] as const) {
			const clips = [...Array.from({ length: 80 }, (_, index) => ({ id: `clip-${String(index).padStart(3, '0')}`, timelineStartFrame: 0, durationFrames: 100 })), { id: 'late-invalid', timelineStartFrame: 0, durationFrames: 100, [field]: value }];
			const expected = capture(() => linearOracle(clips));
			assert.deepEqual(capture(() => assignAup4OverlapLanes(clips)), expected, `${field}: ${String(value)}`);
			assert.deepEqual(capture(() => legacyOverlapLanes(clips)), expected, `legacy ${field}: ${String(value)}`);
		}
	}
	for (const id of [Symbol('clip'), { toString() { throw new Error('identity conversion'); } }]) {
		const clips = [{ id, timelineStartFrame: 0, durationFrames: 1 }];
		const expected = capture(() => linearOracle(clips));
		assert.deepEqual(capture(() => assignAup4OverlapLanes(clips)), expected);
		assert.deepEqual(capture(() => legacyOverlapLanes(clips)), expected);
	}
	assert.deepEqual(assignAup4OverlapLanes([]), [[]]);
});

function median(values: readonly number[]): number { return [...values].sort((a, b) => a - b)[values.length >>> 1]!; }

test('overlap lane partition benchmarks dense, sparse and dense-then-sparse preparation', context => {
	legacyOverlapLanes(fixture().clips);
	const dense = Array.from({ length: 4000 }, (_, index) => ({ id: `c${index}`, timelineStartFrame: 0, durationFrames: 100 }));
	const sparse = Array.from({ length: 30000 }, (_, index) => ({ id: `c${index}`, timelineStartFrame: index * 2, durationFrames: 1 }));
	const tail = sparse.map(clip => ({ ...clip, timelineStartFrame: clip.timelineStartFrame + 1000 }));
	const mixed = [...dense.slice(0, 256), ...tail], wideMixed = [...dense, ...tail];
	for (const [name, clips] of [['dense', dense], ['sparse', sparse], ['dense-then-sparse', mixed], ['wide-dense-then-sparse', wideMixed]] as const) {
		assert.deepEqual(assignAup4OverlapLanes(clips), linearOracle(clips));
		for (let warmup = 0; warmup < 10; warmup++) { assignAup4OverlapLanes(clips); legacyOverlapLanes(clips); }
		const baseline: number[] = [], current: number[] = [];
		for (let trial = 0; trial < 9; trial++) {
			const run = (work: () => unknown, values: number[]) => { const start = performance.now(); for (let repeat = 0; repeat < 5; repeat++) work(); values.push((performance.now() - start) / 5); };
			if (trial % 2) { run(() => assignAup4OverlapLanes(clips), current); run(() => legacyOverlapLanes(clips), baseline); }
			else { run(() => legacyOverlapLanes(clips), baseline); run(() => assignAup4OverlapLanes(clips), current); }
		}
		context.diagnostic(`${name}: linear ${median(baseline).toFixed(3)} ms; adaptive ${median(current).toFixed(3)} ms; raw ${JSON.stringify({ baseline, current })}`);
	}
});

test('heap reuse chooses the lowest free lane ID before the earliest ending lane', () => {
	const clips = [...Array.from({ length: 80 }, (_, index) => ({ id: `clip-${String(index).padStart(3, '0')}`, timelineStartFrame: 0, durationFrames: index === 8 ? 50 : index === 9 ? 10 : 100 })),
		{ id: 'later-a', timelineStartFrame: 75, durationFrames: 100 }, { id: 'later-b', timelineStartFrame: 75, durationFrames: 100 }];
	const lanes = assignAup4OverlapLanes(clips);
	assert.deepEqual(lanes, linearOracle(clips));
	assert.deepEqual(lanes[8], ['clip-008', 'later-a']);
	assert.deepEqual(lanes[9], ['clip-009', 'later-b']);
});

test('overlap admission does not invoke numeric accessors on custom sorted arrays', () => {
	function input() {
		const trace: string[] = [];
		const clips = Array.from({ length: 160 }, (_, index) => ({ id: `clip-${String(index).padStart(3, '0')}`, timelineStartFrame: 0, durationFrames: 100 }));
		Object.defineProperty(clips, 'slice', { value: () => {
			const sorted = [...clips], observed = sorted[63]!;
			Object.defineProperty(sorted, 'sort', { value: () => {
				Object.defineProperty(sorted, '63', { get() { trace.push('numeric entry'); return observed; }, enumerable: true });
				return sorted;
			} });
			return sorted;
		} });
		return { clips, trace };
	}
	const actual = input(), expected = input();
	assert.deepEqual(assignAup4OverlapLanes(actual.clips), linearOracle(expected.clips));
	assert.deepEqual(actual.trace, expected.trace);
});
