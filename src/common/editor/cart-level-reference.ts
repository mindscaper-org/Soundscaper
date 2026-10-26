/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeCartMetadata, type CartMetadata, type CartMetadataInput } from './cart-metadata.ts';

/** Attach the physical sample unit before a source container becomes float project PCM. */
export function cartWithSourceReferenceScale(input: CartMetadataInput,
	descriptor: Readonly<{ encoding?: unknown; bytesPerSample?: unknown }>): CartMetadataInput {
	if (!input.levelReference) return input;
	const width = descriptor.bytesPerSample;
	const scale = descriptor.encoding === 'ieee-float' ? 1
		: descriptor.encoding === 'pcm-integer' && typeof width === 'number'
			&& Number.isSafeInteger(width) && width >= 1 && width <= 4 ? 2 ** (width * 8 - 1) : null;
	return scale === null ? input : { ...input, levelReferenceScale: scale };
}

/** AES46's reference is an integer sample value, so changing its PCM unit changes the integer. */
export function cartForOutputPrecision(input: CartMetadata | null, bitDepth?: number): CartMetadata | null {
	if (input === null || input.levelReferenceScale == null || bitDepth == null) return input;
	if (!Number.isSafeInteger(bitDepth) || bitDepth < 1 || bitDepth > 32) throw new RangeError('Invalid CART output PCM precision.');
	const scale = 2 ** (Math.ceil(bitDepth / 8) * 8 - 1);
	const numerator = BigInt(input.levelReference) * BigInt(scale);
	const denominator = BigInt(input.levelReferenceScale);
	const magnitude = ((numerator < 0n ? -numerator : numerator) + denominator / 2n) / denominator;
	const value = Number(numerator < 0n ? -magnitude : magnitude);
	const reference = value === 0x8000_0000 && scale === 0x8000_0000
		&& input.levelReference === input.levelReferenceScale ? 0x7fff_ffff : value;
	return normalizeCartMetadata({ ...input, levelReference: reference, levelReferenceScale: scale });
}
