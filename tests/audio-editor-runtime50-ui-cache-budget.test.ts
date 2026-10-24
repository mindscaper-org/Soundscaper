/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { splitToolClipIndex, splitToolItemBoundaries } from '../src/common/editor/ui/timeline/split-tool-item-index.ts';
import { splitToolTrackHasClipAt, resolveSplitToolGuidelineFrame } from '../src/common/editor/ui/timeline/timeline-tool-precedence.ts';
import { createSplitToolIndexBudget, SPLIT_TOOL_INDEX_ENTRY_LIMIT, SPLIT_TOOL_INDEX_OWNER_LIMIT } from '../src/common/editor/ui/timeline/split-tool-cache-budget.ts';

const frozenClips = (count: number) => Object.freeze(Array.from({ length: count }, (_, index) => Object.freeze({ id: String(index), timelineStartFrame: index * 100, durationFrames: 50 })));
const frozenTracks = (clips: ReturnType<typeof frozenClips>) => Object.freeze([Object.freeze({ id: 'track', clipIds: Object.freeze(clips.map(clip => clip.id)) })]);

void test('split hit-test caches evict old owners while undo snapshots remain live', () => {
	let reads = 0;
	const first = Object.freeze(Array.from({ length: 129 }, (_, index) => Object.freeze({ get id() { reads++; return String(index); }, timelineStartFrame: index * 100, durationFrames: 50 })));
	const tracks = [{ id: 'track', clipIds: ['128'] }];
	assert.equal(splitToolTrackHasClipAt(tracks, first, 'track', 12801), true);
	const snapshots = Array.from({ length: SPLIT_TOOL_INDEX_OWNER_LIMIT }, () => frozenClips(129));
	for (const clips of snapshots) assert.equal(splitToolTrackHasClipAt(tracks, clips, 'track', 12801), true);
	assert.equal(splitToolTrackHasClipAt(tracks, first, 'track', 12801), true);
	assert.equal(reads, 258, 'the first live undo snapshot must be rebuilt after the owner budget is exhausted');
});

void test('split clip maps and boundary points share an aggregate entry budget', () => {
	const snapshots = Array.from({ length: 3 }, () => frozenClips(20_000));
	const first = splitToolClipIndex(snapshots[0]!);
	for (const clips of snapshots.slice(1)) splitToolClipIndex(clips);
	const clips = snapshots[0]!; const tracks = frozenTracks(clips);
	assert.equal(resolveSplitToolGuidelineFrame({ project: { clips, tracks }, frame: 149, pixelsPerSecond: 1, sampleRate: 1 }), 150);
	assert.notEqual(splitToolClipIndex(clips), first, '60,000 map entries plus 40,000 points cannot remain retained together');
});

void test('oversize split indexes stay invocation-local and boundary tuples replace rather than accumulate', () => {
	const oversized = frozenClips(SPLIT_TOOL_INDEX_ENTRY_LIMIT + 1);
	assert.notEqual(splitToolClipIndex(oversized), splitToolClipIndex(oversized));
	const clips = frozenClips(129); const first = frozenTracks(clips); const second = frozenTracks(clips);
	const original = splitToolItemBoundaries(clips, first);
	splitToolItemBoundaries(clips, second);
	assert.notEqual(splitToolItemBoundaries(clips, first), original, 'returning to an old tracks tuple rebuilds it');
	const tooManyPoints = frozenClips(SPLIT_TOOL_INDEX_ENTRY_LIMIT / 2 + 1); const tracks = frozenTracks(tooManyPoints);
	assert.notEqual(splitToolItemBoundaries(tooManyPoints, tracks), splitToolItemBoundaries(tooManyPoints, tracks));
});

void test('weak index budget replaces weights and evicts across independent index kinds', () => {
	const budget = createSplitToolIndexBudget(5, 3);
	const maps = budget.cache<object, string>(); const points = budget.cache<object, string>();
	const a = {}, b = {}, c = {};
	maps.set(a, 'old', 3); maps.set(a, 'new', 1); points.set(b, 'points', 3);
	assert.equal(maps.get(a), 'new');
	maps.set(c, 'latest', 2);
	assert.equal(maps.get(a), undefined); assert.equal(points.get(b), 'points');
	points.set(a, 'oversize', 6); assert.equal(points.get(a), undefined);
});

void test('weak split indexes release retired clips, opaque metadata, tuple owners and replaced point arrays', () => {
	const moduleUrl = new URL('../src/common/editor/ui/timeline/split-tool-item-index.ts', import.meta.url).href;
	const publicUrl = new URL('../src/common/editor/ui/timeline/timeline-tool-precedence.ts', import.meta.url).href;
	const child = spawnSync(process.execPath, ['--expose-gc', '--import', 'tsx', '--input-type=module', '--eval', `
		import assert from 'node:assert/strict';
		import { setImmediate } from 'node:timers/promises';
		import { splitToolItemBoundaries } from ${JSON.stringify(moduleUrl)};
		import { splitToolTrackHasClipAt, resolveSplitToolGuidelineFrame } from ${JSON.stringify(publicUrl)};
		function retiredClip() {
			const opaque = new Uint8Array(1000000);
			const clip = Object.freeze({ id: 'clip', opaque, timelineStartFrame: 0, durationFrames: 100 });
			const clips = Object.freeze([clip, ...Array.from({ length: 129 }, (_, index) => Object.freeze({ id: String(index), timelineStartFrame: index * 100, durationFrames: 50 }))]);
			const tracks = Object.freeze([Object.freeze({ id: 'track', clipIds: Object.freeze(['clip']) })]);
			splitToolTrackHasClipAt(tracks, clips, 'track', 1);
			resolveSplitToolGuidelineFrame({ project: { clips, tracks }, frame: 1, pixelsPerSecond: 1, sampleRate: 1 });
			return [new WeakRef(clips), new WeakRef(clip), new WeakRef(opaque)];
		}
		const references = retiredClip();
		const clips = Object.freeze([Object.freeze({ id: 'kept', timelineStartFrame: 0, durationFrames: 10 })]);
		function retiredTuple() {
			const opaque = new Uint8Array(1000000);
			const track = Object.freeze({ id: 'track', opaque, clipIds: Object.freeze(['kept']) });
			const tracks = Object.freeze([track]);
			const annotation = Object.freeze({ timelineStartFrame: 3, timelineEndFrame: 4, opaque });
			const annotations = Object.freeze([annotation]);
			splitToolItemBoundaries(clips, tracks, annotations);
			return [new WeakRef(tracks), new WeakRef(track), new WeakRef(annotations), new WeakRef(annotation), new WeakRef(opaque)];
		}
		references.push(...retiredTuple());
		const firstTracks = Object.freeze([Object.freeze({ id: 'first', clipIds: Object.freeze(['kept']) })]);
		const secondTracks = Object.freeze([Object.freeze({ id: 'second', clipIds: Object.freeze(['kept']) })]);
		function firstPoints() { return new WeakRef(splitToolItemBoundaries(clips, firstTracks)); }
		const pointReference = firstPoints(); splitToolItemBoundaries(clips, secondTracks);
		for (let round = 0; round < 8; round++) { await setImmediate(); globalThis.gc(); }
		assert.ok(references.every(reference => reference.deref() === undefined));
		assert.equal(pointReference.deref(), undefined);
		assert.equal(clips.length, 1); assert.equal(firstTracks.length + secondTracks.length, 2);
	`], { encoding: 'utf8', maxBuffer: 1024 * 1024, env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=1536' } });
	assert.equal(child.status, 0, child.stderr || child.stdout);
});
