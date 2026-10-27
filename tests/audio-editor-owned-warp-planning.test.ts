/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAudioWarpRuntimeSegments } from '../src/common/editor/audio-warp-runtime.ts';
import { createWarpPencilSampleEdits } from '../src/common/editor/sample-pencil-warp-projection.ts';
import { evaluateAudioWarpMap, evaluateAudioWarpMapAtSource } from '../src/common/editor/audio-warp-domain.ts';
import { resolveExportChapters } from '../src/common/editor/export-chapters.ts';
import { buildClipSchedulePlans } from '../src/common/editor/engine/clip-schedule-plan.ts';
import { scheduleClipGain } from '../src/common/editor/engine/clip-gain.ts';

const project = { sampleRate: 48_000, tempoMap: { mode: 'musical' as const, events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] } };
const clip = {
	id: 'warped', sourceId: 'source', kind: 'audio' as const, anchor: 'sample' as const, timelineStartFrame: 0, durationFrames: 128,
	sourceStartFrame: 0, sourceDurationFrames: 256,
	warpMap: { feature: 'audio-warp' as const, points: Array.from({ length: 65 }, (_, index) => ({ outer: index * 2, source: index === 64 ? 256 : index * 4 + index % 2, mode: 'forward' as const })) },
};

test('a complete warp schedule prepares its map a bounded number of times', (context) => {
	const original = Array.prototype.map;
	let pointVisits = 0;
	const restore = () => { Object.defineProperty(Array.prototype, 'map', { value: original, configurable: true, writable: true }); };
	context.after(restore);
	Object.defineProperty(Array.prototype, 'map', { configurable: true, writable: true, value: function (this: unknown[], callback: (value: unknown, index: number, values: unknown[]) => unknown, receiver?: unknown) {
		const first = this[0] as { mode?: unknown; outer?: unknown } | undefined;
		if (first?.mode === 'forward' && first.outer !== undefined) pointVisits += this.length;
		return original.call(this, callback, receiver);
	} });
	const segments = buildAudioWarpRuntimeSegments(project, clip, { startFrame: 1, endFrame: 127, sourceSampleRate: 44_100 });
	assert.equal(segments.length, 64);
	assert.ok(pointVisits <= 65 * 10, `one owned map must serve every segment; received ${pointVisits} point visits`);
	restore();
	for (const segment of segments) {
		assert.deepEqual(segment.sourceStartFrame, evaluateAudioWarpMap(clip.warpMap, segment.timelineStartFrame));
		assert.deepEqual(segment.sourceEndFrame, evaluateAudioWarpMap(clip.warpMap, segment.timelineEndFrame));
	}
});

test('a Pencil stroke prepares one inverse map for all interpolated source samples', (context) => {
	const original = Array.prototype.map;
	let pointVisits = 0;
	const restore = () => { Object.defineProperty(Array.prototype, 'map', { value: original, configurable: true, writable: true }); };
	context.after(restore);
	Object.defineProperty(Array.prototype, 'map', { configurable: true, writable: true, value: function (this: unknown[], callback: (value: unknown, index: number, values: unknown[]) => unknown, receiver?: unknown) {
		const first = this[0] as { mode?: unknown; outer?: unknown } | undefined;
		if (first?.mode === 'forward' && first.outer !== undefined) pointVisits += this.length;
		return original.call(this, callback, receiver);
	} });
	const edits = createWarpPencilSampleEdits(clip, project, 0, [{ timelineFrame: 1, value: -1 }, { timelineFrame: 126, value: 1 }], 1_000)!;
	assert.ok(pointVisits <= 65 * 20, `one owned inverse must serve the stroke; received ${pointVisits} point visits`);
	restore();
	for (const edit of edits.slice(1)) {
		const outer = evaluateAudioWarpMapAtSource(clip.warpMap, edit.frame);
		const amount = Math.max(0, Math.min(1, (outer.num / outer.den - 1) / 125));
		assert.equal(edit.value, -1 + 2 * amount);
	}
});

test('point-only chapter planning does not revisit every point as a possible region', (context) => {
	const original = Array.prototype.entries;
	let regionSearches = 0;
	context.after(() => { Object.defineProperty(Array.prototype, 'entries', { value: original, configurable: true, writable: true }); });
	Object.defineProperty(Array.prototype, 'entries', { configurable: true, writable: true, value: function (this: unknown[]) {
		const first = this[0] as { name?: unknown; startFrame?: unknown; endFrame?: unknown } | undefined;
		if (typeof first?.name === 'string' && first.startFrame !== undefined && first.endFrame !== undefined) regionSearches += 1;
		return original.call(this);
	} });
	const labels = Array.from({ length: 100 }, (_, index) => ({ title: `Chapter ${index}`, startFrame: index * 10, endFrame: index * 10 }));
	const actual = resolveExportChapters({ tracks: [{ type: 'label', labels }] }, { startFrame: 0, endFrame: 1_000 });
	assert.equal(actual.length, 100);
	assert.deepEqual(actual[99], { name: 'Chapter 99', startFrame: 990, endFrame: 1_000, durationFrames: 10 });
	assert.ok(regionSearches <= 2, `point boundaries are classified once; received ${regionSearches} complete searches`);
});

test('all warped segments share one envelope preparation without changing gain automation', (context) => {
	const envelope = Array.from({ length: 65 }, (_, index) => ({ frame: index * 2, value: (index % 5) / 4 }));
	const source = { ...clip, sourceId: 'source', envelope, gain: 0.7, inverted: true };
	const original = Array.prototype.sort;
	let sortedPoints = 0;
	const restore = () => { Object.defineProperty(Array.prototype, 'sort', { value: original, configurable: true, writable: true }); };
	context.after(restore);
	Object.defineProperty(Array.prototype, 'sort', { configurable: true, writable: true, value: function (this: unknown[], compare?: (left: unknown, right: unknown) => number) {
		const first = this[0] as { frame?: unknown; value?: unknown } | undefined;
		if (first?.frame !== undefined && first.value !== undefined) sortedPoints += this.length;
		return original.call(this, compare);
	} });
	const buffer = { length: 256, sampleRate: 48_000, numberOfChannels: 1, getChannelData: () => new Float32Array(256) } as unknown as AudioBuffer;
	const plans = buildClipSchedulePlans({ project: { ...project, clips: [source], tracks: [{ id: 'track', type: 'audio', clipIds: ['warped'] }] },
		sources: new Map([['source', buffer]]), trackInputs: new Map([['track', {} as AudioNode]]), fromFrame: 0, toFrame: 128, sampleRate: 48_000 });
	function schedule(options: object, plan: typeof plans[number]): unknown[] {
		const events: unknown[] = [];
		const param = (name: string) => ({ setValueAtTime(value: number, time: number) { events.push([name, 'set', value, time]); },
			linearRampToValueAtTime(value: number, time: number) { events.push([name, 'linear', value, time]); } }) as unknown as AudioParam;
		scheduleClipGain(param('in'), param('out'), param('clip'), plan.clip, plan.relativeStart, plan.segmentEnd,
			plan.duration, plan.segmentStart / 48_000, 48_000, options);
		return events;
	}
	const actual = plans.map(plan => schedule(plan, plan));
	assert.ok(sortedPoints <= 65, `one owned envelope is shared by ${plans.length} segments; received ${sortedPoints} sorted points`);
	restore();
	assert.deepEqual(actual, plans.map(plan => schedule({ ...plan }, plan)));
});
