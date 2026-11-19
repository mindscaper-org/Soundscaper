/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { CpuProfileAccumulator } from '../desktop/cpu-profile-accumulator.ts';

const stamp = (key: string, edge: string, ts: number, tts: number | undefined, tid = 2, pid = 1) => ({
	name: 'TimeStamp', ph: 'I', pid, tid, ts, tts,
	args: { data: { message: `scape-cpu:${edge}:${key}` } },
});

test('CPU profiles attribute thread CPU to individual instances without counting nested sidechains twice', () => {
	const profile = new CpuProfileAccumulator(1);
	profile.add([
		stamp('track:a:eq', 'begin', 100, 10), stamp('track:b:eq', 'begin', 110, 14),
		stamp('track:b:eq', 'end', 140, 20), stamp('track:a:eq', 'end', 200, 30),
		stamp('track:a:eq', 'begin', 210, 31), stamp('track:a:eq', 'end', 220, 34),
		stamp('foreign', 'begin', 1, 1, 2, 99), stamp('foreign', 'end', 9, 9, 2, 99),
	]);
	assert.deepEqual(profile.finish(1_000).effects.sort((a, b) => a.key.localeCompare(b.key)), [
		{ key: 'track:a:eq', cpuPercent: 17 / 1_000 * 100, elapsedPercent: 8, calls: 2 },
		{ key: 'track:b:eq', cpuPercent: 0.6, elapsedPercent: 3, calls: 1 },
	]);
});

test('CPU profiles preserve unknown CPU timing and discard incomplete or invalid pairs', () => {
	const profile = new CpuProfileAccumulator(1);
	profile.add([stamp('missing', 'end', 10, 2), stamp('pending', 'begin', 10, 2),
		stamp('unknown', 'begin', 20, undefined, 3), stamp('unknown', 'end', 30, undefined, 3),
		stamp('backwards', 'begin', 40, 20, 4), stamp('backwards', 'end', 50, 19, 4)]);
	assert.deepEqual(profile.finish(100).effects, [
		{ key: 'unknown', cpuPercent: null, elapsedPercent: 10, calls: 1 },
	]);
});
