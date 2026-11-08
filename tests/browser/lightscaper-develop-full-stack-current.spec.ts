/* SPDX-License-Identifier: AGPL-3.0-only */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';
import { test, expect } from './helpers/browser-coverage-fixture.js';
import { requireNativeGpuCapabilityCurrentV1 } from './helpers/lightscaper-native-gpu-capability-current.ts';
import { compileNativeImageHandoffScript } from './helpers/lightscaper-image-handoff-native-fixture.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';
import type { runFullStackCurrentV1, runFullStackFallbackCurrentV1 } from './helpers/lightscaper-develop-full-stack-current-reference.ts';
import type { FullStackModeCurrentV1, FullStackFaultCurrentV1 } from './helpers/lightscaper-develop-full-stack-scene-current.ts';

const coverage: Parameters<typeof test.use>[0] & Readonly<{ browserCoverage: boolean }> = { browserCoverage: false };
test.use(coverage);
const PROGRAM = '/__lightscaper_develop_full_stack_current.js', HOST = '/lightscaper/__develop_full_stack_current.html';
type Compiled = Awaited<ReturnType<typeof compileNativeImageHandoffScript>>;
type Result = Awaited<ReturnType<typeof runFullStackCurrentV1>>;
let compiled: Compiled;
const workers: { pathname: string; compiled: Compiled }[] = [];
const runtimes: { url: string; bytes: Buffer }[] = [];

test.beforeAll(async () => {
	compiled = await compileNativeImageHandoffScript('develop-full-stack-current.js', fileURLToPath(new URL('./helpers/lightscaper-develop-full-stack-current-reference.ts', import.meta.url)));
	expect(compiled.assets).toEqual([]);
	for (const version of [1, 2]) {
		const name = `libraw-worker-v${version}.ts`;
		const actual = await compileNativeImageHandoffScript(`full-stack-libraw-worker-v${version}.js`, fileURLToPath(new URL(`../../src/common/editor/raw/${name}`, import.meta.url)));
		expect(actual.assets).toEqual([]); workers.push({ pathname: `/${name}`, compiled: actual });
	}
	for (const name of ['lightscaper-libraw-runtime-manifest.json', 'lightscaper-libraw-recovery-runtime-manifest.json']) {
		const manifest: unknown = JSON.parse(await readFile(new URL(`../../config/${name}`, import.meta.url), 'utf8'));
		if (!manifest || typeof manifest !== 'object' || !('runtime' in manifest)) throw new TypeError('Pinned RAW runtime manifest is missing.');
		const runtime = manifest.runtime;
		if (!runtime || typeof runtime !== 'object' || !('path' in runtime) || !('url' in runtime) || !('byteLength' in runtime) || !('sha256' in runtime)
			|| typeof runtime.path !== 'string' || typeof runtime.url !== 'string') throw new TypeError('Pinned RAW runtime identity is missing.');
		const bytes = await readFile(new URL(`../../${runtime.path}`, import.meta.url));
		expect(bytes.byteLength).toBe(runtime.byteLength); expect(createHash('sha256').update(bytes).digest('hex')).toBe(runtime.sha256);
		runtimes.push({ url: runtime.url, bytes });
	}
});

test.afterAll(() => { for (const runtime of runtimes) runtime.bytes.fill(0); runtimes.length = 0; workers.length = 0; });

async function host(page: Page) {
	const workerUrls: string[] = [];
	page.on('worker', worker => { workerUrls.push(new URL(worker.url()).pathname); });
	await page.route(`**${PROGRAM}`, route => route.fulfill({ contentType: 'text/javascript', body: compiled.source }));
	for (const worker of workers) await page.route(`**${worker.pathname}`, async route => {
		const response = await route.fetch(), headers = response.headers();
		delete headers['content-length']; delete headers['content-encoding']; headers['content-type'] = 'text/javascript';
		try { await route.fulfill({ status: 200, headers, body: worker.compiled.source }); }
		finally { await response.dispose(); }
	});
	for (const runtime of runtimes) await page.route(runtime.url, route => route.fulfill({ contentType: 'application/wasm',
		headers: { 'access-control-allow-origin': '*' }, body: runtime.bytes }));
	const hostUrl = resolveBrowserProductTestUrl(HOST);
	await page.route(hostUrl, async route => {
		const response = await route.fetch(), headers = response.headers();
		delete headers['content-length']; delete headers['content-encoding']; headers['content-type'] = 'text/html';
		try { await route.fulfill({ status: 200, headers, body: '<!doctype html><title>Current Develop full-stack component conformance</title>' }); }
		finally { await response.dispose(); }
	});
	await page.goto(hostUrl);
	return workerUrls;
}

async function run(page: Page, mode: FullStackModeCurrentV1, fault: FullStackFaultCurrentV1 = 'none', colorControl = false) {
	if (fault === 'none' || fault === 'held-consumer-abort') await requireNativeGpuCapabilityCurrentV1(page, test.info());
	const workerUrls = await host(page);
	const result = await page.evaluate<Result>(`import(${JSON.stringify(PROGRAM)}).then(module => module.runFullStackCurrentV1(${JSON.stringify(mode)}, ${JSON.stringify(fault)}, ${JSON.stringify(colorControl)}))`);
	await test.info().attach('full-stack-small-observation', { contentType: 'application/json', body: JSON.stringify({ browser: page.context().browser()?.version(), workerUrls, result }) });
	expect(workerUrls).toEqual([mode === 'canonical' ? '/libraw-worker-v1.ts' : '/libraw-worker-v2.ts']);
	expect(result.rawFlip).toBe(6); expect(result.encodedUnchanged).toBe(true); expect(result.sourceUnchanged).toBe(true); expect(result.recipeUnchanged).toBe(true);
	expect(result.sourceRetired).toBe(true); expect(result.cpuRetired).toBe(true); expect(result.outputRetired).toBe(true); expect(result.overlayRetired).toBe(true);
	expect(result.resources.active).toBe(0); expect(result.resources.retired).toBe(true); expect(result.resources.calls).toBeGreaterThan(0);
	expect(result.observation?.alive).toBe(0); expect(result.observation?.nativeScratchRetired).toBe(true);
	return result;
}

function gpu(result: Result, page: Page) {
	expect(result.delivery?.backend).toBe('webgl2'); expect(result.delivery?.reason).toBeNull(); expect(result.delivery?.actualReadback).toBe(true);
	expect(result.delivery?.comparison.mismatches, JSON.stringify(result.delivery?.comparison)).toBe(0);
	expect(result.delivery?.overlayMatches).toBe(true); expect(result.delivery?.overlayNonconstant).toBe(true);
	expect(result.delivery?.resourcesAtDelivery).toBe(0); expect(result.delivery?.handlesAtDelivery).toBeGreaterThan(0);
	expect(result.observation?.draws).toBeGreaterThan(0); expect(result.observation?.reads).toBeGreaterThan(0);
	expect(result.delivery?.attemptedComparison?.mismatches).toBe(0);
	expect(result.observation?.floatUploads).toBeGreaterThan(0);
	const renderers = result.observation?.renderers ?? []; expect(renderers.length).toBeGreaterThan(0);
	if (test.info().project.name === 'lightscaper-software-gpu' && page.context().browser()?.browserType().name() === 'chromium') for (const renderer of renderers) expect(renderer).toContain('SwiftShader');
}

function complete(result: Result, page: Page) {
	expect(result.observation?.optics.length).toBeGreaterThan(0); expect(result.observation?.spatial.length).toBeGreaterThan(0);
	if (result.delivery?.backend === 'webgl2') { gpu(result, page); return; }
	// A real final native readback must independently fail the unchanged pixel
	// contract before the broker delivers one exact whole-recipe CPU fallback.
	expect(result.delivery?.backend).toBe('cpu'); expect(result.delivery?.reason).toBe('numeric-range');
	expect(result.delivery?.attemptedComparison?.mismatches).toBeGreaterThan(0);
	expect(result.delivery?.exactComparison.mismatches).toBe(0);
	expect(result.delivery?.actualReadback).toBe(false); expect(result.delivery?.handlesAtDelivery).toBe(0);
	expect(result.delivery?.resourcesAtDelivery).toBe(0); expect(result.delivery?.overlayMatches).toBe(true); expect(result.delivery?.overlayNonconstant).toBe(true);
}

for (const mode of ['canonical', 'headroom', 'recovery'] as const) test(`Current4 ${mode}: genuine RAW plus the complete ordered stack and guarded delivery`, async ({ page }) => {
	test.setTimeout(30_000);
	const result = await run(page, mode); expect(result.rejected).toBe(false); expect(result.callbacks).toBe(1); complete(result, page);
	expect([result.delivery?.width, result.delivery?.height]).toEqual(mode === 'canonical' ? [24, 24] : [96, 72]);
	if (mode !== 'canonical') expect(result.exposureScale).toBeGreaterThan(1);
	else for (const name of ['withoutRepair', 'withoutMasks', 'reordered']) expect(result.alternatives[name], name).toBeGreaterThan(0);
});

test('Current4 genuine RAW, Clone, color, LUT, masks and geometry deliver actual GPU pixels', async ({ page }) => {
	test.setTimeout(30_000);
	const result = await run(page, 'canonical', 'none', true);
	expect(result.rejected).toBe(false); expect(result.callbacks).toBe(1); gpu(result, page);
	for (const name of ['withoutRepair', 'withoutMasks', 'reordered']) expect(result.alternatives[name], name).toBeGreaterThan(0);
});

test('Current4 numerical repair boundary falls back once to the EXACT entire CPU recipe', async ({ page }) => {
	test.setTimeout(30_000); await requireNativeGpuCapabilityCurrentV1(page, test.info()); await host(page);
	const result = await page.evaluate<Awaited<ReturnType<typeof runFullStackFallbackCurrentV1>>>(`import(${JSON.stringify(PROGRAM)}).then(module => module.runFullStackFallbackCurrentV1())`);
	await test.info().attach('full-stack-exact-fallback', { contentType: 'application/json', body: JSON.stringify(result) });
	expect(result.calls).toBe(1); expect(result.delivery.backend).toBe('cpu'); expect(result.delivery.reason).toBe('numeric-range');
	expect(result.delivery.comparison.mismatches, JSON.stringify(result.delivery.comparison)).toBe(0);
	expect(result.delivery.overlayMatches).toBe(true); expect(result.delivery.actualReadback).toBe(false); expect(result.delivery.handlesAtDelivery).toBe(0);
	expect(result.observation.draws).toBeGreaterThan(0); expect(result.observation.alive).toBe(0); expect(result.observation.nativeScratchRetired).toBe(true); expect(result.outputRetired).toBe(true);
});

for (const fault of ['corrupt-lut', 'corrupt-brush'] as const) test(`complete Current4 refuses ${fault} without delivering or replaying a consumer`, async ({ page }) => {
	test.setTimeout(30_000); const result = await run(page, 'canonical', fault);
	expect(result.rejected).toBe(true); expect(result.callbacks).toBe(0); expect(result.delivery).toBeNull();
});

test('combined Current4 joins a held resource before exact opaque cancellation settles', async ({ page }) => {
	test.setTimeout(30_000); const result = await run(page, 'canonical', 'held-resource-abort');
	expect(result.rejected).toBe(true); expect(result.exactReason).toBe(true); expect(result.callbacks).toBe(0); expect(result.pendingAtCancel).toBe(true);
});

test('combined Current4 keeps delivered output live through the held consumer then joins cancellation and wipe', async ({ page }) => {
	test.setTimeout(30_000); const result = await run(page, 'canonical', 'held-consumer-abort');
	expect(result.rejected).toBe(true); expect(result.exactReason).toBe(true); expect(result.callbacks).toBe(1);
	expect(result.pendingAtCancel).toBe(true); expect(result.heldOutputLive).toBe(true); complete(result, page);
});
