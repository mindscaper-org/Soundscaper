/* SPDX-License-Identifier: AGPL-3.0-only */

import { fileURLToPath } from 'node:url';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { requireNativeGpuCapabilityCurrentV1 } from './helpers/lightscaper-native-gpu-capability-current.ts';
import { compileNativeImageHandoffScript } from './helpers/lightscaper-image-handoff-native-fixture.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';

test.use({ browserCoverage: false });
test.beforeEach(async ({ page }, info) => { await requireNativeGpuCapabilityCurrentV1(page, info); });
const PROGRAM = '/__lightscaper_mask_numeric_refusal.js', BLANK = '/lightscaper/__mask_numeric_refusal_blank.html';
let compiled;
test.beforeAll(async () => {
	compiled = await compileNativeImageHandoffScript('mask-numeric-refusal.js', fileURLToPath(new URL('./helpers/lightscaper-native-gpu-mask-numeric-refusal-current-reference.ts', import.meta.url)));
	expect(compiled.assets).toEqual([]);
});

test('actual high broker proves q128 precision after native masked draw and delivers once, with pinned software refusal', async ({ page }) => {
	test.setTimeout(60_000);
	await page.route(`**${PROGRAM}`, route => route.fulfill({ contentType: 'text/javascript', body: compiled.source }));
	await page.route(`**${BLANK}`, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Native masked broker precision refusal</title>' }));
	await page.goto(resolveBrowserProductTestUrl(BLANK));
	const value = await page.evaluate(`import(${JSON.stringify(PROGRAM)}).then(module=>module.runMaskNumericRefusalCurrentV1())`);
	// Independent binary32 literal: roundFloat32(1+(128/255)*(-1-1))=-1/255.
	// Native F32 opacity arithmetic historically differs by127ULP on the pinned
	// software/Firefox corpus. The production8ULP guard must select full CPU.
	const RGB = 0xbb808081, expected = [RGB, RGB, RGB, 0x3ec00000, RGB, RGB, RGB, 0x3f000000, RGB, RGB, RGB, 0x3f800000];
	const native = value.atDelivery;
	const nativeMismatch = native.nativeReads.some(read => read.bits.some((word, at) => at % 4 !== 3 && Math.abs(rank(word) - rank(expected[at])) > 8));
	const pinned = test.info().project.name === 'lightscaper-software-gpu';
	if (pinned) expect(nativeMismatch).toBe(true);
	if (nativeMismatch) {
		expect(value.backend).toBe('cpu'); expect(value.reason).toBe('numeric-range'); expect(value.bits).toEqual(expected);
	} else {
		expect(value.backend).toBe('webgl2'); expect(value.reason).toBeUndefined();
		for (let at = 0; at < expected.length; at++) {
			if (at % 4 === 3) expect(value.bits[at]).toBe(expected[at]);
			else expect(Math.abs(rank(value.bits[at]) - rank(expected[at]))).toBeLessThanOrEqual(8);
		}
	}
	expect(value.callbacks).toBe(1); expect([value.descriptor.width, value.descriptor.height]).toEqual([3, 1]);
	expect(value.coverage).toEqual([128, 128, 128]); expect(value.overlay).toEqual({ maskId: 'half', effectId: 'negative', width: 3, height: 1 });
	expect(value.sourceAfter).toEqual(value.before); expect(value.bodyAfter).toEqual(value.bodyBefore);
	expect(value.sourceReads).toBe(nativeMismatch ? 2 : 1); expect(value.maximumActive).toBe(1); expect(value.sourceActiveAtDelivery).toBe(0);
	expect(value.sourceCopiesRetiredAtDelivery).toBe(true); expect(value.sourceCopiesRetired).toBe(true); expect(value.outputRetired).toBe(true); expect(value.overlayRetired).toBe(true);
	expect(native.draws.some(draw => draw.program === 'image' && draw.kind === 8 && draw.width === 3 && draw.height === 1)).toBe(true);
	expect(native.draws.some(draw => draw.program === 'node' && draw.kind === 3 && draw.width === 3 && draw.height === 1)).toBe(true);
	expect(native.draws.some(draw => draw.program === 'blend' && draw.width === 3 && draw.height === 1)).toBe(true);
	expect(native.integerReads.some(read => read.x === 0 && read.y === 0 && read.width === 3 && read.height === 1 && read.values.every(n => n === 128))).toBe(true);
	expect(native.nativeReads.length).toBeGreaterThan(0);
	// Capability literals0/1/255 may be uploaded; the procedural q128 output
	// must never be replaced by CPU-produced coverage in an R8UI upload.
	expect(native.byteUploads.every(upload => upload.values.every(n => n !== 128))).toBe(true);
	expect(native.aliveHandles).toBe(0); expect(native.nativeBuffersRetired).toBe(true); expect(native.uploadBackingsRetired).toBe(true);
	for (const kind of Object.keys(native.created)) expect(native.deleted[kind], kind).toBe(native.created[kind]);
	if (test.info().project.name === 'lightscaper-software-gpu') for (const context of native.contexts) expect(context.renderer).toContain('SwiftShader');
	expect(value.after.aliveHandles).toBe(0); expect(value.after.nativeBuffersRetired).toBe(true);
});

function rank(word) { return word >= 0x80000000 ? 0x100000000 - word : 0x80000000 + word; }
