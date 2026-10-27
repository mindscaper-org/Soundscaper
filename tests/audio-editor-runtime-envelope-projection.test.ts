/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { envelopeFramesToDesignPoints } from '../src/common/editor/automation.js';
import { MAXIMUM_ENVELOPE_PROJECTION_ENTRIES, MAXIMUM_ENVELOPE_PROJECTION_POINTS, projectTimelineEnvelopeDesignPoints } from '../src/common/editor/ui/timeline/envelope-design-projection.ts';
import { createTimelineClipViewModel, type TimelineClipViewModelOptions, type TimelineWaveformCacheEntry } from '../src/common/editor/ui/timeline/waveform-view-model.ts';

void test('selection refreshes reuse immutable envelope projections in the production clip model', context => {
	const envelope = Object.freeze(Array.from({ length: 2_048 }, (_, frame) => Object.freeze({ frame, value: 0.5 + frame / 4_096 })));
	const options: TimelineClipViewModelOptions = {
		controller: { getClipVisualData: () => null }, sourceLookup: new Map(),
		clip: { id: 'clip', sourceId: 'source', timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 2_048,
			waveformStartFrame: 0, waveformEndFrame: 2_048, envelope },
		geometry: { overscanStartFrame: 0, pixelsPerSecond: 100, sampleRate: 48_000 },
		selection: { selectedClipIds: null }, copy: { clip: 'Clip' }, rendering: {}, cache: new Map<string, TimelineWaveformCacheEntry>(),
	};
	const nativeLog10 = Math.log10;
	let logarithms = 0;
	context.mock.method(Math, 'log10', (value: number) => { logarithms++; return nativeLog10(value); });
	const first = createTimelineClipViewModel(options);
	for (let index = 0; index < 100; index++) createTimelineClipViewModel({ ...options,
		selection: { selectedClipIds: index % 2 ? new Set(['clip']) : null },
	});
	context.diagnostic(`${logarithms} dB conversions for 101 projections of 2,048 frozen points`);
	assert.equal(logarithms, 2_048, 'selection changes must reuse the unchanged envelope geometry');
	assert.equal(createTimelineClipViewModel(options).envelopePoints, first.envelopePoints);
});

const range = { startFrame: 0, endFrame: Infinity };
const frozenEnvelope = (count: number) => Object.freeze(Array.from({ length: count }, (_, frame) => Object.freeze({ frame, value: 1 })));

void test('projection preserves point order, duplicates, bounds and validation while immutable results resist mutation', () => {
	const owner = {}, envelope = Object.freeze([
		Object.freeze({ frame: 4, value: 0 }), Object.freeze({ frame: 2, value: 0.5 }),
		Object.freeze({ frame: 2, value: 2 }), Object.freeze({ frame: 100, value: 1 }),
	]);
	for (const sampleRate of [1, 2, 48_000]) for (const bounds of [range, { startFrame: 2, endFrame: 4 }, { startFrame: 10, endFrame: 1 }]) {
		assert.deepEqual(projectTimelineEnvelopeDesignPoints(owner, envelope, sampleRate, bounds), envelopeFramesToDesignPoints(envelope, sampleRate, bounds));
	}
	const first = projectTimelineEnvelopeDesignPoints(owner, envelope, 1, range);
	assert.ok(Object.isFrozen(first) && first.every(Object.isFrozen));
	assert.equal(Reflect.set(first[0]!, 'db', 99), false); assert.equal(Reflect.set(first, 'length', 0), false);
	assert.equal(projectTimelineEnvelopeDesignPoints(owner, envelope, 1, range), first);
	const changedRate = projectTimelineEnvelopeDesignPoints(owner, envelope, 2, range);
	assert.notEqual(changedRate, first);
	assert.notEqual(projectTimelineEnvelopeDesignPoints(owner, envelope, 1, range), first, 'each envelope retains only its latest scalar projection');
	const positiveZero = projectTimelineEnvelopeDesignPoints(owner, envelope, 1, range);
	assert.notEqual(projectTimelineEnvelopeDesignPoints(owner, envelope, 1, { ...range, startFrame: -0 }), positiveZero, 'scalar fingerprints preserve signed zero');
	for (const sampleRate of [0, -1, NaN, Infinity]) assert.throws(() => projectTimelineEnvelopeDesignPoints(owner, envelope, sampleRate, range), RangeError);
	for (const startFrame of [-1, NaN, Infinity]) assert.throws(() => projectTimelineEnvelopeDesignPoints(owner, envelope, 1, { ...range, startFrame }), RangeError);
	for (const endFrame of [-1, NaN]) assert.throws(() => projectTimelineEnvelopeDesignPoints(owner, envelope, 1, { ...range, endFrame }), RangeError);
});

void test('empty and invalid-number envelope projections preserve uncached behavior', () => {
	const owner = {};
	for (const envelope of [undefined, [], Object.freeze([{ frame: Infinity, value: 1 }]), Object.freeze([{ frame: NaN, value: -1 }])]) {
		assert.deepEqual(projectTimelineEnvelopeDesignPoints(owner, envelope, 1, range), envelopeFramesToDesignPoints(envelope, 1, range));
	}
});

void test('workspace envelope projections enforce combined point and entry budgets with LRU replacement', () => {
	const owner = {}, size = MAXIMUM_ENVELOPE_PROJECTION_POINTS / 4;
	const a = frozenEnvelope(size), b = frozenEnvelope(size), c = frozenEnvelope(size);
	const firstA = projectTimelineEnvelopeDesignPoints(owner, a, 1, range), firstB = projectTimelineEnvelopeDesignPoints(owner, b, 1, range);
	assert.equal(projectTimelineEnvelopeDesignPoints(owner, a, 1, range), firstA);
	projectTimelineEnvelopeDesignPoints(owner, c, 1, range);
	assert.equal(projectTimelineEnvelopeDesignPoints(owner, a, 1, range), firstA);
	assert.notEqual(projectTimelineEnvelopeDesignPoints(owner, b, 1, range), firstB, 'the older envelope releases its weak lookup when evicted');
	const entryOwner = {}, envelopes = Array.from({ length: MAXIMUM_ENVELOPE_PROJECTION_ENTRIES + 1 }, () => frozenEnvelope(1));
	const first = projectTimelineEnvelopeDesignPoints(entryOwner, envelopes[0], 1, range);
	for (const envelope of envelopes.slice(1)) projectTimelineEnvelopeDesignPoints(entryOwner, envelope, 1, range);
	assert.notEqual(projectTimelineEnvelopeDesignPoints(entryOwner, envelopes[0], 1, range), first);
	const oversized = frozenEnvelope(MAXIMUM_ENVELOPE_PROJECTION_POINTS + 1), outside = { startFrame: 1_000_000, endFrame: Infinity };
	assert.notEqual(projectTimelineEnvelopeDesignPoints(owner, oversized, 1, outside), projectTimelineEnvelopeDesignPoints(owner, oversized, 1, outside), 'a tiny visible slice cannot admit an oversized source envelope');
});

void test('weak waveform owners and envelope keys release retired opaque payloads even while a workspace remains alive', () => {
	const moduleUrl = new URL('../src/common/editor/ui/timeline/envelope-design-projection.ts', import.meta.url).href;
	const result = spawnSync(process.execPath, ['--expose-gc', '--import', 'tsx', '--input-type=module', '--eval', `
		import assert from 'node:assert/strict';
		import { setImmediate } from 'node:timers/promises';
		import { projectTimelineEnvelopeDesignPoints as project } from ${JSON.stringify(moduleUrl)};
		const owner = {};
		const retired = (() => {
			const opaque = new Uint8Array(4 * 1024 * 1024);
			const point = Object.freeze({ frame: 0, value: 1, opaque });
			const envelope = Object.freeze([point]);
			project(owner, envelope, 1, { startFrame: 0, endFrame: Infinity });
			return [new WeakRef(envelope), new WeakRef(point), new WeakRef(opaque)];
		})();
		const retiredOwner = (() => {
			const otherOwner = {};
			const output = project(otherOwner, Object.freeze([Object.freeze({ frame: 0, value: 1 })]), 1, { startFrame: 0, endFrame: 1 });
			return [new WeakRef(otherOwner), new WeakRef(output)];
		})();
		for (let round = 0; round < 8; round++) { await setImmediate(); globalThis.gc(); }
		assert.ok(retired.every(reference => reference.deref() === undefined), 'the live owner must not retain retired raw envelopes or opaque metadata');
		assert.ok(retiredOwner.every(reference => reference.deref() === undefined), 'retired waveform owners release retained display points');
		assert.equal(project(owner, Object.freeze([]), 1, { startFrame: 0, endFrame: 1 }).length, 0);
	`], { encoding: 'utf8', timeout: 30_000, maxBuffer: 1_048_576 });
	assert.equal(result.status, 0, result.stderr || result.stdout);
});
