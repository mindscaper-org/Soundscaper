/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { throwIfAborted } from '../src/common/foundation/abort-error.ts';
import { raceAbortablePromise, raceAbortableRead } from '../src/common/foundation/abort-race.ts';

test('cancellation without a platform DOMException retains the AbortError contract', () => {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'DOMException')!;
	try {
		Object.defineProperty(globalThis, 'DOMException', { configurable: true, value: undefined });
		assert.throws(() => throwIfAborted({ aborted: true, reason: undefined } as AbortSignal, 'Cancelled read'),
			{ name: 'AbortError', message: 'Cancelled read' });
	} finally { Object.defineProperty(globalThis, 'DOMException', descriptor); }
});

test('immediate reads turn synchronous failures into rejected promises with or without a signal', async () => {
	const failure = new Error('Read failed before returning a promise');
	for (const signal of [undefined, new AbortController().signal]) {
		await assert.rejects(raceAbortableRead(() => { throw failure; }, signal, 'immediate'), error => error === failure);
	}
	assert.equal(await raceAbortablePromise(Promise.resolve(42)), 42);
});

test('a custom abort reason selector may fail before or during a read without losing its error', async () => {
	for (const alreadyAborted of [false, true]) {
		const controller = new AbortController();
		if (alreadyAborted) controller.abort();
		const failure = new Error('Could not resolve the owning cancellation reason');
		const reading = raceAbortablePromise(new Promise<never>(() => {}), controller.signal, () => { throw failure; });
		if (!alreadyAborted) controller.abort();
		await assert.rejects(reading, error => error === failure);
	}
});

test('cancellation during listener registration prevents the read from starting', async context => {
	const controller = new AbortController();
	const reason = new Error('Cancelled while registering');
	const original = controller.signal.addEventListener.bind(controller.signal);
	context.mock.method(controller.signal, 'addEventListener', (...args: Parameters<AbortSignal['addEventListener']>) => {
		original(...args);
		controller.abort(reason);
	});
	let reads = 0;
	await assert.rejects(raceAbortableRead(() => { reads++; return 1; }, controller.signal), error => error === reason);
	assert.equal(reads, 0);
});
