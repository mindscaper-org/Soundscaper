/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import test, { type TestContext } from 'node:test';
import { MotionSustainedProcessCustody } from '../scripts/performance/motionscaper-sustained-custody.ts';
import { startMotionSustainedSampler } from '../scripts/performance/motionscaper-sustained-sampler.ts';
import { sampleMotionSustainedEncoder } from '../scripts/performance/motionscaper-sustained-encoder-sampler.ts';
import { startMotionMaximumObservation } from '../desktop/motionscaper-native-maximum-observation.ts';
import { motionCdpMemoryDetails, motionProcessMemoryDetails } from '../scripts/performance/motionscaper-sustained-memory-details.ts';
import type { MotionOwnedMemorySample } from '../scripts/performance/motionscaper-sustained-observation.ts';

const owner = { pid: 700001, parentPid: 1, startTicks: '101' };
function memory(): MotionOwnedMemorySample {
	return { observedAt: new Date().toISOString(), monotonicMs: performance.now(), rssBytes: 1024, pssBytes: 512,
		processes: [{ identity: owner, rssBytes: 1024, pssBytes: 512, details: motionProcessMemoryDetails('') }] };
}
function cdp() {
	return { sample: () => Promise.resolve([{ observedAt: new Date().toISOString(), monotonicMs: performance.now(),
		targetId: 'page', sessionId: 'page-session', type: 'page', url: 'about:blank', usedHeapBytes: 1, totalHeapBytes: 2,
		heapDetails: motionCdpMemoryDetails({}), wasmCapacityBytes: [65536], workerName: '', workerFrames: 0, backend: null, revision: null }]) };
}
function logs(t: TestContext) {
	let writes = 0, closes = 0, procReads = 0;
	t.mock.method(fs.promises, 'open', async () => ({ write: async () => { writes++; }, sync: async () => undefined, close: async () => { closes++; } }));
	t.mock.method(fs.promises, 'readFile', () => { procReads++; throw new Error('Unserialized process read.'); });
	t.mock.method(fs.promises, 'readdir', () => { procReads++; throw new Error('Unserialized process discovery.'); });
	syncBuiltinESMExports(); t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
	return { state: () => ({ writes, closes, procReads }) };
}

test('Motion sustained sampler uses the injected serialized census for initial and final samples', async t => {
	const log = logs(t), custody = new MotionSustainedProcessCustody(); let reads = 0;
	const sampler = await startMotionSustainedSampler({ owner, phase: 'fake-custody', cdp: cdp(), logPath: '/fake/sampler.jsonl', progress: async () => 0,
		sampleProcesses: () => custody.observe(async () => { reads++; custody.retain([owner]); return memory(); }) });
	const result = await sampler.stop();
	assert.equal(reads, 2); assert.equal(result.samples.length, 2); assert.deepEqual(log.state(), { writes: 2, closes: 1, procReads: 0 });
});

test('Motion maximum observation uses the same injected census without direct discovery', async t => {
	const log = logs(t), custody = new MotionSustainedProcessCustody(); let reads = 0;
	const sampler = await startMotionMaximumObservation({ owner, cdp: cdp(),
		sampleProcesses: () => custody.observe(async () => { reads++; custody.retain([owner]); return memory(); }) },
	{ frames: 1, deadline: 600000, logPath: '/fake/maximum.jsonl', progress: async () => 1 });
	await sampler.stop();
	assert.equal(reads, 2); assert.deepEqual(log.state(), { writes: 2, closes: 1, procReads: 0 });
});

test('Motion sustained sampler propagates failed custody and closes its log before telemetry', async t => {
	const log = logs(t), failure = new Error('Admission failed');
	await assert.rejects(startMotionSustainedSampler({ owner, phase: 'fake-refusal', cdp: { sample: () => assert.fail('No telemetry after refusal') },
		logPath: '/fake/refused.jsonl', progress: async () => 0, sampleProcesses: () => Promise.reject(failure) }), error => error === failure);
	assert.deepEqual(log.state(), { writes: 0, closes: 1, procReads: 0 });
});

test('Motion encoder performs its actual discovery inside the injected custody operation', async t => {
	let active = false, entered = 0, reads = 0;
	const custody = new MotionSustainedProcessCustody();
	t.mock.method(fs.promises, 'readFile', (path: fs.PathLike) => {
		assert.equal(active, true); reads++;
		if (path === `/proc/${owner.pid}/stat`) return Promise.resolve(`${owner.pid} (fake) S 1 1 1 ${Array<string>(15).fill('0').join(' ')} ${owner.startTicks}`);
		assert.equal(path, `/proc/${owner.pid}/task/${owner.pid}/children`); return Promise.resolve('');
	});
	t.mock.method(fs.promises, 'readdir', (path: fs.PathLike) => {
		assert.equal(active, true); assert.equal(path, `/proc/${owner.pid}/task`); return Promise.resolve([String(owner.pid)]);
	});
	syncBuiltinESMExports(); t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
	const result = await sampleMotionSustainedEncoder({ owner, helperPath: '/fake/helper', retainProcesses: values => custody.retain(values),
		withProcessCustody: read => custody.observe(async () => { entered++; active = true; try { return await read(); } finally { active = false; } }) });
	assert.deepEqual(result, []); assert.equal(entered, 1); assert.equal(reads, 3); assert.equal(active, false);
});

test('Motion encoder performs no discovery if injected custody rejects admission', async t => {
	const log = logs(t), failure = new Error('Admission failed');
	await assert.rejects(sampleMotionSustainedEncoder({ owner, helperPath: '/fake/helper', retainProcesses: () => assert.fail('No new identity'),
		withProcessCustody: () => Promise.reject(failure) }), error => error === failure);
	assert.deepEqual(log.state(), { writes: 0, closes: 0, procReads: 0 });
});
