/* SPDX-License-Identifier: AGPL-3.0-only */

import { yieldPixelFrameTaskV1 } from './pixel-frame-task-yield-v1.ts';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { detailSharpenByteV1, prepareDetailSharpenEffectV1 } from '../video-sharpen-v1.ts';
import { admitPixelFrameV1 } from './pixel-frame-admission-v1.ts';
import { readPixelFrameV1, type PixelFrameDescriptorV1, type PixelFrameLimitsV1 } from './pixel-frame-contract-v1.ts';

export interface DetailSharpenPixelFrameV1 { readonly descriptor: Readonly<PixelFrameDescriptorV1>; readonly pixels: Uint8Array<ArrayBuffer> }
const CHECK = AbortSignal.prototype.throwIfAborted;
const BUFFER_SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;

/** One immutable native source snapshot and one scoped output. Neighborhoods
 * always read the same stage input; neither backing escapes after settlement. */
export async function withDetailSharpenPixelFrameV1<Result>(value: unknown,
	consume: (frame: DetailSharpenPixelFrameV1) => Result | Promise<Result>, options: Readonly<{ limits: PixelFrameLimitsV1 }>): Promise<Result> {
	const input = record(value, 'detail sharpening frame', ['frame', 'effect', 'signal'], ['frame', 'effect']);
	const option = record(options, 'detail sharpening options', ['limits']), limits = field(option, 'limits', 'detail sharpening options');
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal', 'detail sharpening frame') : undefined;
	const check = () => { if (signal !== undefined) Reflect.apply(CHECK, signal, []); };
	check(); if (typeof consume !== 'function') throw new TypeError('Detail sharpening requires a scoped consumer.');
	const effect = prepareDetailSharpenEffectV1(field(input, 'effect', 'detail sharpening frame'));
	const raw = record(field(input, 'frame', 'detail sharpening frame'), 'detail sharpening source', ['descriptor', 'pixels']);
	const plan = admitPixelFrameV1(field(raw, 'descriptor', 'detail sharpening source'), { limits });
	const source = readPixelFrameV1({ descriptor: plan.descriptor, pixels: field(raw, 'pixels', 'detail sharpening source') }, limits);
	const original = new Uint8Array(new Uint8Array(source.pixels.buffer, source.pixels.byteOffset, source.pixels.byteLength));
	const sourceBuffer = original.buffer; let outputBuffer: ArrayBuffer | undefined;
	try {
		const pixels = new Uint8Array(original); outputBuffer = pixels.buffer;
		if (effect.enabled && !effect.neutral) {
			const { width, height } = plan.descriptor;
			let processed = 0;
			for (let y = 0; y < height; y++) {
				check();
				const top = 4 * Math.max(0, y - 1) * width, middle = 4 * y * width, bottom = 4 * Math.min(height - 1, y + 1) * width;
				let rightWeight = 0, rightRed = 0, rightGreen = 0, rightBlue = 0;
				const column = (x: number) => {
					const offset = 4 * x, a = top + offset, b = middle + offset, c = bottom + offset;
					const alphaA = original[a + 3]!, alphaB = 2 * original[b + 3]!, alphaC = original[c + 3]!;
					rightWeight = alphaA + alphaB + alphaC;
					rightRed = alphaA * original[a]! + alphaB * original[b]! + alphaC * original[c]!;
					rightGreen = alphaA * original[a + 1]! + alphaB * original[b + 1]! + alphaC * original[c + 1]!;
					rightBlue = alphaA * original[a + 2]! + alphaB * original[b + 2]! + alphaC * original[c + 2]!;
				};
				// Integer separability preserves the original 3×3 sums exactly;
				// rounding still occurs only in detailSharpenByteV1.
				column(0);
				let centerWeight = rightWeight, centerRed = rightRed, centerGreen = rightGreen, centerBlue = rightBlue;
				let leftWeight = centerWeight, leftRed = centerRed, leftGreen = centerGreen, leftBlue = centerBlue;
				for (let x = 0; x < width; x++) {
					check(); const offset = middle + 4 * x;
					column(Math.min(width - 1, x + 1));
					if (original[offset + 3] !== 0) {
						const weight = leftWeight + 2 * centerWeight + rightWeight;
						pixels[offset] = detailSharpenByteV1(effect, original[offset]!, leftRed + 2 * centerRed + rightRed, weight);
						pixels[offset + 1] = detailSharpenByteV1(effect, original[offset + 1]!, leftGreen + 2 * centerGreen + rightGreen, weight);
						pixels[offset + 2] = detailSharpenByteV1(effect, original[offset + 2]!, leftBlue + 2 * centerBlue + rightBlue, weight);
					}
					leftWeight = centerWeight; leftRed = centerRed; leftGreen = centerGreen; leftBlue = centerBlue;
					centerWeight = rightWeight; centerRed = rightRed; centerGreen = rightGreen; centerBlue = rightBlue;
					processed += 4;
					if (processed >= 256 * 1024) { await yieldPixelFrameTaskV1(); processed = 0; check(); }
				}
			}
		}
		check(); const result = await consume(Object.freeze({ descriptor: plan.descriptor, pixels })); check(); return result;
	}
	finally { wipe(sourceBuffer); if(outputBuffer) wipe(outputBuffer); }
}

function wipe(buffer: ArrayBuffer): void { if (Number(Reflect.apply(BUFFER_SIZE, buffer, [])) > 0) new Uint8Array(buffer).fill(0); }
