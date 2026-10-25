/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { routingLayoutRanks } from '../src/common/editor/ui/workspace/routing-layout-ranks.ts';
import { readWaveformCanvasMeasurements } from '../src/common/editor/ui/timeline/waveform-canvas-measurements.ts';

void test('U34 routing ranks walk a reverse-authored DAG once instead of repeatedly relaxing every edge', t => {
	const initial = new Map(Array.from({ length: 200 }, (_, i) => [`n${i}`, 0]));
	const predecessors = new Map(Array.from({ length: 199 }, (_, i) => [`n${199 - i}`, [`n${198 - i}`]]));
	let reads = 0; const original = Map.prototype.get;
	Map.prototype.get = function(this: Map<unknown, unknown>, key: unknown): unknown { reads++; return original.call(this, key); };
	let ranks: ReadonlyMap<string, number>;
	try { ranks = routingLayoutRanks(initial, predecessors, 200); } finally { Map.prototype.get = original; }
	assert.equal(ranks.get('n199'), 199); t.diagnostic(`rank map reads ${reads}`); assert.ok(reads <= 1800);
	const cycle = new Map([['a', ['b']], ['b', ['a']]]); assert.deepEqual([...routingLayoutRanks(new Map([['a', 0], ['b', 0]]), cycle, 2)], [['a', 3], ['b', 4]]);
});
void test('U35 waveform canvas paint resolves each canvas once while keeping all normalization before layout reads', t => {
	let queries = 0, normalized = 0, reads = 0; const prior = Object.getOwnPropertyDescriptor(globalThis, 'getComputedStyle');
	Object.defineProperty(globalThis, 'getComputedStyle', { configurable: true, value: () => ({ colorScheme: 'dark', getPropertyValue: () => '' }) });
	const elements = Array.from({ length: 100 }, (_, i) => ({ dataset: { clipId: `c${i}` }, querySelector() { queries++; return { closest: () => ({ dataset: { color: 'blue' } }), getBoundingClientRect() { assert.equal(normalized, 100); reads++; return { width: 100, height: 30 }; } }; } }));
	try { const result = readWaveformCanvasMeasurements({ querySelectorAll: () => elements } as unknown as HTMLElement, () => { normalized++; }); assert.equal(result.length, 100); assert.equal(result[99]?.clipId, 'c99'); } finally { if (prior) Object.defineProperty(globalThis, 'getComputedStyle', prior); else Reflect.deleteProperty(globalThis, 'getComputedStyle'); }
	t.diagnostic(`canvas subtree queries ${queries}; geometry reads ${reads}`); assert.equal(queries, 100); assert.equal(reads, 100);
});
