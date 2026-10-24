/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAup4ExportSnapshot, createAup4ExportPlan, normalizeAup4ExportSource } from '../src/common/editor/aup4-export.js';
import { fixtureProject, source, clip, track } from './helpers/aup4-export-harness.js';

test('a many-source Audacity export partitions variants once for the snapshot', context => {
	const count = 80;
	const project = fixtureProject({
		sources: Array.from({ length: count }, (_, index) => source(`s${index}`, 48_000, 1, 4)),
		clips: Array.from({ length: count }, (_, index) => clip(`c${index}`, `s${index}`, { durationFrames: 4, sourceDurationFrames: 4 })),
		tracks: Array.from({ length: count }, (_, index) => track(`t${index}`, [`c${index}`])),
	});
	const audio = Array.from({ length: count }, (_, index) => ({ sourceId: `s${index}`, sampleRate: 48_000, channels: [new Float32Array([1, -0, .25, -.25])] }));
	let scanned = 0;
	const original = Array.prototype.filter;
	Array.prototype.filter = function(this: unknown[], callback: (value: unknown, index: number, array: unknown[]) => unknown, thisArg?: unknown) {
		if (this.length && this[0] && typeof this[0] === 'object' && Object.hasOwn(this[0], 'inputSourceId')) scanned += this.length;
		return original.call(this, callback, thisArg) as unknown[];
	} as typeof Array.prototype.filter;
	context.after(() => { Array.prototype.filter = original; });
	const result = normalizeAup4ExportSnapshot(project, audio) as { sources: { channels: Float32Array[] }[] };
	assert.equal(scanned, 0, 'source-by-source normalization must not refilter every planned variant');
	assert.equal(result.sources.length, count);
	assert.deepEqual(result.sources[0]?.channels[0], audio[0]?.channels[0]);
	assert.notStrictEqual(result.sources[0]?.channels[0], audio[0]?.channels[0]);
	const plan = createAup4ExportPlan(project);
	plan.sources = [];
	assert.deepEqual(normalizeAup4ExportSource(plan, audio[0]), [], 'the generic single-source API still observes mutable plans');
});

