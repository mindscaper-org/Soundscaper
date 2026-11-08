/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	prepareManagedSdrGradeStackV1,
	type ParsedCubeLutV1,
	type VideoColorGradeV1,
	type VideoSourceColorInterpretationV1,
} from '../src/common/editor/video-color-management-v27.ts';
import { gradeUnifiedExactLinearSourceFrame } from '../src/common/editor/unified-exact-linear-source-frame.ts';
import {
	gradeEncodedFrame, gradeEncodedLinearFrame, gradeLinearFrame, gradeLinearFloatFrame,
} from '../src/framescaper/selected-finishing-exact-frame-support.ts';
import { placeFramescaperManagedGradedAdjustmentFrameV1 } from '../src/framescaper/selected-finishing-managed-grade-frame.ts';

const INTERPRETATION: VideoSourceColorInterpretationV1 = {
	schemaVersion: 1, sourceId: 'white', sourceKind: 'still', primaries: 'srgb',
	transfer: 'srgb', matrix: 'rgb', range: 'full', provenance: 'user-override',
};
const GRADE: VideoColorGradeV1 = {
	schemaVersion: 1, exposureStops: 0, contrast: 1, pivot: 0.18,
	lift: [0, 0, 0], gamma: [1, 1, 1], gain: [.49999999, .49999999, .49999999],
	saturation: 1, lut: null,
};
const LIVE = new AbortController().signal;
const white = () => ({ width: 1, height: 1, pixels: new Uint8Array([255, 255, 255, 255]) });
const LUTS = new Map<string, ParsedCubeLutV1>();

test('legacy byte grade adapters round their scalar result directly while explicit linear grades retain Float32', () => {
	// .49999999 * 255 is strictly below 127.5. An intermediate Float32 rounds
	// .49999999 to .5 and incorrectly moves the byte from 127 to 128.
	for (const [bytes, linear] of [
		[() => gradeEncodedFrame(white(), INTERPRETATION, [GRADE], LUTS, LIVE),
			() => gradeEncodedLinearFrame(white(), INTERPRETATION, [GRADE], LUTS, LIVE)],
		[() => gradeLinearFrame(white(), [GRADE], LUTS, LIVE),
			() => gradeLinearFloatFrame(white(), [GRADE], LUTS, LIVE)],
	] as const) {
		const byteFrame = bytes(), linearFrame = linear();
		try {
			assert.deepEqual(byteFrame.pixels, new Uint8Array([127, 127, 127, 255]));
			assert.deepEqual(linearFrame.pixels, new Float32Array([.5, .5, .5, 1]));
		} finally { byteFrame.pixels.fill(0); linearFrame.pixels.fill(0); }
	}
});

test('legacy V1 adjustment placement preserves identical scalar rounding through intrinsic and native-buffer adapters', async () => {
	class NativePixels extends Uint8Array {}
	for (const pixels of [new Uint8Array([255, 255, 255, 255]), new NativePixels([255, 255, 255, 255])]) {
		const before = pixels.slice();
		const result = await placeFramescaperManagedGradedAdjustmentFrameV1({
			frame: { width: 1, height: 1, pixels }, grades: [GRADE], luts: LUTS,
			width: 1, height: 1, blendMode: 'normal', opacity: 1, signal: LIVE,
		});
		try {
			assert.deepEqual(result.pixels, new Float64Array([127 / 255, 127 / 255, 127 / 255, 1]));
			assert.deepEqual(pixels, before);
		} finally { result.pixels.fill(0); }
	}
});

const GRADERS: readonly Readonly<{ name: string; run: (signal: AbortSignal) => unknown }>[] = [
	{ name: 'encoded byte', run: signal => gradeEncodedFrame(white(), INTERPRETATION, [], LUTS, signal) },
	{ name: 'linear byte', run: signal => gradeLinearFrame(white(), [], LUTS, signal) },
	{ name: 'encoded Float32', run: signal => gradeEncodedLinearFrame(white(), INTERPRETATION, [], LUTS, signal) },
	{ name: 'linear Float32', run: signal => gradeLinearFloatFrame(white(), [], LUTS, signal) },
	{ name: 'shared Float32', run: signal => gradeUnifiedExactLinearSourceFrame(
		prepareManagedSdrGradeStackV1({ decoding: 'linear', grades: [] }), white(), signal,
	) },
];

test('all grade adapters reject forged signals without acquiring their public fields', () => {
	for (const { name, run } of GRADERS) {
		let reads = 0;
		const signal = { get aborted() { reads++; return true; }, get reason() { reads++; return undefined; } } as unknown as AbortSignal;
		assert.throws(() => run(signal), TypeError, name);
		assert.equal(reads, 0, name);
	}
});

test('all grade adapters retain native cancellation state and opaque reasons through public signal shadows', () => {
	for (const { name, run } of GRADERS) {
		let reads = 0;
		const controller = new AbortController(), opaque = Proxy.revocable({}, {});
		opaque.revoke(); controller.abort(opaque.proxy);
		Object.defineProperties(controller.signal, {
			aborted: { get() { reads++; return false; } },
			reason: { get() { reads++; throw Error('Public abort reason must not be read.'); } },
		});
		assert.throws(() => run(controller.signal), (error: unknown) => error === opaque.proxy, name);
		assert.equal(reads, 0, name);
	}
});
