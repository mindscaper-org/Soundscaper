/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LightscaperNativePhotoSessionCallsCurrentV1 as Calls } from '../desktop/lightscaper-native-photo-session-calls-current-v1.ts';

void test('Lightscaper Session close retires an escape registered by an actually pending accepted factory', { timeout: 15_000 }, async context => {
	const calls = new Calls(() => undefined); let release!: () => void, retired = 0;
	const held = new Promise<void>(resolve => { release = resolve; });
	context.signal.addEventListener('abort', () => { release(); }, { once: true });
	const opening = calls.run(async () => { await held; calls.own(async () => { retired++; }); });
	const closing = calls.close();
	try { release(); await opening; await closing; assert.equal(retired, 1); }
	finally { release(); await Promise.allSettled([opening, closing]); }
});

void test('Lightscaper Session terminal retirement unregisters only its owned completed escape', { timeout: 15_000 }, async () => {
	const calls = new Calls(() => undefined); let completed = 0, live = 0;
	const unregister = calls.own(async () => { completed++; });
	calls.own(async () => { live++; });
	assert.equal(typeof unregister, 'function'); unregister(); unregister();
	const closing = calls.close(); assert.equal(calls.close(), closing); await closing;
	assert.equal(completed, 0); assert.equal(live, 1);
});
