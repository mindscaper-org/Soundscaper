/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { startCpuProfiling } from '../src/common/editor/controller/transport/cpu-profiling.ts';
import { cpuProfileControl, retainCpuProfileInstrumentation } from '../src/common/editor/engine/cpu-profile-instrumentation.ts';
import { cpuProfileEffectRows } from '../src/common/editor/cpu-profile-rows.ts';
import { compileParallelStackPlan } from '../src/common/editor/engine/parallel-stack-plan.ts';
import { createParallelStackExecutor } from '../src/common/editor/engine/parallel-stack-dsp.ts';
import type { EngineProject } from '../src/common/editor/engine/types.ts';

test('profiling cleanup disables graph instrumentation, cancels capture and ignores late results', async () => {
	let resolve!: (value: { durationMs: number; editorCpuPercent: number; effects: [] }) => void;
	let canceled = 0;
	const readings: unknown[] = [];
	const stop = startCpuProfiling({ bridge: { capture: () => new Promise(r => { resolve = r; }),
		cancel: () => { canceled++; return Promise.resolve(); } }, publish: value => readings.push(value),
		onError: error => assert.fail(String(error)), schedule: () => assert.fail('No stale timer'), clear: () => {} });
	const control = new Int32Array(cpuProfileControl()!);
	assert.equal(Atomics.load(control, 0), 1);
	stop(); stop();
	assert.equal(Atomics.load(control, 0), 0);
	assert.equal(cpuProfileControl(), undefined);
	resolve({ durationMs: 1000, editorCpuPercent: 10, effects: [] });
	await Promise.resolve(); await Promise.resolve();
	assert.equal(canceled, 1);
	assert.deepEqual(readings, []);
});

test('effect rows retain separate rack instances and bypassed effects and remove obsolete measurements', () => {
	const rows = cpuProfileEffectRows({ tracks: [{ id: 'a', type: 'audio', name: 'Voice', effects: [
		{ id: 'eq1', type: 'eq' }, { id: 'eq2', type: 'eq', bypassed: true },
	] }], master: { effectsActive: false, effects: [{ id: 'eq1', type: 'eq' }] } }, [
		{ key: '["track","a","eq1"]', cpuPercent: 3, elapsedPercent: 4, calls: 100 },
		{ key: 'removed', cpuPercent: 99, elapsedPercent: 99, calls: 99 },
	]);
	assert.equal(rows.length, 3);
	assert.deepEqual(rows.map(row => [row.key, row.disabled, row.reading?.cpuPercent]), [
		['["track","a","eq1"]', false, 3], ['["track","a","eq2"]', true, undefined],
		['["master","master","eq1"]', true, undefined],
	]);
	assert.equal(rows[0]?.ownerName, 'Voice');
});

test('parallel workers mark the actual effect instance and closing the profiler stops markers without changing PCM', () => {
	const release = retainCpuProfileInstrumentation();
	const original = console.timeStamp;
	const marks: string[] = [];
	console.timeStamp = label => { marks.push(String(label)); };
	try {
		const project: EngineProject = { schemaFamily: 'soundscaper', schemaVersion: 1, sampleRate: 48000, masterChannels: 2,
			tracks: [{ id: 'a', type: 'audio', effects: [{ id: 'crusher', type: 'bitcrusher', params: { bitDepth: 8, mix: 100 } }] }],
			mixer: { schemaVersion: 1, groups: [], sends: [], cues: [], vcas: [],
				outputs: [{ id: 'main', name: 'Main', role: 'main', channelCount: 2 }],
				edges: ['a', 'master'].map(id => ({ id, kind: 'assignment', enabled: true, level: 1,
					source: id === 'a' ? { kind: 'track', id } : { kind: 'master' },
					destination: id === 'a' ? { kind: 'master' } : { kind: 'output', id: 'main' },
					position: 'post-fader', channelMap: [0, 1] })) } as EngineProject['mixer'],
		};
		const plan = compileParallelStackPlan(project, { sampleRate: 48000, workerCount: 1 });
		const execute = createParallelStackExecutor(plan, 0);
		const planes = Array.from({ length: plan.planeCount }, () => new Float32Array(256));
		for (const plane of plan.inputPlaneIndices[0]!) planes[plane]!.fill(.25);
		for (const index of plan.taskOrder) execute(index, planes, 0);
		assert.deepEqual(marks, ['scape-cpu:begin:["track","a","crusher"]', 'scape-cpu:end:["track","a","crusher"]']);
		const before = plan.outputPlaneIndices[0]!.map(plane => new Float32Array(planes[plane]!));
		assert.ok(before[0]!.every(sample => Math.abs(sample - .25) < .01));
		release();
		for (const index of plan.taskOrder) execute(index, planes, 1);
		assert.equal(marks.length, 2);
		for (const [channel, plane] of plan.outputPlaneIndices[0]!.entries()) assert.deepEqual(planes[plane], before[channel]);
	} finally { console.timeStamp = original; release(); }
});
