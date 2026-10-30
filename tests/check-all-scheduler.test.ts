/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';

import { runCheckTasks, type CheckTask } from '../scripts/lib/check-all-scheduler.ts';

const task = (id: string, dependsOn: string[] = []): CheckTask => ({ id, args: [], dependsOn });

test('check-all keeps four slots occupied and waits for dependencies', async () => {
	const releases = new Map<string, (code: number) => void>();
	const started: string[] = [];
	const run = runCheckTasks([
		...['a', 'b', 'c', 'd', 'e'].map(id => task(id)), task('report', ['a', 'e']),
	], job => new Promise<number>(resolve => {
		started.push(job.id);
		releases.set(job.id, resolve);
	}));
	await setImmediate();
	assert.deepEqual(started, ['a', 'b', 'c', 'd']);
	releases.get('a')?.(0);
	await setImmediate();
	assert.deepEqual(started, ['a', 'b', 'c', 'd', 'e']);
	assert.equal(releases.has('report'), false);
	releases.get('e')?.(0);
	await setImmediate();
	assert.equal(started.at(-1), 'report');
	for (const release of releases.values()) release(0);
	assert.ok([...(await run).values()].every(state => state === 'passed'));
});

test('check-all reports a failure immediately, continues independent work and blocks dependent checks', async () => {
	const started: string[] = [];
	const failures: string[] = [];
	const states = await runCheckTasks([task('bad'), task('independent'), task('coverage', ['bad'])], job => {
		started.push(job.id);
		if (job.id === 'bad') return Promise.reject(new Error('compiler failed'));
		assert.deepEqual(failures, []); // Both independent checks start before either settles.
		return Promise.resolve(0);
	}, { onError: (job, error) => failures.push(`${job.id}: ${String(error)}`) });
	assert.deepEqual(started, ['bad', 'independent']);
	assert.match(failures[0], /compiler failed/u);
	assert.equal(states.get('bad'), 'failed');
	assert.equal(states.get('independent'), 'passed');
	assert.equal(states.get('coverage'), 'blocked');
});

test('check-all rejects invalid graphs before executing any check', async () => {
	for (const tasks of [[task('a', ['missing'])], [task('a', ['b']), task('b', ['a'])], [task('a'), task('a')]]) {
		let started = false;
		await assert.rejects(runCheckTasks(tasks, () => { started = true; return Promise.resolve(0); }));
		assert.equal(started, false);
	}
});

test('check-all does not start queued work after cancellation', async () => {
	const controller = new AbortController();
	let started = 0;
	const states = await runCheckTasks(Array.from({ length: 8 }, (_, index) => task(String(index))), () => {
		started++;
		controller.abort();
		return Promise.resolve(1);
	}, { signal: controller.signal });
	assert.equal(started, 1);
	assert.equal(states.get('7'), 'blocked');
});
