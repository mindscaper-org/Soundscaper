/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { DesktopCodecOperationQueue } from '../desktop/desktop-codec-operation-queue.ts';
import { deferred, remainsPending, waitFor } from './helpers/async-test-control.ts';

const refused = (reason: 'busy' | 'cancelled'): string => reason;

test('codec admission preserves four independent execution slots', async () => {
	const queue = new DesktopCodecOperationQueue(4);
	const release = deferred<void>();
	let active = 0, peak = 0, starts = 0;
	const jobs = Array.from({ length: 7 }, () => queue.run(async () => {
		active += 1; starts += 1; peak = Math.max(peak, active);
		await release.promise;
		active -= 1;
		return 'done';
	}, { refused }));
	await waitFor(() => starts === 4, 'four concurrent codec jobs');
	assert.equal(active, 4);
	release.resolve();
	assert.deepEqual(await Promise.all(jobs), Array.from({ length: 7 }, () => 'done'));
	assert.equal(peak, 4);
	assert.throws(() => new DesktopCodecOperationQueue(5), RangeError);
});

test('codec jobs retain FIFO order and hold their slot through cleanup', async () => {
	const queue = new DesktopCodecOperationQueue(1);
	const cleanup = deferred<string>();
	const trace: string[] = [];
	const first = queue.run(async () => { trace.push('first'); return await cleanup.promise; }, { refused });
	const second = queue.run(async () => { trace.push('second'); return 'two'; }, { refused });
	const third = queue.run(async () => { trace.push('third'); return 'three'; }, { refused });
	assert.equal(await remainsPending(second), true);
	assert.deepEqual(trace, ['first']);
	cleanup.resolve('one');
	assert.deepEqual(await Promise.all([first, second, third]), ['one', 'two', 'three']);
	assert.deepEqual(trace, ['first', 'second', 'third']);
});

test('codec queues bound waiting jobs without starting overflow work', async () => {
	const queue = new DesktopCodecOperationQueue(1);
	const release = deferred<string>();
	const first = queue.run(() => release.promise, { refused });
	const waiting = Array.from({ length: 8 }, () => queue.run(async () => 'next', { refused }));
	let ran = false;
	assert.equal(await queue.run(async () => { ran = true; return 'excess'; }, { refused }), 'busy');
	assert.equal(ran, false);
	release.resolve('done');
	assert.equal(await first, 'done');
	assert.deepEqual(await Promise.all(waiting), Array.from({ length: 8 }, () => 'next'));
});

test('cancelled codec waiters are removed before their operation or input staging starts', async () => {
	const queue = new DesktopCodecOperationQueue(1);
	const release = deferred<string>();
	const first = queue.run(() => release.promise, { refused });
	const controller = new AbortController();
	let ran = false;
	const waiting = queue.run(async () => { ran = true; return 'staged'; }, { refused, signal: controller.signal });
	controller.abort(0);
	assert.equal(await waiting, 'cancelled');
	assert.equal(ran, false);
	release.resolve('done');
	await first;
	assert.equal(await queue.run(async () => 'usable', { refused }), 'usable');
});

test('active codec cancellation keeps its slot until the worker acknowledges cleanup', async () => {
	const queue = new DesktopCodecOperationQueue(1);
	const release = deferred<string>();
	const controller = new AbortController();
	const started = deferred<void>();
	const first = queue.run(() => { started.resolve(); return release.promise; }, { refused, signal: controller.signal });
	await started.promise;
	controller.abort();
	const next = queue.run(async () => 'next', { refused });
	assert.equal(await remainsPending(next), true);
	release.resolve('done');
	await first;
	assert.equal(await next, 'next');
});

test('a failed codec job releases admission for later work', async () => {
	const queue = new DesktopCodecOperationQueue(1);
	const failure = new Error('Decode failed');
	const first = queue.run(async () => { throw failure; }, { refused });
	const next = queue.run(async () => 'next', { refused });
	await assert.rejects(first, (error: unknown) => error === failure);
	assert.equal(await next, 'next');
});
