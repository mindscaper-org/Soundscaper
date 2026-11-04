/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { captureSessionTransitionFixture } from './helpers/capture-session-transition-fixture.ts';
import { deferred, remainsPending, waitForEvent } from './helpers/async-test-control.ts';

test('Recover waits for the failed live capture to finish sealing its acknowledged prefix', async () => {
	const f = captureSessionTransitionFixture();
	const gate = deferred<void>();
	f.gateSeal(gate.promise);
	await f.start(); f.failRecorder('camera', new Error('Encoder interrupted'));
	await waitForEvent(f.events, 'seal');
	const recovering = f.service.actions.recover();
	const recoveryWasPending = await remainsPending(recovering);
	const finalizedEarly = f.events.includes('finalize');
	gate.resolve();
	await Promise.all([recovering, f.service.settled()]);
	assert.equal(recoveryWasPending, true);
	assert.equal(finalizedEarly, false);
	assert.ok(f.events.indexOf('seal:committed') < f.events.indexOf('finalize'));
	assert.equal(f.service.snapshot.phase, 'inactive');
});
