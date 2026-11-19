/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	openPixelFrameWebGl2ContextCurrentV1,
	pixelFrameWebGl2UnavailableReasonCurrentV1,
} from '../../../src/common/editor/imaging/pixel-frame-webgl2-context-current-v1.ts';

const EXPECTED_UNAVAILABLE = new Set([
	'canvas-unavailable', 'context-unavailable', 'float-target-unavailable',
	'float-conformance-failed', 'texture-capacity', 'numeric-range',
	'execution-unavailable', 'context-lost',
]);

/** Execute the production owner's own shader/copy/arithmetic admission. This
 * bounded canary neither contributes shipped-code coverage nor replaces a draw,
 * framebuffer, capability, result, or assertion in the actual native tests. */
export async function probeNativeGpuConformanceCurrentV1(open = openPixelFrameWebGl2ContextCurrentV1) {
	const pixels = Float32Array.of(.125, .25, .5, 1);
	const frame = {
		descriptor: { schemaVersion: 1 as const, width: 1, height: 1, sampleFormat: 'float32' as const,
			primaries: 'srgb' as const, transfer: 'linear' as const },
		pixels,
	};
	let output: Float32Array<ArrayBuffer> | undefined;
	let context: Awaited<ReturnType<typeof open>> | undefined;
	let failure: { error: unknown } | undefined;
	try {
		context = await open(frame, [], () => {
			if (output) throw new Error('Native conformance canary allocated its output more than once.');
			output = new Float32Array(4); return output;
		});
		context.assertCurrent();
		if (context.pixels !== output || context.pixels.length !== 4
			|| ![.125, .25, .5, 1].every((value, index) => Object.is(pixels[index], value)
				&& Object.is(context!.pixels[index], value))) {
			throw new Error('Production native conformance canary lost its exact owned identity frame.');
		}
	} catch (error) { failure = { error }; }

	const cleanup: unknown[] = [];
	try { context?.dispose(); } catch (error) { cleanup.push(error); }
	try { pixels.fill(0); } catch (error) { cleanup.push(error); }
	try { output?.fill(0); } catch (error) { cleanup.push(error); }
	if (cleanup.length) {
		if (!failure && cleanup.length === 1) throw cleanup[0];
		throw new AggregateError([...(failure ? [failure.error] : []), ...cleanup],
			'Native conformance canary and cleanup failed.', { cause: failure ? failure.error : cleanup[0] });
	}
	if (failure) {
		const reason = pixelFrameWebGl2UnavailableReasonCurrentV1(failure.error);
		if (reason === null || !EXPECTED_UNAVAILABLE.has(reason)) throw failure.error;
		return { supported: false, reason, probe: 'production-context-current-v1', probeJoined: true, privateBuffersWiped: true };
	}
	return { supported: true, reason: null, probe: 'production-context-current-v1', probeJoined: true, privateBuffersWiped: true };
}
