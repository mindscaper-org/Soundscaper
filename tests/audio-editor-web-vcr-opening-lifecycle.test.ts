/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { harness, tick, deferred } from './helpers/web-vcr-controller-fixture.ts';

test('opening Web VCR again retries a dismissed capture preview without requiring Close first', async () => {
	const fixture = harness();
	const preview = fixture.capture.actions.requestPreview;
	let attempts = 0;
	fixture.capture.actions.requestPreview = async roles => {
		attempts += 1;
		if (attempts === 1) {
			fixture.capture.state.phase = 'failed';
			throw new DOMException('Capture preview was dismissed', 'NotAllowedError');
		}
		await preview(roles);
	};
	await fixture.controller.initialize();
	await assert.rejects(fixture.controller.actions.activate(), /dismissed/u);
	assert.equal(fixture.controller.snapshot.phase, 'failed');
	await fixture.controller.actions.activate();
	assert.equal(attempts, 2, 'the existing Record menu entry must request a fresh preview');
	assert.equal(fixture.capture.state.phase, 'previewing');
	assert.equal(fixture.controller.snapshot.phase, 'ready');
	assert.equal(fixture.controller.snapshot.error, null);
});

test('closing Web VCR while its guest opens retires the late guest without reopening capture', async () => {
	const opening = deferred<void>();
	const fixture = harness({ openGate: opening.promise });
	await fixture.controller.initialize();
	const activating = fixture.controller.actions.activate();
	assert.ok(fixture.calls.includes('open:1080p'));
	const closing = fixture.controller.actions.close();
	const closedPhase = fixture.controller.snapshot.phase;
	opening.resolve();
	await Promise.all([activating, closing]);
	assert.equal(fixture.capture.state.phase, 'inactive', 'Close must not launch a late permission/capture preview');
	assert.equal(closedPhase, 'closed');
	assert.equal(fixture.calls.filter(call => call === 'preview:display,system-audio').length, 0);
	assert.equal(fixture.calls.filter(call => call === 'dispose').length, 1, 'the late desktop guest must be retired');
});

test('closing Web VCR during preview authorization releases the late preview before reopening', async () => {
	const permission = deferred<void>();
	const fixture = harness();
	const preview = fixture.capture.actions.requestPreview;
	let attempts = 0;
	fixture.capture.actions.requestPreview = async roles => {
		attempts += 1;
		if (attempts === 1) {
			fixture.capture.state.phase = 'permission-pending';
			await permission.promise;
		}
		await preview(roles);
	};
	await fixture.controller.initialize();
	const activating = fixture.controller.actions.activate();
	await tick();
	assert.equal(fixture.capture.state.phase, 'permission-pending');
	const closing = fixture.controller.actions.close();
	const reopening = fixture.controller.actions.activate();
	permission.resolve();
	await Promise.all([activating, closing, reopening]);
	assert.equal(attempts, 2, 'the subsequent menu action must open a fresh capture preview');
	assert.equal(fixture.calls.filter(call => call === 'release').length, 1);
	assert.equal(fixture.calls.filter(call => call === 'dispose').length, 1);
	assert.equal(fixture.controller.snapshot.phase, 'ready');
});

test('disposing an editor while Web VCR opens retires the late guest without capture', async () => {
	const opening = deferred<void>();
	const fixture = harness({ openGate: opening.promise });
	await fixture.controller.initialize();
	const activating = fixture.controller.actions.activate();
	const disposing = fixture.controller.dispose();
	opening.resolve();
	await Promise.all([activating, disposing]);
	assert.equal(fixture.capture.state.phase, 'inactive');
	assert.equal(fixture.calls.filter(call => call === 'preview:display,system-audio').length, 0);
	assert.equal(fixture.calls.filter(call => call === 'dispose').length, 1);
});
