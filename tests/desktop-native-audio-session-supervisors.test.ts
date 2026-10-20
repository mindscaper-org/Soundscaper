/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeAudioSessionSupervisorPool } from '../desktop/native-audio-helper-adapter.ts';
import type { HelperJobRequest } from '../desktop/helper-supervisor.ts';
import { createHarness, settled } from './helpers/helper-supervisor-double.ts';

test('persistent native input and output jobs run on independent verified supervisors', async () => {
	const workers: ReturnType<typeof createHarness>[] = [];
	const pool = createNativeAudioSessionSupervisorPool({ createSupervisor: () => {
		const worker = createHarness({ kinds: ['audio-device'] }); workers.push(worker); return worker.supervisor;
	} });
	const input = pool.runJob(request('input'));
	const output = pool.runJob(request('output'));
	await settled();
	assert.equal(workers.length, 2);
	assert.notEqual(workers[0]?.supervisor, workers[1]?.supervisor);
	assert.deepEqual(workers.map((worker) => worker.latest().posted.filter((message) => message.type === 'job').length), [1, 1],
		'both persistent jobs start before either completes');
	await assert.rejects(pool.runJob(request('input')), /at most 2/u);
	for (const worker of workers) {
		const job = worker.latest().posted.find((message) => message.type === 'job');
		assert.ok(job?.type === 'job');
		worker.latest().receive({ contractVersion: 1, type: 'result', jobId: job.jobId, result: { closed: true } });
	}
	await Promise.all([input, output]);
	assert.deepEqual(workers.map((worker) => worker.supervisor.snapshot().state), ['disposed', 'disposed']);
	assert.deepEqual(workers.map((worker) => worker.latest().killed), [1, 1]);
	await pool.dispose();
});

test('native session cancellation and pool shutdown clean up each owned supervisor without quarantine', async () => {
	const workers: ReturnType<typeof createHarness>[] = [];
	const pool = createNativeAudioSessionSupervisorPool({ createSupervisor: () => {
		const worker = createHarness({ kinds: ['audio-device'] }); workers.push(worker); return worker.supervisor;
	} });
	const abort = new AbortController();
	const cancelled = pool.runJob({ ...request('input'), signal: abort.signal });
	await settled();
	abort.abort();
	const worker = workers[0]!;
	const job = worker.latest().posted.find((message) => message.type === 'job');
	assert.ok(job?.type === 'job');
	worker.latest().receive({ contractVersion: 1, type: 'cancelled', jobId: job.jobId });
	await assert.rejects(cancelled, /cancelled/u);
	assert.equal(worker.supervisor.snapshot().state, 'disposed');
	const running = pool.runJob(request('output'));
	await settled();
	const rejected = assert.rejects(running, /disposed/u);
	await pool.dispose();
	await rejected;
	assert.equal(pool.snapshot().recentCrashes, 0);
	assert.equal(pool.snapshot().quarantined, false);
	await assert.rejects(pool.runJob(request('input')), /disposed/u);
});

test('native session crashes share a quarantine ledger across replacement supervisors', async () => {
	const workers: ReturnType<typeof createHarness>[] = [];
	const pool = createNativeAudioSessionSupervisorPool({ createSupervisor: () => {
		const worker = createHarness({ kinds: ['audio-device'] }); workers.push(worker); return worker.supervisor;
	} });
	for (let index = 0; index < 3; index += 1) {
		const running = pool.runJob(request('input'));
		const rejected = assert.rejects(running, /exited/u);
		await settled();
		workers[index]!.latest().exit(1);
		await rejected;
	}
	assert.equal(pool.snapshot().quarantined, true);
	await assert.rejects(pool.runJob(request('output')), /quarantined/u);
	assert.equal(workers.length, 3, 'quarantine refuses before another helper is created');
	pool.clearQuarantine();
	assert.equal(pool.snapshot().quarantined, false);
	await pool.dispose();
});

test('a session helper factory failure rejects asynchronously without occupying capacity', async () => {
	const pool = createNativeAudioSessionSupervisorPool({ createSupervisor: () => { throw new Error('planned factory failure'); } });
	let operation: Promise<unknown> | null = null;
	assert.doesNotThrow(() => { operation = pool.runJob(request('input')); });
	assert.ok(operation);
	await assert.rejects(operation, /planned factory failure/u);
	assert.equal(pool.snapshot().state, 'idle');
	await pool.dispose();
});

function request(direction: 'input' | 'output'): HelperJobRequest<'audio-device'> {
	const streamId = (direction === 'input' ? 'a' : 'b').repeat(40);
	return { kind: 'audio-device', grant: { backend: 'wasapi', deviceHandle: direction, direction, mode: 'shared',
		persistentPort: { portContractVersion: 1, transport: 'message-port', purpose: 'audio-realtime',
			streamId, generation: 1, maximumMessageBytes: 16_384, maximumInFlightMessages: 4 } },
		dataPlaneTransfers: [{ streamId, port: { postMessage() {}, close() {} } }] };
}
