/* SPDX-License-Identifier: AGPL-3.0-only */

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { test, expect } from './helpers/browser-coverage-fixture.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';
import { openNativeOriginalBrowserFixtureCurrentV1 as fixture, ORIGINAL_TRANSPORT_BROWSER_ROOT_CURRENT_V1 as ROOT,
	type NativeOriginalBrowserFixtureCurrentV1 as Fixture } from './helpers/lightscaper-native-original-transport-fixture-current.ts';
type Driver = typeof import('./helpers/lightscaper-original-group-driver-current.ts');
export interface NativeOriginalGroupBrowserCaseCurrentV1 { readonly kind: 'raster'; readonly aliases: true }
const CASE: NativeOriginalGroupBrowserCaseCurrentV1 = { kind: 'raster', aliases: true };

const options: Parameters<typeof test.use>[0] & { browserCoverage: boolean } = { browserCoverage: false }; test.use(options);
const HOST = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Lightscaper Original group qualification</title></head>'
	+ '<body><main data-lightscaper-component="original-group">Native group component qualification.</main></body></html>';
let program = '';
test.beforeAll(async () => {
	const result = await build({ entryPoints: [fileURLToPath(new URL('./helpers/lightscaper-original-group-driver-current.ts', import.meta.url))],
		bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2023' });
	expect(result.outputFiles).toHaveLength(1); program = result.outputFiles[0]!.text;
});

test('Lightscaper native group independently authenticates two locators, shares one real OPFS File and joins both actual raster painters', async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium', 'Real OPFS group qualification uses Chromium.'); test.setTimeout(60_000);
	expect(test.info().config.workers).toBe(1); expect(test.info().project.retries).toBe(0);
	let native: Fixture | undefined, started = false, failed = false, primary: unknown;
	const cleanup: unknown[] = [], pageErrors: string[] = [];
	page.on('pageerror', error => { if (pageErrors.length < 8) pageErrors.push(error.message.slice(0, 1024)); });
	try {
		native = await fixture(CASE.kind, { aliases: CASE.aliases }); await native.install(page);
		await page.route(`**${ROOT}/**`, async route => {
			const path = new URL(route.request().url()).pathname;
			if (![`${ROOT}/host.html`, `${ROOT}/group-entry.js`].includes(path)) { await route.abort(); return; }
			const response = await route.fetch(), headers = response.headers(); delete headers['content-length']; delete headers['content-encoding'];
			headers['content-type'] = path.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript';
			try { await route.fulfill({ status: 200, headers, body: path.endsWith('.html') ? HOST : program }); }
			finally { await response.dispose(); }
		});
		await page.goto(resolveBrowserProductTestUrl(`/lightscaper${ROOT}/host.html`));
		await expect(page.getByRole('main')).toHaveAttribute('data-lightscaper-component', 'original-group');
		expect(await page.evaluate(() => ({ secure: isSecureContext, isolated: crossOriginIsolated }))).toEqual({ secure: true, isolated: true });
		started = true;
		await page.evaluate(async ({ root, requests }) => {
			const api = await import(new URL(`${root}/group-entry.js`, location.href).href) as Driver; api.beginOriginalGroupBrowserCurrentV1(requests);
		}, { root: ROOT, requests: native.requests });
		const status = async () => page.evaluate(async root => {
			const api = await import(new URL(`${root}/group-entry.js`, location.href).href) as Driver; return api.originalGroupBrowserStatusCurrentV1();
		}, ROOT);
		await expect.poll(async () => { const value = await status(); return value.entered || value.failed; }, { timeout: 15_000 }).toBe(true);
		expect(await status()).toEqual({ entered: true, settled: false, closed: false, failed: false, stages: 1 });
		expect(native.observations.groupsOpened).toBe(1); expect(native.observations.groupsClosed).toBe(0); expect(native.observations.opened).toBe(0);
		await native.provePinned();
		await page.evaluate(async root => { const api = await import(new URL(`${root}/group-entry.js`, location.href).href) as Driver;
			api.requestOriginalGroupBrowserCloseCurrentV1(); }, ROOT);
		expect(await status()).toEqual({ entered: true, settled: false, closed: false, failed: false, stages: 1 });
		expect(native.observations.groupsClosed).toBe(0);
		const result = await page.evaluate(async root => { const api = await import(new URL(`${root}/group-entry.js`, location.href).href) as Driver;
			return api.finishOriginalGroupBrowserCurrentV1(); }, ROOT);
		expect(result.files).toEqual(native.requests.map(() => ({ genuine: true, size: native!.byteLength, sha256: native!.sha256 })));
		expect(result.uniqueFiles).toBe(1); expect(result.wiped).toBe(true); expect(result.pixels).toEqual([native.pixels, native.pixels]);
		expect(await status()).toEqual({ entered: true, settled: true, closed: true, failed: false, stages: 0 });
		expect(native.observations.groupsClosed).toBe(1);
		expect(native.observations.groupRanges).toEqual([0, 1].flatMap(index => [[index, 0, 1024 * 1024], [index, 1024 * 1024, native!.byteLength - 1024 * 1024]]));
		await native.proveReleased(); expect(pageErrors).toEqual([]);
	} catch (error) { failed = true; primary = error; }
	let browserRetired = !started;
	if (started) try { await page.evaluate(async root => { const api = await import(new URL(`${root}/group-entry.js`, location.href).href) as Driver;
		await api.finishOriginalGroupBrowserCurrentV1(); }, ROOT); browserRetired = true; } catch (error) { cleanup.push(error); }
	if (native) try { if (browserRetired) await native.close(); else await native.retireNative(); } catch (error) { cleanup.push(error); }
	if (cleanup.length) throw new AggregateError([...(failed ? [primary] : []), ...cleanup], 'Native group/browser cleanup failed; unproved browser files retained.');
	if (failed) throw primary;
});
