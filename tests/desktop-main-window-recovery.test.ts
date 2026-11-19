/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { DesktopMainWindowClose, DesktopMainWindowRecovery } from '../desktop/main-window-recovery.ts';

for (const quitting of [false, true]) test(`renderer replacement retires the pending ${quitting ? 'quit' : 'window close'}`, () => {
	const close = new DesktopMainWindowClose();
	const requests: Array<Readonly<{ requestId: string; reason: string }>> = [];
	let prevented = 0;
	const event = { preventDefault: () => { prevented++; } };
	const send = (request: (typeof requests)[number]) => { requests.push(request); };
	if (quitting) close.beginQuit();
	close.intercept(event, true, send);
	assert.equal(close.isIntentionalShutdown, false);
	const original = requests[0]!;
	assert.equal(original.reason, quitting ? 'quit' : 'window-close');

	close.retireRenderer();
	assert.equal(close.isIntentionalShutdown, false);
	close.intercept(event, true, send);
	const replacement = requests[1]!;
	assert.equal(replacement.reason, 'window-close');
	assert.notEqual(replacement.requestId, original.requestId);
	assert.equal(close.respond({ requestId: original.requestId, allow: true }), null);
	assert.equal(close.respond({ requestId: replacement.requestId, allow: true }), 'window-close');
	assert.equal(close.isIntentionalShutdown, true);
	close.intercept(event, true, send);
	assert.equal(prevented, 2);
	assert.equal(requests.length, 2);
});

test('Quit upgrades a pending close for the same live renderer and Cancel clears that intent', () => {
	const close = new DesktopMainWindowClose();
	let requestId = '';
	const box = { preventDefault() {} };
	close.intercept(box, false, () => assert.fail('A renderer still loading cannot confirm close'));
	close.intercept(box, true, request => { requestId = request.requestId; });
	close.beginQuit();
	close.intercept(box, true, () => assert.fail('The pending request still belongs to the same renderer'));
	assert.equal(close.respond({ requestId, allow: true }), 'quit');
	close.resetForWindow();
	close.intercept(box, true, request => { requestId = request.requestId; });
	assert.equal(close.respond({ requestId, allow: false }), null);
	close.intercept(box, true, request => { assert.equal(request.reason, 'window-close'); });
});

test('unexpected renderer loss drains ownership before one trusted reload', async () => {
	const events: string[] = [];
	let releaseCleanup: (() => void) | undefined;
	const cleanupBarrier = new Promise<void>((resolve) => { releaseCleanup = resolve; });
	const recovery = new DesktopMainWindowRecovery({
		cleanup: async () => { events.push('cleanup'); await cleanupBarrier; },
		reload: async () => { events.push('reload'); },
		exit: () => { events.push('exit'); },
		reportError: () => { events.push('error'); },
	});

	const first = recovery.recover();
	const duplicate = recovery.recover();
	assert.equal(first, duplicate);
	assert.deepEqual(events, ['cleanup']);
	releaseCleanup?.();
	await first;
	assert.deepEqual(events, ['cleanup', 'reload']);
	await recovery.recover();
	assert.deepEqual(events, ['cleanup', 'reload', 'cleanup', 'reload']);
});

test('renderer cleanup or trusted reload failure exits nonzero', async () => {
	for (const failingStep of ['cleanup', 'reload'] as const) {
		const exits: number[] = [];
		const errors: unknown[] = [];
		const failure = new Error(`planned ${failingStep} failure`);
		const recovery = new DesktopMainWindowRecovery({
			cleanup: async () => { if (failingStep === 'cleanup') throw failure; },
			reload: async () => { if (failingStep === 'reload') throw failure; },
			exit: (code) => { exits.push(code); },
			reportError: (error) => { errors.push(error); },
		});
		await recovery.recover();
		assert.deepEqual(exits, [1]);
		assert.deepEqual(errors, [failure]);
	}
});
