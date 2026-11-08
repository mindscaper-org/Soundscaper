/* SPDX-License-Identifier: AGPL-3.0-only */

import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';
import { openNativeOriginalBrowserFixtureCurrentV1, ORIGINAL_TRANSPORT_BROWSER_ROOT_CURRENT_V1 as ROOT,
	type NativeOriginalBrowserFixtureCurrentV1, type NativeOriginalBrowserKindCurrentV1 } from './helpers/lightscaper-native-original-transport-fixture-current.ts';
import type { OriginalTransportBrowserFactsCurrentV1 } from './helpers/lightscaper-native-original-transport-driver-current.ts';
type Driver = typeof import('./helpers/lightscaper-native-original-transport-driver-current.ts');
export interface NativeOriginalBrowserCaseCurrentV1 { readonly kind: NativeOriginalBrowserKindCurrentV1; readonly facts: OriginalTransportBrowserFactsCurrentV1 }

// Actual native-storage/browser component qualification through an explicit
// bounded Playwright transport seam. This is not preload IPC, menu activation,
// selected Session composition or full restore qualification.
const coverageOptions: Parameters<typeof test.use>[0] & Readonly<{ browserCoverage: boolean }> = { browserCoverage: false };
test.use(coverageOptions);
let entryProgram = '', workerProgram = '', wasm = new Uint8Array(0);
const HOST_HTML = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Lightscaper native Original component qualification</title></head>'
	+ '<body><main data-lightscaper-component="native-original-transport">Native Original component qualification; no editor or Session activation.</main></body></html>';
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

test.beforeAll(async () => {
	const manifest = JSON.parse(await readFile(new URL('../../config/lightscaper-libraw-runtime-manifest.json', import.meta.url), 'utf8')) as {
		runtime: { path: string; byteLength: number; sha256: string };
	};
	wasm = new Uint8Array(await readFile(new URL(`../../${manifest.runtime.path}`, import.meta.url)));
	expect(wasm.byteLength).toBe(manifest.runtime.byteLength); expect(sha(wasm)).toBe(manifest.runtime.sha256);
	const [entry, worker] = await Promise.all([
		build({ entryPoints: [fileURLToPath(new URL('./helpers/lightscaper-native-original-transport-driver-current.ts', import.meta.url))],
			bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2023' }),
		build({ entryPoints: [fileURLToPath(new URL('../../src/common/editor/raw/libraw-worker-v1.ts', import.meta.url))],
			bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2023' }),
	]);
	expect(entry.outputFiles).toHaveLength(1); expect(worker.outputFiles).toHaveLength(1);
	entryProgram = entry.outputFiles[0]!.text; workerProgram = worker.outputFiles[0]!.text;
});

for (const kind of ['raster', 'raw'] as const) test(`Lightscaper native ${kind} Original crosses real tickets into an OPFS File and keeps its decoder consumer lease`, async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium', 'This component slice qualifies real Chromium OPFS and native decoders.');
	test.setTimeout(120_000);
	expect(test.info().config.workers).toBe(1); expect(test.info().project.retries).toBe(0);
	let fixture: NativeOriginalBrowserFixtureCurrentV1 | undefined, started = false, failed = false, primary: unknown;
	const failures: unknown[] = [], pageErrors: string[] = [], forbiddenRuntimeRequests: string[] = [];
	page.on('pageerror', error => { if (pageErrors.length < 8) pageErrors.push(error.message.slice(0, 1024)); });
	page.on('request', request => { if (request.url().startsWith('https://assets.soundscaper.org/runtime/libraw/')) forbiddenRuntimeRequests.push(request.url()); });
	try {
		fixture = await openNativeOriginalBrowserFixtureCurrentV1(kind); const native = fixture;
		await native.install(page);
		await page.route(`**${ROOT}/**`, async route => {
			const path = new URL(route.request().url()).pathname;
			if (![`${ROOT}/host.html`, `${ROOT}/entry.js`, `${ROOT}/worker.js`, `${ROOT}/libraw.wasm`].includes(path)) { await route.abort(); return; }
			const response = await route.fetch(), headers = response.headers(); delete headers['content-length']; delete headers['content-encoding'];
			headers['content-type'] = path.endsWith('.html') ? 'text/html; charset=utf-8' : path.endsWith('.wasm') ? 'application/wasm' : 'text/javascript';
			try { await route.fulfill({ status: 200, headers, body: path.endsWith('/host.html') ? HOST_HTML : path.endsWith('/entry.js') ? entryProgram : path.endsWith('/worker.js') ? workerProgram : Buffer.from(wasm) }); }
			finally { await response.dispose(); }
		});
		await page.goto(resolveBrowserProductTestUrl(`/lightscaper${ROOT}/host.html`));
		await expect(page.getByRole('main')).toHaveAttribute('data-lightscaper-component', 'native-original-transport');
		expect(await page.evaluate(() => ({ secure: isSecureContext, isolated: crossOriginIsolated, opfs: typeof navigator.storage.getDirectory })))
			.toEqual({ secure: true, isolated: true, opfs: 'function' });
		started = true;
		await page.evaluate(async ({ root, request, mode }) => {
			const api = await import(new URL(`${root}/entry.js`, location.href).href) as Driver;
			api.beginNativeOriginalBrowserCurrentV1(request, mode, { worker: new URL(`${root}/worker.js`, location.href).href,
				wasm: new URL(`${root}/libraw.wasm`, location.href).href });
		}, { root: ROOT, request: native.request, mode: kind as NativeOriginalBrowserKindCurrentV1 });
		const status = async () => await page.evaluate(async root => {
			const api = await import(new URL(`${root}/entry.js`, location.href).href) as Driver; return await api.nativeOriginalBrowserStatusCurrentV1();
		}, ROOT);
		await expect.poll(async () => { const value = await status(); return value.entered || value.failed; }, { timeout: 60_000 }).toBe(true);
		expect(await status()).toEqual({ entered: true, settled: false, closed: false, stages: 1, failed: false });
		expect(native.observations.opened).toBe(1); expect(native.observations.closed).toBe(0);
		await native.provePinned();
		await page.evaluate(async root => {
			const api = await import(new URL(`${root}/entry.js`, location.href).href) as Driver; api.requestNativeOriginalBrowserCloseCurrentV1();
		}, ROOT);
		expect(await status()).toEqual({ entered: true, settled: false, closed: false, stages: 1, failed: false });
		expect(native.observations.closed).toBe(0);
		const result: NativeOriginalBrowserCaseCurrentV1['facts'] = await page.evaluate(async root => {
			const api = await import(new URL(`${root}/entry.js`, location.href).href) as Driver; return await api.finishNativeOriginalBrowserCurrentV1();
		}, ROOT);
		expect(result.file).toEqual({ genuine: true, name: 'body.bin', size: native.byteLength, sha256: native.sha256 });
		expect(result.wiped).toBe(true); expect(result.alphaOpaque).toBe(true); expect(result.orientation).toBe(1);
		expect(await status()).toEqual({ entered: true, settled: true, closed: true, stages: 0, failed: false });
		expect(native.observations.closed).toBe(1);
		if (kind === 'raster') {
			expect(result.descriptor).toEqual({ schemaVersion: 1, width: 2, height: 2, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' });
			expect(result.firstPixels).toEqual(native.pixels); expect(result.nativeWords).toBe(false);
			expect(result.runtimeVersion).toMatch(/^(?:webcodecs-image-decoder-v1|create-image-bitmap-v1)$/u);
			expect(result.workers).toEqual({ created: 0, terminated: 0, activeAtConsumer: 0 });
			expect(native.observations.ranges).toEqual([[0, 1024 * 1024], [1024 * 1024, native.byteLength - 1024 * 1024]]);
		} else {
			expect(result.descriptor).toEqual({ schemaVersion: 1, width: 32, height: 32, sampleFormat: 'unorm16', primaries: 'srgb', transfer: 'linear' });
			expect(result.runtimeVersion).toBe('libraw-0.22.2'); expect(result.nativeWords).toBe(true);
			expect(result.workers).toEqual({ created: 1, terminated: 1, activeAtConsumer: 0 });
			for (let channel = 0; channel < 3; channel++) {
				expect(result.low[channel]!).toBeGreaterThan(0); expect(result.high[channel]!).toBeGreaterThan(result.low[channel]!);
				expect(result.high[channel]! - result.low[channel]!).toBeLessThanOrEqual(64);
				expect(Math.floor(result.high[channel]! / 257)).toBe(Math.floor(result.low[channel]! / 257));
			}
			expect(result.blue[2]!).toBeGreaterThan(result.blue[0]!); expect(result.red[0]!).toBeGreaterThan(result.red[2]!);
			expect(native.observations.ranges).toEqual([[0, native.byteLength]]);
		}
		await native.proveReleased(); expect(pageErrors).toEqual([]); expect(forbiddenRuntimeRequests).toEqual([]);
	} catch (error) { failed = true; primary = error; }
	let browserRetired = !started;
	if (started) {
		try { await page.evaluate(async root => {
			const api = await import(new URL(`${root}/entry.js`, location.href).href) as Driver; await api.finishNativeOriginalBrowserCurrentV1();
		}, ROOT); browserRetired = true; } catch (error) { failures.push(error); }
	}
	if (fixture) try { if (browserRetired) await fixture.close(); else await fixture.retireNative(); } catch (error) { failures.push(error); }
	if (failures.length) throw new AggregateError([...(failed ? [primary] : []), ...failures], 'Native/browser Original qualification cleanup failed; unproved browser files retained.');
	if (failed) throw primary;
});
