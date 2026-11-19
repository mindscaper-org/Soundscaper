/* SPDX-License-Identifier: AGPL-3.0-only */

import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { compileNativeImageHandoffScript } from './helpers/lightscaper-image-handoff-native-fixture.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';
import type { runGpuHighBrokerFallbackCurrentV1 } from './helpers/lightscaper-gpu-high-broker-fallback-current.ts';

type Observation = Awaited<ReturnType<typeof runGpuHighBrokerFallbackCurrentV1>>;
// This bundled component witness does not stand in for shipped GPU UI coverage.
const coverage: Parameters<typeof test.use>[0] & Readonly<{ browserCoverage: boolean }> = { browserCoverage: false };
test.use(coverage);
const PROGRAM = '/__lightscaper_gpu_high_broker_fallback.js', BLANK = '/lightscaper/__gpu_high_broker_fallback.html';
let source: string;
test.beforeAll(async () => {
	const program = await compileNativeImageHandoffScript('gpu-high-broker-fallback.js', fileURLToPath(new URL('./helpers/lightscaper-gpu-high-broker-fallback-current.ts', import.meta.url)));
	expect(program.assets).toEqual([]); source = program.source;
});

// Every maintained engine executes the real high broker. A native refusal is
// useful only when the complete CPU recipe, output and lifetime also succeed.
for (const scene of ['mask', 'clone', 'heal'] as const) test(`${scene}: real GPU preference delivers accepted pixels or the exact complete CPU recipe on every engine`, async ({ page }) => {
	const value = await run(page, scene, false);
	expect(value.callbacks).toBe(1); expect(value.sourceUnchanged).toBe(true);
	expect(value.outputDedicated).toBe(true); expect(value.outputLiveDuringDelivery).toBe(true);
	expect(value.outputRetired).toBe(true); expect(value.oracleRetired).toBe(true); expect(value.sourceRetired).toBe(true);
	expect(value.expected).not.toEqual(value.before);
	expect(value.actual).toHaveLength(value.expected.length);
	if (value.backend === 'cpu') {
		expect(value.reason).toMatch(/^(?:canvas-unavailable|context-unavailable|float-target-unavailable|float-conformance-failed|texture-capacity|uniform-capacity|numeric-range|execution-unavailable|context-lost|mask-capability-unavailable|mask-integer-copy-unavailable|mask-integer-clear-unavailable|mask-mixed-sampler-unavailable|repair-capability-unavailable)$/u);
		expect(value.actual).toEqual(value.expected);
	} else {
		expect(value.backend).toBe('webgl2'); expect(value.reason).toBeNull();
		expect(value.nativeMismatches).toEqual([]);
	}
	await test.info().attach('actual-high-broker-delivery', { contentType: 'application/json', body: JSON.stringify(value) });
});

test('held high-broker delivery preserves the opaque primary and joins output retirement without replay on every engine', async ({ page }) => {
	const value = await run(page, 'mask', true);
	expect(value.callbacks).toBe(1); expect(value.heldPending).toBe(true); expect(value.outputLiveDuringDelivery).toBe(true);
	expect(value.exactPrimary).toBe(true); expect(value.outputRetired).toBe(true); expect(value.oracleRetired).toBe(true);
	expect(value.sourceUnchanged).toBe(true); expect(value.sourceRetired).toBe(true);
});

async function run(page: Page, scene: 'mask' | 'clone' | 'heal', held: boolean): Promise<Observation> {
	await page.route(`**${PROGRAM}`, route => route.fulfill({ contentType: 'text/javascript', body: source }));
	await page.route(`**${BLANK}`, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Actual high broker fallback</title>' }));
	await page.goto(resolveBrowserProductTestUrl(BLANK));
	return page.evaluate<Observation>(`import(${JSON.stringify(PROGRAM)}).then(module=>module.runGpuHighBrokerFallbackCurrentV1(${JSON.stringify(scene)},${String(held)}))`);
}
