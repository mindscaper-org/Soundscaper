/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { captureSessionTransitionFixture } from './helpers/capture-session-transition-fixture.ts';

test('capture Resume storage failure stops every stream and retains recoverable ownership', async () => {
	const f = captureSessionTransitionFixture();
	await f.start(); await f.service.actions.pause();
	const failure = new DOMException('Storage is full', 'QuotaExceededError');
	f.failPauseStorage(failure);
	await assert.rejects(f.service.actions.resume(), error => error === failure);
	await f.service.settled();
	assert.equal(f.service.snapshot.phase, 'recovery');
	assert.ok(f.events.includes('stop:camera'));
	assert.ok(f.events.includes('stop:microphone'));
	assert.ok(f.events.includes('lease:dispose'));
	assert.equal(f.origin.snapshot('capture-project').editBlocked, true);
	await f.service.actions.discard();
});

test('a capture recorder failing Pause cannot leave a partly paused live session', async () => {
	const f = captureSessionTransitionFixture();
	await f.start();
	const failure = new Error('Camera encoder is no longer running');
	f.failPauseRecorder(failure);
	await assert.rejects(f.service.actions.pause(), error => error === failure);
	await f.service.settled();
	assert.equal(f.service.snapshot.phase, 'recovery');
	assert.ok(f.events.includes('lease:dispose'));
	await f.service.actions.discard();
});
