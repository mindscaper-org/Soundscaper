/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createEditorNotificationSession } from '../src/common/editor/controller/composition/editor-notification-session.ts';
import { createToastCountdown } from '../src/common/editor/controller/composition/toast-countdown.ts';

test('notification history retains text without project action callbacks and stays bounded', () => {
	const session = createEditorNotificationSession();
	const first = { key: 'first', title: 'First', type: 'info' as const, description: 'Imported', actions: [{ onClick() { throw new Error('stale action'); } }] };
	session.record(first);
	assert.deepEqual(session.getSnapshot().history, [{ key: 'first', title: 'First', type: 'info', description: 'Imported' }]);
	session.record({ ...first, description: 'Finished' });
	assert.equal(session.getSnapshot().history.length, 1);
	assert.equal(session.getSnapshot().history[0]?.description, 'Finished');
	for (let index = 0; index < 110; index += 1) session.record({ key: String(index), title: String(index), type: 'info' });
	assert.equal(session.getSnapshot().history.length, 100);
	assert.equal(session.getSnapshot().history[0]?.key, '109');
	session.clear();
	assert.deepEqual(session.getSnapshot().history, []);
});

test('mute suppresses informational popups while errors, actions, progress and persistent notices remain available', () => {
	const session = createEditorNotificationSession();
	session.setMuted(true);
	assert.equal(session.shouldShow({ type: 'info' }), false);
	assert.equal(session.shouldShow({ type: 'warning' }), false);
	assert.equal(session.shouldShow({ type: 'error' }), true);
	assert.equal(session.shouldShow({ type: 'info', actionable: true }), true);
	assert.equal(session.shouldShow({ type: 'info', progress: true }), true);
	assert.equal(session.shouldShow({ type: 'warning', persistent: true }), true);
	assert.equal(createEditorNotificationSession().getSnapshot().muted, false);
	session.setMuted(false);
	assert.equal(session.shouldShow({ type: 'warning' }), true);
});

test('notification subscriptions publish only changes and can unsubscribe', () => {
	const session = createEditorNotificationSession();
	let calls = 0;
	const stop = session.subscribe(() => { calls += 1; });
	const original = session.getSnapshot();
	session.setMuted(false);
	assert.equal(session.getSnapshot(), original);
	session.record({ key: 'a', title: 'One', type: 'info' });
	session.record({ key: 'a', title: 'One', type: 'info' });
	assert.equal(calls, 1);
	stop();
	session.setMuted(true);
	assert.equal(calls, 1);
});

test('toast countdown preserves the remaining reading time over repeated pauses and disposes safely', (context) => {
	context.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
	let expirations = 0;
	const countdown = createToastCountdown({
		duration: 10_000, now: Date.now,
		schedule: (callback, delay) => setTimeout(callback, delay), cancel: clearTimeout,
		onExpire: () => { expirations += 1; },
	});
	context.mock.timers.tick(4_000);
	countdown.setPaused(true);
	context.mock.timers.tick(20_000);
	assert.equal(expirations, 0);
	countdown.setPaused(false);
	context.mock.timers.tick(2_000);
	countdown.setPaused(true);
	context.mock.timers.tick(30_000);
	countdown.setPaused(false);
	context.mock.timers.tick(3_999);
	assert.equal(expirations, 0);
	context.mock.timers.tick(1);
	assert.equal(expirations, 1);
	countdown.setPaused(true);
	countdown.setPaused(false);
	context.mock.timers.tick(10_000);
	assert.equal(expirations, 1);
	countdown.dispose();
	countdown.dispose();
});

test('disposing a paused or running countdown prevents later callbacks', (context) => {
	context.mock.timers.enable({ apis: ['setTimeout'] });
	for (const paused of [false, true]) {
		const countdown = createToastCountdown({ duration: 10_000, now: Date.now,
			schedule: (callback, delay) => setTimeout(callback, delay), cancel: clearTimeout,
			onExpire: () => assert.fail('disposed toast expired'),
		});
		countdown.setPaused(paused);
		countdown.dispose();
		countdown.setPaused(false);
	}
	context.mock.timers.tick(30_000);
});
