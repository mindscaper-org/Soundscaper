/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { RangeReadAdmission } from '../desktop/read-capability-admission.js';

const OWNER = Object.freeze({ name: 'owner' });

function admission(options = {}) {
	return new RangeReadAdmission({
		hardMaximumCount: 3,
		hardMaximumBytes: 10,
		maximumActiveRequests: 2,
		label: 'Test range',
		...options,
	});
}

test('range admission keeps the active request window bounded and releases it once', () => {
	const gate = admission({ maximumActiveRequests: 1 });
	const ticket = gate.reserve(OWNER);
	const request = gate.acquireRequest(ticket);
	assert.ok(request);
	assert.equal(gate.acquireRequest(ticket), null);
	request.release();
	request.release();
	const next = gate.acquireRequest(ticket);
	assert.ok(next);
	next.release();
	gate.release(ticket);
});

test('range admission fences pending charges and requests after a cleanup failure', () => {
	const gate = admission();
	const retained = gate.reserve(OWNER);
	const pending = gate.reserve(OWNER);
	gate.retainAndFence(retained);
	assert.throws(() => gate.charge(pending, 1), /fenced/iu);
	assert.throws(() => gate.acquireRequest(pending), /fenced/iu);
	assert.throws(() => gate.reserve(OWNER), /fenced/iu);
	gate.release(pending);
});
