/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { captureSessionTransitionFixture } from './helpers/capture-session-transition-fixture.ts';
import { deferred, waitFor } from './helpers/async-test-control.ts';

test('repeating the still-visible camera Resume while its journal is pending joins the same transition', async () => {
	let visiblePhase = 'inactive';
	const f = captureSessionTransitionFixture({ onChange: () => { visiblePhase = f.service.snapshot.phase; } });
	await f.service.initialize(); await f.service.actions.requestPreview(['camera']);
	f.service.actions.arm({ destination: 'both', countdownMs: 0 }); await f.service.actions.start();
	await f.service.actions.pause(); assert.equal(visiblePhase, 'paused');
	const write = deferred<void>(); f.gatePauseStorage(write.promise);
	const first = f.service.actions.resume();
	await waitFor(() => f.events.filter(event => event === 'pause:write').length === 2, 'resume journal pending');
	assert.equal(f.service.snapshot.phase, 'recording');
	assert.equal(visiblePhase, 'paused', 'the camera-only UI still offers Resume until the journal publishes');
	const second = f.service.actions.resume();
	const result = Promise.allSettled([first, second]); write.resolve();
	try {
		assert.deepEqual((await result).map(value => value.status), ['fulfilled', 'fulfilled']);
		assert.equal(f.events.filter(event => event === 'resume:camera').length, 1);
	} finally { await f.service.actions.stop(); await f.service.dispose(); }
});

test('a different following Pause remains ordered and permits a new Resume intent', async () => {
	const f = captureSessionTransitionFixture(); await f.start(); await f.service.actions.pause();
	const write = deferred<void>(); f.gatePauseStorage(write.promise);
	const first = f.service.actions.resume();
	await waitFor(() => f.events.filter(event => event === 'pause:write').length === 2, 'first resume journal pending');
	const pause = f.service.actions.pause(), second = f.service.actions.resume(); write.resolve();
	await Promise.all([first, pause, second]);
	assert.equal(f.service.snapshot.phase, 'recording');
	assert.equal(f.events.filter(event => event === 'resume:camera').length, 2);
	await f.service.actions.stop(); await f.service.dispose();
});
