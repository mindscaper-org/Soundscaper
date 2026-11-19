/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	applyPreparedManagedSdrGradeStackLinearChannelsV1,
	encodeManagedSdrLinearChannelsV1,
	type PreparedManagedSdrGradeStackV1,
	type VideoColorOutputSpaceV1,
} from './video-color-management-v27.ts';

const LINEAR_BYTE_STEPS = 4096;
const linearByteEncoders = new Map<VideoColorOutputSpaceV1, (channel: number) => number>();

/** Reuse the exact quantized transfer for each output space. */
export function createManagedSdrLinearByteEncoderV1(
	output: VideoColorOutputSpaceV1,
): (channel: number) => number {
	const cached = linearByteEncoders.get(output);
	if (cached) return cached;
	const transfer = output === 'linear-rec709-d65' ? (value: number) => value
		: output === 'srgb' ? (value: number) => (value <= 0.0031308
			? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055)
			: output === 'rec709' ? (value: number) => (value < 0.018
				? value * 4.5 : 1.099 * value ** 0.45 - 0.099) : null;
	if (!transfer) throw new RangeError('The managed SDR output space is unsupported.');
	const quantize = (channel: number) => Math.round(transfer(channel) * 255);
	const lookup = output === 'linear-rec709-d65' ? null : exactLinearByteBins(quantize);
	const encode = (channel: number) => {
		if (!Number.isFinite(channel) || channel < 0 || channel > 1) {
			throw new RangeError('The managed SDR channel must be between zero and one.');
		}
		if (channel === 0) return channel;
		const byte = lookup?.[(channel * LINEAR_BYTE_STEPS) | 0] ?? -1;
		return byte >= 0 ? byte : quantize(channel);
	};
	linearByteEncoders.set(output, encode);
	return encode;
}

function exactLinearByteBins(quantize: (channel: number) => number): Int16Array<ArrayBuffer> {
	const bins = new Int16Array(LINEAR_BYTE_STEPS + 1);
	let lower = quantize(0);
	for (let index = 0; index < LINEAR_BYTE_STEPS; index += 1) {
		const upper = quantize((index + 1) / LINEAR_BYTE_STEPS);
		// The rounded transfers are monotone. Recompute bins that straddle a byte boundary.
		bins[index] = lower === upper ? lower : -1;
		lower = upper;
	}
	bins[LINEAR_BYTE_STEPS] = lower;
	return bins;
}

/** Ungraded byte channels are independent: evaluate each through the oracle once per frame. */
export function createManagedSdrUngradedByteLookupV1(
	prepared: PreparedManagedSdrGradeStackV1,
	output: VideoColorOutputSpaceV1,
): Uint8Array<ArrayBuffer> | null {
	if (prepared.grades.length !== 0) return null;
	const lookup = new Uint8Array(256);
	for (let byte = 0; byte <= 255; byte += 1) {
		const value = byte / 255;
		const linear = applyPreparedManagedSdrGradeStackLinearChannelsV1(prepared, value, value, value, 1);
		lookup[byte] = Math.round(encodeManagedSdrLinearChannelsV1(
			linear[0], linear[1], linear[2], linear[3], output,
		)[0] * 255);
	}
	return lookup;
}

/** Apply an admitted frame's byte channels with exactly the prepared SDR color semantics. */
export function applyPreparedManagedSdrByteFrameV1(
	prepared: PreparedManagedSdrGradeStackV1,
	frame: Readonly<{ width: number; height: number; pixels: Uint8Array }>,
	output: VideoColorOutputSpaceV1,
	signal?: AbortSignal,
): Uint8Array<ArrayBuffer> {
	const lookup = createManagedSdrUngradedByteLookupV1(prepared, output);
	const pixels = new Uint8Array(frame.pixels.byteLength);
	try {
		for (let y = 0; y < frame.height; y += 1) {
			if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason
				: new DOMException('The V13 finishing operation was aborted.', 'AbortError');
			for (let x = 0; x < frame.width; x += 1) {
				const offset = (y * frame.width + x) * 4;
				if (lookup) {
					pixels[offset] = lookup[frame.pixels[offset]!]!;
					pixels[offset + 1] = lookup[frame.pixels[offset + 1]!]!;
					pixels[offset + 2] = lookup[frame.pixels[offset + 2]!]!;
					pixels[offset + 3] = frame.pixels[offset + 3]!;
					continue;
				}
				const linear = applyPreparedManagedSdrGradeStackLinearChannelsV1(prepared,
					frame.pixels[offset]! / 255, frame.pixels[offset + 1]! / 255,
					frame.pixels[offset + 2]! / 255, frame.pixels[offset + 3]! / 255);
				const value = output === 'linear-rec709-d65' ? linear : encodeManagedSdrLinearChannelsV1(
					linear[0], linear[1], linear[2], linear[3], output,
				);
				for (let channel = 0; channel < 4; channel += 1) {
					pixels[offset + channel] = Math.round(value[channel]! * 255);
				}
			}
		}
		return pixels;
	} catch (error) {
		pixels.fill(0);
		throw error;
	}
}
