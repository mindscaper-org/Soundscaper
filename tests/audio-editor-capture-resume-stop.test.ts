/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { captureSessionTransitionFixture } from './helpers/capture-session-transition-fixture.ts';
import { deferred, remainsPending, waitForEvent } from './helpers/async-test-control.ts';

test('capture Stop joins a Resume pause-span commit before sealing and publishing', async () => {
	const f = captureSessionTransitionFixture();
	const gate = deferred<void>();
	f.gatePauseStorage(gate.promise);
	await f.start(); await f.service.actions.pause();
	const resuming = f.service.actions.resume();
	await waitForEvent(f.events, 'pause:write');
	const stopping = f.service.actions.stop();
	const stopWasPending = await remainsPending(stopping);
	const sealedEarly = f.events.includes('seal');
	gate.resolve();
	await Promise.all([resuming, stopping]);
	assert.equal(stopWasPending, true);
	assert.equal(sealedEarly, false);
	assert.ok(f.events.indexOf('pause:committed') < f.events.indexOf('seal'));
	assert.equal(f.service.snapshot.phase, 'inactive');
});
