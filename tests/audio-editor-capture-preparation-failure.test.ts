/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { captureSessionTransitionFixture } from './helpers/capture-session-transition-fixture.ts';

test('capture encoder failure before durable admission releases its origin instead of creating empty recovery', async () => {
	const f = captureSessionTransitionFixture();
	f.failRecorderCreation(new Error('Capture processor could not initialize'));
	await f.start().catch(() => undefined);
	await f.service.settled();
	assert.equal(f.service.snapshot.phase, 'failed');
	assert.equal(f.origin.snapshot('capture-project').active, false);
	assert.ok(f.events.includes('lease:dispose'));
	assert.equal(f.events.includes('finalize'), false);
});
