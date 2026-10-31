/* SPDX-License-Identifier: AGPL-3.0-only */

import { applyPreparedManagedSdrGradeStackLinearChannelsV1, type PreparedManagedSdrGradeStackV1 } from './video-color-management-v27.ts';

const CHECK = AbortSignal.prototype.throwIfAborted;

/** Straight linear working channels stay normalized floats until final encoding. */
export interface UnifiedExactLinearSourceFrame {
	readonly width: number;
	readonly height: number;
	readonly pixels: Float32Array<ArrayBuffer>;
}

export function gradeUnifiedExactLinearSourceFrame(
	prepared: PreparedManagedSdrGradeStackV1,
	frame: Readonly<{ width: number; height: number; pixels: Uint8Array | Float32Array }>,
	signal?: AbortSignal,
): UnifiedExactLinearSourceFrame {
	const pixels = new Float32Array(frame.pixels.length);
	const scale = frame.pixels instanceof Uint8Array ? 255 : 1;
	const palette = scale === 255 && prepared.grades.length === 0 && frame.pixels.length >= 1024
		? Float32Array.from({ length: 256 }, (_, byte) => applyPreparedManagedSdrGradeStackLinearChannelsV1(
			prepared, byte / 255, byte / 255, byte / 255, 1)[0]) : null;
	for (let offset = 0; offset < pixels.length; offset += 4) {
		if (offset % (frame.width * 4) === 0 && signal !== undefined) Reflect.apply(CHECK, signal, []);
		if (palette) {
			pixels[offset] = palette[frame.pixels[offset]!]!;
			pixels[offset + 1] = palette[frame.pixels[offset + 1]!]!;
			pixels[offset + 2] = palette[frame.pixels[offset + 2]!]!;
			pixels[offset + 3] = frame.pixels[offset + 3]! / 255;
			continue;
		}
		const value = applyPreparedManagedSdrGradeStackLinearChannelsV1(prepared,
			frame.pixels[offset]! / scale, frame.pixels[offset + 1]! / scale,
			frame.pixels[offset + 2]! / scale, frame.pixels[offset + 3]! / scale);
		pixels.set(value, offset);
	}
	return Object.freeze({ width: frame.width, height: frame.height, pixels });
}

/** Retain the explicit byte boundary used by native/effect adapters. */
export function quantizeUnifiedExactLinearSourceFrame(frame: UnifiedExactLinearSourceFrame) {
	return Object.freeze({ width: frame.width, height: frame.height,
		pixels: Uint8Array.from(frame.pixels, value => Math.round(value * 255)) });
}
