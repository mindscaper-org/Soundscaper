/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createMicrophoneMeterReplacement } from '../src/common/editor/controller/recording/internal/microphone-meter-replacement.ts';
import { deferred } from './helpers/async-test-control.ts';

test('older awaited failure cleanup cannot release a newer native input replacement barrier', async () => {
	const entered = deferred<void>(), release = deferred<void>();
	let resumed = 0;
	const owner = createMicrophoneMeterReplacement({ suspend() {},
		resume: async () => { resumed++; }, fail: async () => { entered.resolve(); await release.promise; }, cancel() {},
	});
	const first = owner.begin(), failed = first.finish('failed');
	await entered.promise;
	const latest = owner.begin();
	let settled = false;
	const waiting = owner.settled().then(() => { settled = true; });
	release.resolve(); await failed; await setImmediate();
	assert.equal(owner.pending, true);
	assert.equal(settled, false, 'only the new attachment can release its waiting Enable');
	await latest.finish('ready'); await waiting;
	assert.equal(settled, true); assert.equal(resumed, 1);
});

test('disposal releases a superseded input replacement without resurrecting its meter', async () => {
	let resumed = 0;
	const owner = createMicrophoneMeterReplacement({ suspend() {}, resume: async () => { resumed++; }, fail: async () => undefined, cancel() {} });
	const pending = owner.begin(); await pending.finish('superseded');
	const waiting = owner.settled(); owner.dispose(); await waiting;
	await pending.finish('ready');
	assert.equal(resumed, 0); assert.equal(owner.pending, false);
});

for (const superseded of [false, true]) test(`ready disposal receipt retires only its still-current native route, superseded=${superseded}`, async () => {
	let cancelled = 0, resumed = 0;
	const owner = createMicrophoneMeterReplacement({ suspend() {}, resume: async () => { resumed++; }, fail: async () => undefined,
		cancel: () => { cancelled++; } });
	const first = owner.begin(); await first.finish('ready');
	const latest = superseded ? owner.begin() : null;
	await first.finish('disposed');
	assert.equal(cancelled, superseded ? 0 : 1);
	assert.equal(owner.pending, superseded);
	if (latest) { await latest.finish('disposed'); assert.equal(cancelled, 1); }
	assert.equal(resumed, 1);
});
