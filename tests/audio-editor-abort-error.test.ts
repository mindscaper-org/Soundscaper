/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAbortGuard,
	throwIfAborted,
} from '../src/common/foundation/abort-error.ts';

test('shared abort checks preserve AbortSignal cancellation reasons', () => {
	assert.doesNotThrow(() => throwIfAborted(undefined, 'Unused cancellation message.'));
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
	assert.deepEqual(captureThrown(() => guard(AbortSignal.abort(reason))), { threw: true, error: reason });
});

function captureThrown(operation: () => void): Readonly<{ threw: boolean; error: unknown }> {
	try {
		operation();
		return Object.freeze({ threw: false, error: undefined });
	} catch (error) {
		return Object.freeze({ threw: true, error });
	}
}
