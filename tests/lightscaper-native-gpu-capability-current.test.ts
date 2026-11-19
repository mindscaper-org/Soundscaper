/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { PixelFrameWebGl2UnavailableCurrentV1 } from
	'../src/common/editor/imaging/pixel-frame-webgl2-context-current-v1.ts';
import { probeNativeGpuConformanceCurrentV1 } from
	'./browser/helpers/lightscaper-native-gpu-capability-reference-current.ts';

test('the genuine production native owner reports its finite unavailable reason on a Node host', async () => {
	const actual = await probeNativeGpuConformanceCurrentV1();
	assert.equal(actual.supported, false);
	assert.equal(actual.reason, 'canvas-unavailable');
	assert.equal(actual.probeJoined, true); assert.equal(actual.privateBuffersWiped, true);
});

test('the controlled context port remains joined and owns live buffers until actual acquisition completes', async () => {
	let enter!: () => void, release!: () => void;
	const entered = new Promise<void>((resolve) => { enter = resolve; });
	const held = new Promise<void>((resolve) => { release = resolve; });
	let input: Float32Array<ArrayBuffer> | undefined, output: Float32Array<ArrayBuffer> | undefined;
	let disposed = 0, settled = false;
	const operation = probeNativeGpuConformanceCurrentV1(async (frame, passes, allocate) => {
		input = frame.pixels; output = allocate(); output.set(input);
		assert.deepEqual(passes, []); enter(); await held;
		return { pixels: output, assertCurrent: () => undefined, dispose: () => {
			disposed += 1;
			assert.deepEqual([...input!], [.125, .25, .5, 1]);
			assert.deepEqual([...output!], [.125, .25, .5, 1]);
		} };
	}).then((value) => { settled = true; return value; });
	try {
		await entered;
		assert.equal(settled, false); assert.equal(disposed, 0);
		assert.deepEqual([...input!], [.125, .25, .5, 1]);
	} finally { release(); }
	assert.equal((await operation).supported, true);
	assert.equal(disposed, 1);
	assert.deepEqual([...input!], [0, 0, 0, 0]); assert.deepEqual([...output!], [0, 0, 0, 0]);
});

test('only a branded finite actual native refusal is classified as unsupported', async () => {
	let input: Float32Array<ArrayBuffer> | undefined;
	const result = await probeNativeGpuConformanceCurrentV1((frame) => {
		input = frame.pixels; return Promise.reject(new PixelFrameWebGl2UnavailableCurrentV1('float-conformance-failed'));
	});
	assert.equal(result.supported, false); assert.equal(result.reason, 'float-conformance-failed');
	assert.deepEqual([...input!], [0, 0, 0, 0]);
	for (const reason of [
		Object.freeze({ reason: 'float-conformance-failed' }),
		new Error('Native GPU unavailable: float-conformance-failed.'),
		new PixelFrameWebGl2UnavailableCurrentV1('unknown-native-reason'),
	]) await assert.rejects(probeNativeGpuConformanceCurrentV1(() => Promise.reject(reason)), (error: unknown) => error === reason);
});

test('an opaque cleanup failure propagates after owned buffers wipe instead of granting a capability skip', async () => {
	const failure = Object.freeze(Object.create(null) as object);
	let input: Float32Array<ArrayBuffer> | undefined, output: Float32Array<ArrayBuffer> | undefined;
	await assert.rejects(probeNativeGpuConformanceCurrentV1(async (frame, _passes, allocate) => {
		input = frame.pixels; output = allocate(); output.set(input);
		return { pixels: output, assertCurrent: () => undefined, dispose: () => { throw failure; } };
	}), (error: unknown) => error === failure);
	assert.deepEqual([...input!], [0, 0, 0, 0]); assert.deepEqual([...output!], [0, 0, 0, 0]);
});

test('a native refusal combined with cleanup failure remains a failure aggregate', async () => {
	const cleanup = Object.freeze({ cleanup: Symbol('unproved') });
	for (const primary of [new PixelFrameWebGl2UnavailableCurrentV1('float-conformance-failed'), null, undefined]) {
		await assert.rejects(probeNativeGpuConformanceCurrentV1(async (_frame, _passes, allocate) => ({
			pixels: allocate(), assertCurrent: () => { throw primary; }, dispose: () => { throw cleanup; },
		})), (error: unknown) => {
			assert.ok(error instanceof AggregateError);
			assert.equal(error.cause, primary); assert.deepEqual(error.errors, [primary, cleanup]); return true;
		});
	}
});
