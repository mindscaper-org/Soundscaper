/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { captureSessionTransitionFixture } from './helpers/capture-session-transition-fixture.ts';
import { deferred, settle, waitForEvent } from './helpers/async-test-control.ts';

test('repeated Delete clicks share one pending capture recovery decision', async () => {
	const f = captureSessionTransitionFixture();
	await f.start();
	f.failRecorder('camera', new Error('Encoder interrupted'));
	await f.service.settled();
	const gate = deferred<void>(); f.gateDiscard(gate.promise);
	const first = f.service.actions.discard();
	await waitForEvent(f.events, 'discard');
	const second = f.service.actions.discard();
	const outcome = Promise.allSettled([first, second]);
	await settle();
	const calls = f.events.filter(event => event === 'discard').length;
	gate.resolve();
	assert.deepEqual((await outcome).map(result => result.status), ['fulfilled', 'fulfilled']);
	assert.equal(calls, 1, 'a second click must not delete the same spool again');
	assert.equal(f.service.snapshot.phase, 'inactive');
});

test('Recover cannot publish a capture after its Delete decision has started', async () => {
	const f = captureSessionTransitionFixture();
	await f.start();
	f.failRecorder('camera', new Error('Encoder interrupted'));
	await f.service.settled();
	const gate = deferred<void>(); f.gateDiscard(gate.promise);
	const deleting = f.service.actions.discard();
	await waitForEvent(f.events, 'discard');
	const recovery = Promise.resolve().then(() => f.service.actions.recover());
	const outcome = Promise.allSettled([deleting, recovery]);
	await settle();
	const finalized = f.events.includes('finalize');
	gate.resolve();
	await outcome;
	assert.equal(finalized, false, 'discarded recovery media cannot be adopted into the project');
	assert.equal(f.service.snapshot.phase, 'inactive');
});
