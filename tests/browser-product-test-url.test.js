/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	BROWSER_PRODUCT_ORIGINS_VARIABLE,
	resolveBrowserProductTestUrl,
} from './browser/helpers/browser-product-test-url.js';

const PRODUCT_ORIGINS = JSON.stringify({
	soundscaper: 'http://127.0.0.1:4322',
	framescaper: 'http://127.0.0.1:4323',
});

test('ordinary browser helpers route each legacy product path to its real origin', () => {
	const environment = { [BROWSER_PRODUCT_ORIGINS_VARIABLE]: PRODUCT_ORIGINS };
	assert.equal(
		resolveBrowserProductTestUrl('/framescaper/embed/de/?project=project-1', environment),
		'http://127.0.0.1:4323/embed/de/?project=project-1',
	);
	assert.equal(
		resolveBrowserProductTestUrl('/embed/en/', environment),
		'http://127.0.0.1:4322/embed/en/',
	);
	assert.equal(
		resolveBrowserProductTestUrl('https://127.0.0.1:4999/embed/en/', environment),
		'https://127.0.0.1:4999/embed/en/',
		'explicit dual-origin and packaged-runtime URLs must remain authoritative',
	);
});

test('non-ordinary Playwright configurations retain their own relative paths', () => {
	assert.equal(resolveBrowserProductTestUrl('/framescaper/de/', {}), '/framescaper/de/');
	assert.throws(
		() => resolveBrowserProductTestUrl('/en/', { [BROWSER_PRODUCT_ORIGINS_VARIABLE]: '{}' }),
		/must name.*loopback product origin/u,
	);
});

test('a single-product run routes its own paths and rejects an unselected peer', () => {
	const frames = { [BROWSER_PRODUCT_ORIGINS_VARIABLE]: JSON.stringify({ framescaper: 'http://127.0.0.1:4323' }) };
	assert.equal(resolveBrowserProductTestUrl('/framescaper/en/', frames), 'http://127.0.0.1:4323/en/');
	assert.throws(() => resolveBrowserProductTestUrl('/en/', frames), /soundscaper.*not selected/u);
	const sound = { [BROWSER_PRODUCT_ORIGINS_VARIABLE]: JSON.stringify({ soundscaper: 'http://127.0.0.1:4322' }) };
	assert.equal(resolveBrowserProductTestUrl('/en/', sound), 'http://127.0.0.1:4322/en/');
	assert.throws(() => resolveBrowserProductTestUrl('/framescaper/en/', sound), /framescaper.*not selected/u);
	assert.throws(() => resolveBrowserProductTestUrl('/en/', { [BROWSER_PRODUCT_ORIGINS_VARIABLE]: '{"other":"http://127.0.0.1:4322"}' }), /unknown product/u);
});
