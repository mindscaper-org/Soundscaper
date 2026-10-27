/* SPDX-License-Identifier: AGPL-3.0-only */

import { yieldPixelFrameTaskV1 } from './pixel-frame-task-yield-v1.ts';
import { readClosedDomainField as field,readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { prepareDehazeEffectV1,dehazeEffectiveDarkByteV1,dehazeTransmissionQ8V1,dehazeOutputByteV1 } from '../video-dehaze-v1.ts';
import { admitPixelFrameV1 } from './pixel-frame-admission-v1.ts';
import { readPixelFrameV1,type PixelFrameDescriptorV1,type PixelFrameLimitsV1 } from './pixel-frame-contract-v1.ts';

export interface DehazePixelFrameV1 { readonly descriptor: Readonly<PixelFrameDescriptorV1>; readonly pixels: Uint8Array<ArrayBuffer> }
const CHECK = AbortSignal.prototype.throwIfAborted;
const BUFFER_SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength')!.get!;

/** One immutable source snapshot and one scoped output. Positive amounts
 * read nine original neighbors; negative amounts read only their own pixel.
 * No transmission plane or global statistics are retained. Frame limits do
 * not constitute a qualified maximum-profile heap or latency promise. */
export async function withDehazePixelFrameV1<Result>(value: unknown,
	consume: (frame: DehazePixelFrameV1) => Result | Promise<Result>,options: Readonly<{ limits: PixelFrameLimitsV1 }>): Promise<Result> {
	const input = record(value,'dehaze frame',['frame','effect','signal'],['frame','effect']);
	const option = record(options,'dehaze options',['limits']),limits = field(option,'limits','dehaze options');
	const signal = Object.hasOwn(input,'signal') ? field(input,'signal','dehaze frame') : undefined;
	const check = () => { if (signal !== undefined) Reflect.apply(CHECK,signal,[]); };
	check(); if (typeof consume !== 'function') throw new TypeError('Dehaze requires a scoped consumer.');
	const effect = prepareDehazeEffectV1(field(input,'effect','dehaze frame'));
	const raw = record(field(input,'frame','dehaze frame'),'dehaze source',['descriptor','pixels']);
	const plan = admitPixelFrameV1(field(raw,'descriptor','dehaze source'),{ limits });
	const source = readPixelFrameV1({ descriptor: plan.descriptor,pixels: field(raw,'pixels','dehaze source') },limits);
	const original = new Uint8Array(new Uint8Array(source.pixels.buffer,source.pixels.byteOffset,source.pixels.byteLength));
	const sourceBuffer = original.buffer; let outputBuffer: ArrayBuffer | undefined;
	try {
		const pixels = new Uint8Array(original); outputBuffer = pixels.buffer;
		if (effect.enabled && !effect.neutral) {
			const { width,height } = plan.descriptor; let processed = 0;
			for (let y = 0; y < height; y++) {
				check();
				const top = 4 * Math.max(0,y - 1) * width, middle = 4 * y * width, bottom = 4 * Math.min(height - 1,y + 1) * width;
				const column = (x: number) => {
					const offset = 4 * x, a = top + offset, b = middle + offset, c = bottom + offset;
					return Math.min(dehazeEffectiveDarkByteV1(original[a]!,original[a + 1]!,original[a + 2]!,original[a + 3]!),
						dehazeEffectiveDarkByteV1(original[b]!,original[b + 1]!,original[b + 2]!,original[b + 3]!),
						dehazeEffectiveDarkByteV1(original[c]!,original[c + 1]!,original[c + 2]!,original[c + 3]!));
				};
				// Reuse two original columns; no intermediate plane or rounding.
				let center = effect.gainQ8 > 0 ? column(0) : 255, left = center;
				for (let x = 0; x < width; x++) {
					check(); const offset = middle + 4 * x;
					const right = effect.gainQ8 > 0 ? column(Math.min(width - 1,x + 1)) : 255;
					if (original[offset + 3] !== 0) {
						const transmission = dehazeTransmissionQ8V1(effect,Math.min(left,center,right));
						for (let channel = 0; channel < 3; channel++) pixels[offset + channel] = dehazeOutputByteV1(effect,original[offset + channel]!,transmission);
					}
					left = center; center = right; processed += 4;
					if (processed >= 256 * 1024) { await yieldPixelFrameTaskV1(); processed = 0; check(); }
				}
			}
		}
		check(); const result = await consume(Object.freeze({ descriptor: plan.descriptor,pixels })); check(); return result;
	} finally { wipe(sourceBuffer); if (outputBuffer) wipe(outputBuffer); }
}

function wipe(buffer: ArrayBuffer): void { if (Number(Reflect.apply(BUFFER_SIZE,buffer,[])) > 0) new Uint8Array(buffer).fill(0); }
