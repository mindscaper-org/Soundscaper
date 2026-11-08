/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createLightscaperDownloadLifetimeCurrentV1 } from '../desktop/lightscaper-download-lifetime-current-v1.ts';

test('Lightscaper close waits for every actual native download terminal event before consulting the renderer', () => {
	const owner = createLightscaperDownloadLifetimeCurrentV1();
	const callbacks: (() => void)[] = [];
	const download = { once(_name: 'done', callback: () => void) { callbacks.push(callback); } };
	owner.track(download); owner.track({ ...download }); let closes = 0;
	assert.equal(owner.deferClose(() => { closes++; }), true);
	assert.equal(owner.deferClose(() => { closes++; }), true);
	callbacks[0]!(); assert.equal(closes, 0);
	callbacks[1]!(); assert.equal(closes, 1);
	callbacks[1]!(); assert.equal(closes, 1);
	assert.equal(owner.deferClose(() => { closes++; }), false); assert.equal(closes, 1);
});

test('Lightscaper download listener failure retains no close-blocking ownership', () => {
	const owner = createLightscaperDownloadLifetimeCurrentV1(), failure = new Error('listener failed');
	assert.throws(() => owner.track({ once() { throw failure; } }), error => error === failure);
	assert.equal(owner.deferClose(() => undefined), false);
});
