/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperWebVcrCaptureAuthorityV1,
} from '../desktop/framescaper-web-vcr-capture-authority.ts';

const OWNER = Object.freeze(Object.create(null)) as object;
const OTHER_OWNER = Object.freeze(Object.create(null)) as object;
const SESSION_ID = 'a'.repeat(32);

test('guest capture authority is owner-bound, one-shot, and expires after ten seconds', () => {
	const harness = authority();
	const guestFrame = Object.freeze({ routingId: 17 });
	const grant = harness.value.prepare(OWNER, guestFrame, {
		version: 1, sessionId: SESSION_ID, generation: 2,
	});
	assert.deepEqual(grant, {
		version: 1,
		grantId: '00000000000000000000000000000001',
		sessionId: SESSION_ID,
		generation: 2,
		expiresAtMs: 11_000,
	});
	assert.equal(harness.value.hasPending(OWNER), true);
	const request = {
		userGesture: true,
		videoRequested: true,
		audioRequested: true,
	};
	assert.equal(harness.value.consumeCurrent(OTHER_OWNER, request), undefined);
	assert.equal(harness.value.consumeCurrent(OWNER, { ...request, userGesture: false }), null);
	assert.deepEqual(harness.value.consumeCurrent(OWNER, request), {
		video: guestFrame,
		audio: guestFrame,
		enableLocalEcho: false,
	});
	assert.equal(harness.value.consumeCurrent(OWNER, request), undefined);
	assert.equal(harness.value.hasPending(OWNER), false);

	harness.value.prepare(OWNER, guestFrame, { version: 1, sessionId: SESSION_ID, generation: 3 });
	harness.advance(10_000);
	assert.equal(harness.value.consumeCurrent(OWNER, request), undefined);
});

test('revoking a session removes its grant before the next generation prepares capture', () => {
	const harness = authority();
	harness.value.prepare(OWNER, { frame: 1 }, { version: 1, sessionId: SESSION_ID, generation: 1 });
	assert.equal(harness.value.revokeOwner(OWNER), true);
	assert.equal(harness.value.hasPending(OWNER), false);
	harness.value.prepare(OWNER, { frame: 2 }, { version: 1, sessionId: SESSION_ID, generation: 2 });
	assert.equal(harness.value.teardown(OWNER, 2), true);
	assert.equal(harness.value.consumeCurrent(OWNER, {
		userGesture: true, videoRequested: true, audioRequested: true,
	}), undefined);
});

test('one guest session may prepare sequential grants but cannot replace a live grant', () => {
	const harness = authority();
	const reference = { version: 1, sessionId: SESSION_ID, generation: 1 };
	harness.value.prepare(OWNER, { frame: 1 }, reference);
	assert.throws(() => harness.value.prepare(OWNER, { frame: 2 }, reference), /live one-shot/iu);
	assert.ok(harness.value.consumeCurrent(OWNER, {
		userGesture: true, videoRequested: true, audioRequested: true,
	}));
	const second = harness.value.prepare(OWNER, { frame: 2 }, reference);
	assert.equal(second.grantId, '00000000000000000000000000000002');
});

test('disposal and owner revocation retire guest frame references', () => {
	const harness = authority();
	harness.value.prepare(OWNER, {}, { version: 1, sessionId: SESSION_ID, generation: 1 });
	assert.equal(harness.value.revokeOwner(OWNER), true);
	assert.equal(harness.value.revokeOwner(OWNER), false);
	harness.value.prepare(OTHER_OWNER, {}, { version: 1, sessionId: 'b'.repeat(32), generation: 1 });
	harness.value.dispose();
	assert.equal(harness.value.consumeCurrent(OTHER_OWNER, {
		userGesture: true,
		videoRequested: true, audioRequested: true,
	}), undefined);
});

function authority() {
	let nowMs = 1_000;
	let nextId = 1;
	const value = createFramescaperWebVcrCaptureAuthorityV1({
		now: () => nowMs,
		createOpaqueId: () => (nextId++).toString(16).padStart(32, '0'),
	});
	return { value, advance: (milliseconds: number) => { nowMs += milliseconds; } };
}
