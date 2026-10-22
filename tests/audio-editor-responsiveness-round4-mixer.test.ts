/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createTrackMixerLabelRuntimeHandlers, removeTracksAndDependents } from '../src/common/editor/commands/track-mixer-label-runtime.js';
import { commandFixture } from './helpers/round3-command-fixtures.ts';

const handlers = createTrackMixerLabelRuntimeHandlers();

void test('track removal collects membership IDs without a flattened intermediate', () => {
	const project = commandFixture(120, 1);
	const previous = Array.prototype.flatMap;
	let calls = 0;
	Array.prototype.flatMap = function <U, This>(callback: (this: This, value: unknown, index: number, array: unknown[]) => U | readonly U[], thisArg?: This): U[] {
		calls++; return Reflect.apply(previous, this, [callback, thisArg]) as U[];
	};
	try { removeTracksAndDependents(project, ['track-0']); } finally { Array.prototype.flatMap = previous; }
	assert.equal(calls, 0); assert.equal(project.clips.length, 0);
});

void test('lane reorder buckets groups and records block positions instead of rescanning all tracks', context => {
	const project = commandFixture(120, 120);
	let reads = 0;
	for (let index = 0; index < project.tracks.length; index++) {
		project.tracks[index]!.laneGroupId = `lane-${String(Math.floor(index / 2))}`;
		project.tracks[index] = new Proxy(project.tracks[index]!, { get(track, property, receiver) {
			if (property === 'laneGroupId') reads++;
			return Reflect.get(track, property, receiver) as unknown;
		} });
	}
	const tracks = project.tracks;
	const previous = Array.prototype.findIndex;
	let blockSearches = 0;
	Array.prototype.findIndex = function (callback: (value: unknown, index: number, array: unknown[]) => unknown, thisArg?: unknown) {
		if (this !== tracks) blockSearches++;
		return Reflect.apply(previous, this, [callback, thisArg]) as number;
	};
	try { handlers['track/reorder'](project, { trackId: 'track-0', index: 119 }); }
	finally { Array.prototype.findIndex = previous; }
	context.diagnostic(`60 lane blocks: ${String(reads)} lane-group reads; ${String(blockSearches)} block searches`);
	assert.ok(reads <= 360, String(reads)); assert.equal(blockSearches, 0);
	assert.deepEqual(project.tracks.slice(-2).map(track => track.id), ['track-0', 'track-1']);
	assert.equal(project.tracks[0]!.id, 'track-2');
});

void test('track update reuses its private type-specific field admission table', () => {
	const project = commandFixture(1); const original = globalThis.Set; let constructions = 0;
	globalThis.Set = new Proxy(original, { construct(target, args, newTarget) {
		if (Array.isArray(args[0]) && args[0][0] === 'name' && args[0].includes('armed')) constructions++;
		return Reflect.construct(target, args, newTarget) as Set<unknown>;
	} });
	try { handlers['track/update'](project, { trackId: 'track-0', changes: { name: 'renamed' } }); }
	finally { globalThis.Set = original; }
	assert.equal(constructions, 0); assert.equal(project.tracks[0]!.name, 'renamed');
});

void test('master update reuses its private field admission table', () => {
	const project = commandFixture(1); const original = globalThis.Set; let constructions = 0;
	globalThis.Set = new Proxy(original, { construct(target, args, newTarget) {
		if (Array.isArray(args[0]) && args[0][0] === 'gain' && args[0].includes('effectsActive')) constructions++;
		return Reflect.construct(target, args, newTarget) as Set<unknown>;
	} });
	try { handlers['master/update'](project, { changes: { gain: 0.5 } }); } finally { globalThis.Set = original; }
	assert.equal(constructions, 0); assert.equal((project.master as { gain: number }).gain, 0.5);
});
