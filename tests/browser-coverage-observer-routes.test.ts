/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { browserCoverageObserverPaths, createBrowserCoverageObserverRoutes,
	captureBrowserCoverageObserverRoutes } from '../scripts/lib/browser-coverage-observer-routes.mjs';

const SPEC = 'lightscaper-develop-gpu-preview-current.spec.js';
const ORIGIN = 'http://127.0.0.1:4380';
const PATH = '/__lightscaper_develop_gpu_preview_current.js';
const SOURCE = 'export const observer = 1;\n';
function owner() {
	const value = createBrowserCoverageObserverRoutes({ testFile: `/repository/tests/browser/${SPEC}`, origin: ORIGIN });
	assert.ok(value); return value;
}

test('observer admission has exactly eight owning specs and nine fixed private paths', () => {
	for (const family of ['colors', 'geometry', 'lut', 'mask', 'optics', 'preview', 'repair', 'spatial']) {
		const paths = browserCoverageObserverPaths(`lightscaper-develop-gpu-${family}-current.spec.js`);
		assert.deepEqual(paths, [`/__lightscaper_develop_gpu_${family}_current.js`,
			...family === 'preview' ? ['/__lightscaper_gpu_mask_preview_broker_current.js'] : []]);
		assert.equal(Object.isFrozen(paths), true);
	}
	assert.equal(createBrowserCoverageObserverRoutes({ testFile: '/other.spec.js', origin: ORIGIN }), null);
});

test('only the genuine per-test owner can attest exact observed source bytes', () => {
	const value = owner(), captured = captureBrowserCoverageObserverRoutes(value);
	assert.ok(captured); const url = value.register(PATH, SOURCE);
	assert.equal(url, ORIGIN + PATH); assert.equal(captured.captures(url), true);
	assert.equal(captured.captures(ORIGIN + '/assets/editor.js'), false);
	assert.throws(() => captured.attest(url, SOURCE + 'changed'), /source|bytes/iu);
	assert.throws(() => captured.attest(url, undefined), /source|bytes/iu);
	assert.throws(() => captured.complete(), /observed|attest/iu);
	assert.equal(captured.attest(url, SOURCE), true);
	assert.equal(captured.attest(ORIGIN + '/assets/editor.js', SOURCE), false);
	assert.deepEqual(captured.complete(), [{ url, byteLength: Buffer.byteLength(SOURCE),
		sha256: createHash('sha256').update(SOURCE).digest('hex'), observed: true }]);
});

test('built, global, foreign, query, fragment and escaped route names never acquire exclusions', () => {
	for (const path of ['/assets/editor.js', '**/*', '*', '/__unknown.js', ORIGIN + PATH,
		'https://foreign.invalid' + PATH, PATH + '?v=1', PATH + '#part', PATH.replace('__', '%5f%5f'), PATH + '/..']) {
		assert.throws(() => owner().register(path, SOURCE), /route|path|observer/iu);
	}
	assert.throws(() => owner().register(PATH, ''), /source/iu);
	const colors = createBrowserCoverageObserverRoutes({ testFile: '/lightscaper-develop-gpu-colors-current.spec.js', origin: ORIGIN });
	assert.ok(colors); assert.throws(() => colors.register(PATH, SOURCE), /route|path|observer/iu);
});

test('navigation seals admission permanently while exact existing observations survive reload', () => {
	const value = owner(), captured = captureBrowserCoverageObserverRoutes(value); assert.ok(captured);
	const url = value.register(PATH, SOURCE); assert.throws(() => value.register(PATH, SOURCE), /duplicate|registered/iu);
	value.navigationStarted(); value.navigationStarted();
	assert.throws(() => value.register('/__lightscaper_gpu_mask_preview_broker_current.js', SOURCE), /navigation|late|sealed/iu);
	assert.equal(captured.attest(url, SOURCE), true); assert.equal(captured.attest(url, SOURCE), true);
	assert.equal(captured.complete().length, 1);
});

test('owners never share exclusion state and close cannot reopen registration', () => {
	const first = owner(), second = owner(); first.register(PATH, SOURCE);
	const other = captureBrowserCoverageObserverRoutes(second); assert.ok(other);
	assert.equal(other.captures(ORIGIN + PATH), false); assert.deepEqual(other.complete(), []);
	first.close(); assert.throws(() => first.register(PATH, SOURCE), /closed/iu);
});

test('forged owner objects and opaque proxies cannot install a callback exclusion', () => {
	let reads = 0; const hostile = new Proxy({}, { get() { reads++; throw Error(); }, getPrototypeOf() { reads++; throw Error(); } });
	assert.throws(() => captureBrowserCoverageObserverRoutes(hostile), /genuine|owner/iu); assert.equal(reads, 0);
	assert.throws(() => captureBrowserCoverageObserverRoutes({ captures: () => true, attest: () => true }), /genuine|owner/iu);
	assert.equal(captureBrowserCoverageObserverRoutes(null), null);
});
