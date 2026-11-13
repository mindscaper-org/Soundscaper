/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAbortGuard,
	throwIfAborted,
} from '../src/common/foundation/abort-error.ts';

test('shared abort checks preserve AbortSignal cancellation reasons', () => {
	assert.doesNotThrow(() => throwIfAborted(undefined, 'Unused cancellation message.'));
	assert.doesNotThrow(() => throwIfAborted(null, 'Unused cancellation message.'));
	assert.doesNotThrow(() => throwIfAborted(new AbortController().signal, 'Unused cancellation message.'));

	const reason = Symbol('owner cancellation');
	assert.deepEqual(captureThrown(() => throwIfAborted(AbortSignal.abort(reason), 'Unused cancellation message.')), {
		threw: true,
		error: reason,
	});
	assert.deepEqual(captureThrown(() => throwIfAborted(AbortSignal.abort(null), 'Unused cancellation message.')), {
		threw: true,
		error: null,
	});

	const guard = createAbortGuard('Fixed owner cancellation.');
	assert.doesNotThrow(() => guard());
	assert.deepEqual(captureThrown(() => guard(AbortSignal.abort(reason))), { threw: true, error: reason });
});

test('shared abort checks create platform and Error fallbacks when a real aborted signal has no reason', () => {
	const controller = new AbortController();
	controller.abort();
	const signal = controller.signal;
	const reasonDescriptor = Object.getOwnPropertyDescriptor(signal, 'reason');
	const exceptionDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'DOMException');
	assert.ok(exceptionDescriptor);
	try {
		Object.defineProperty(signal, 'reason', { configurable: true, value: undefined });
		assert.equal(signal.aborted, true);
		assert.throws(() => createAbortGuard('Platform owner cancellation.')(signal), error => {
			assert.ok(error instanceof DOMException);
			assert.equal(error.name, 'AbortError');
			assert.equal(error.message, 'Platform owner cancellation.');
			return true;
		});
		Object.defineProperty(globalThis, 'DOMException', { configurable: true, value: undefined });
		assert.throws(() => throwIfAborted(signal, 'Fallback owner cancellation.'), error => {
			assert.ok(error instanceof Error);
			assert.equal(error.name, 'AbortError');
			assert.equal(error.message, 'Fallback owner cancellation.');
			return true;
		});
	} finally {
		Object.defineProperty(globalThis, 'DOMException', exceptionDescriptor);
		if (reasonDescriptor) Object.defineProperty(signal, 'reason', reasonDescriptor);
		else Reflect.deleteProperty(signal, 'reason');
	}
});

function captureThrown(operation: () => void): Readonly<{ threw: boolean; error: unknown }> {
	try {
		operation();
		return Object.freeze({ threw: false, error: undefined });
	} catch (error) {
		return Object.freeze({ threw: true, error });
	}
}
