/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createTakeCompDialogModel } from '../src/common/editor/ui/take-comp-dialog-model.ts';
import { createLabelViewportIndex } from '../src/common/editor/ui/timeline/label-viewport-model.ts';
import { createTimelineAnnotationViewportIndex } from '../src/common/editor/ui/timeline/timeline-annotation-viewport-index.ts';
import { automationSampleFrames } from '../src/common/editor/ui/timeline/automation-sample-frames.ts';
import type { RuntimeTimelineAnnotationProjection } from '../src/common/editor/runtime-timeline-annotation-projection.ts';

function takeProject() {
	const tracks = Array.from({ length: 40 }, (_, i) => ({ id: `t${i}`, type: 'audio', name: `Track ${i}` }));
	const takeGroups = tracks.map(({ id }, i) => ({ id: `g${i}`, sequenceId: 'main', trackId: id, startSample: 0, endSample: 100,
		laneOrder: Array.from({ length: 20 }, (_, n) => `lane${i}-${n}`), lanes: Array.from({ length: 20 }, (_, n) => ({ id: `lane${i}-${n}` })),
		takes: Array.from({ length: 20 }, (_, n) => ({ id: `take${i}-${n}`, laneId: `lane${i}-${n}`, sourceId: 's', startSample: 0, endSample: 100, sourceStartSample: 0 })), compRegions: [] }));
	return { schemaFamily: 'soundscaper', schemaVersion: 1, tracks, sources: [{ id: 's', kind: 'audio', frameCount: 1000, name: 'Source' }], sequences: [{ id: 'main', trackIds: tracks.map(({ id }) => id) }], takeGroups };
}
void test('U01 take dialog resolves each group track without repeated track searches', t => {
	let visits = 0; const original = Array.prototype.find;
	Array.prototype.find = function(this: unknown[], callback: (item: unknown, i: number, values: unknown[]) => unknown, thisArg?: unknown): unknown {
		const measured = this.length === 40 && typeof this[0] === 'object' && this[0] !== null && 'name' in this[0];
		return original.call(this, (item: unknown, i: number, values: unknown[]) => { if (measured) visits++; return callback.call(thisArg, item, i, values); });
	} as typeof Array.prototype.find;
	try { const model = createTakeCompDialogModel({ productId: 'soundscaper', project: takeProject(), snapshot: {} }); assert.equal(model.groups[39]?.trackName, 'Track 39'); } finally { Array.prototype.find = original; }
	t.diagnostic(`track find visits ${visits}`); assert.equal(visits, 0);
});
void test('U02 take lane presentation groups takes once instead of filtering all takes for every lane', t => {
	let visits = 0; const original = Array.prototype.filter;
	Array.prototype.filter = function<T>(this: T[], callback: (item: T, i: number, values: T[]) => unknown, thisArg?: unknown) {
		if (this.length && typeof this[0] === 'object' && this[0] !== null && 'sourceName' in this[0]) visits += this.length;
		return original.call(this, callback, thisArg) as T[];
	};
	try { const model = createTakeCompDialogModel({ productId: 'soundscaper', project: takeProject(), snapshot: {} }); assert.equal(model.groups[0]?.lanesView.length, 20); assert.deepEqual(model.groups[0]?.lanesView[19]?.takes.map(({ id }) => id), ['take0-19']); } finally { Array.prototype.filter = original; }
	t.diagnostic(`lane partition filter visits ${visits}`); assert.equal(visits, 0);
});
void test('U27 label viewport preparation reads label identity once for all indexes', t => {
	let reads = 0;
	const labels = Array.from({ length: 500 }, (_, i) => ({ get id() { reads++; return `l${i}`; }, startFrame: i * 100, endFrame: i * 100 + 1 }));
	const index = createLabelViewportIndex(labels); const preparationReads = reads;
	assert.equal(index.query(0, 1, 0, []).length, 1); t.diagnostic(`label preparation ID reads ${preparationReads}`); assert.equal(preparationReads, 500);
	const duplicates = [{ id: 'same', startFrame: 0, endFrame: 1 }, { id: 'same', startFrame: 100, endFrame: 101 }];
	assert.deepEqual(createLabelViewportIndex(duplicates).query(500, 501, 0, ['same']), [duplicates[1]]);
});
void test('U28 annotation viewport queries fuse exact visibility and identity publication', t => {
	const annotations = Array.from({ length: 500 }, (_, i) => ({ id: `a${i}`, sequenceId: 'main', kind: 'region', anchor: 'sample', name: '', color: 'blue', batchId: null, opaqueExtensions: {}, coordinateDomain: 'resolved-samples', startFrame: i * 10, endFrame: i * 10 + 1, timelineStartFrame: i * 10, timelineEndFrame: i * 10 + 1, durationFrames: 1 })) as RuntimeTimelineAnnotationProjection[];
	const index = createTimelineAnnotationViewportIndex(annotations);
	let visits = 0; const original = Array.prototype.filter;
	Array.prototype.filter = function<T>(this: T[], callback: (item: T, i: number, values: T[]) => unknown, thisArg?: unknown) { if (this.length && typeof this[0] === 'object' && this[0] !== null && 'annotation' in this[0]) visits += this.length; return original.call(this, callback, thisArg) as T[]; };
	try { assert.equal(index.query(1, 1, 0, 5000, []).length, 500); } finally { Array.prototype.filter = original; }
	t.diagnostic(`intermediate filter visits ${visits}`); assert.equal(visits, 0);
});
void test('U29 adaptive automation sampling avoids a mapped probe array per subdivision and retains exact frames', t => {
	let arrays = 0; const original = Array.prototype.map;
	Array.prototype.map = function<T, U>(this: T[], callback: (item: T, i: number, values: T[]) => U, thisArg?: unknown): U[] { if (this.length === 3 && this[0] === 0.25 && this[1] === 0.5 && this[2] === 0.75) arrays++; return original.call(this, callback, thisArg) as U[]; };
	let result: number[];
	try { result = automationSampleFrames({ lane: { id: 'l', address: { kind: 'master', parameterId: 'gain' }, timebase: 'absolute-samples', points: [{ id: 'a', position: 0, value: 0 }, { id: 'b', position: 4096, value: 1 }], segments: [{ kind: 'bezier', control1: { x: 0.2, y: 0.1 }, control2: { x: 0.8, y: 0.9 } }] } as never, descriptor: { taper: 'linear' } as never, start: 0, end: 4096, step: 4, authoredFrames: [], pixelsPerFrame: 1, yAtFrame: frame => Math.sin(frame / 300) * 100 }); } finally { Array.prototype.map = original; }
	assert.equal(result[0], 0); assert.equal(result.at(-1), 4096); assert.ok(result.length > 64); t.diagnostic(`probe arrays ${arrays}; frame digest ${createHash('sha256').update(JSON.stringify(result)).digest('hex')}`); assert.equal(arrays, 0);
	assert.equal(createHash('sha256').update(JSON.stringify(result)).digest('hex'), 'f953160e3d98bf51b657dcfe1fb4d183006e04a7899d2826a903792e33bec56c');
	assert.deepEqual(result, Array.from(new Set(result)).sort((a, b) => a - b));
});
