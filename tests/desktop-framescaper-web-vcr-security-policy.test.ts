/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	admitFramescaperWebVcrUrl,
	cancelFramescaperWebVcrDownload,
	webVcrPopupAllowed,
} from '../desktop/framescaper-web-vcr-security-policy.ts';

test('navigation admits canonical HTTPS and the exact internal blank document only', () => {
	assert.equal(admitFramescaperWebVcrUrl('https://example.com/watch').url, 'https://example.com/watch');
	assert.equal(admitFramescaperWebVcrUrl('about:blank').url, 'about:blank');
	for (const value of [
		'http://example.com/',
		'file:///etc/passwd',
		'javascript:alert(1)',
		'about:blank#remote',
		'https://user:secret@example.com/',
		'https://example.com/\nnext',
	]) {
		assert.throws(() => admitFramescaperWebVcrUrl(value), /url|https|credential|control/iu, value);
	}
});

test('remote downloads are denied', () => {
	const event = { prevented: 0, preventDefault() { this.prevented += 1; } };
	const item = { cancelled: 0, cancel() { this.cancelled += 1; } };
	cancelFramescaperWebVcrDownload(event, item);
	assert.deepEqual({ prevented: event.prevented, cancelled: item.cancelled }, { prevented: 1, cancelled: 1 });
});

test('popup admission is HTTPS-only, idle-only, and bounded to four', () => {
	assert.equal(webVcrPopupAllowed({ url: 'https://login.example.com/', phase: 'ready', openPopupCount: 3 }), true);
	assert.equal(webVcrPopupAllowed({ url: 'https://login.example.com/', phase: 'ready', openPopupCount: 4 }), false);
	assert.equal(webVcrPopupAllowed({ url: 'https://login.example.com/', phase: 'recording', openPopupCount: 0 }), false);
	assert.equal(webVcrPopupAllowed({ url: 'http://login.example.com/', phase: 'ready', openPopupCount: 0 }), false);
});
