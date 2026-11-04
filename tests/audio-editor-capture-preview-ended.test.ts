/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { captureSessionTransitionFixture } from './helpers/capture-session-transition-fixture.ts';

for (const armed of [false, true]) test(`ending a ${armed ? 'armed' : 'previewing'} capture source retires its stale permission lease`, async () => {
	const f = captureSessionTransitionFixture();
	await f.service.initialize(); await f.service.actions.requestPreview(['camera', 'microphone']);
	if (armed) f.service.actions.arm({ destination: 'both', countdownMs: 0 });
	f.endSource('camera');
	await f.service.settled();
	assert.equal(f.service.snapshot.phase, 'failed');
	assert.deepEqual(f.service.snapshot.sources, []);
	assert.ok(f.events.includes('lease:dispose'));
	assert.equal(f.events.includes('prepare'), false, 'an ended preview must not create an empty recovery session');
});
