/* SPDX-License-Identifier: AGPL-3.0-only */

/** One shared desktop job owns both paired frame packs and the encoded video reservation. */
export const KEYING_MAXIMUM_PACKS = 31;
export const KEYING_MAXIMUM_JOB_BYTES = 8 * 1024 ** 3;
export const KEYING_ENCODE_OVERHEAD_BYTES = 16 * 1024 ** 2;
export const KEYING_PACK_HEADER_BYTES = new TextEncoder().encode('soundscaper-assistance-frame-pack-v2\n').byteLength + 28;

export function keyingEncodedReservationBytes(width: number, height: number, frames: number): number {
	const bytes = width * height * 4 * frames + KEYING_ENCODE_OVERHEAD_BYTES;
	if (!Number.isSafeInteger(bytes) || bytes > KEYING_MAXIMUM_JOB_BYTES) throw sourceLimitError();
	return bytes;
}
export function assertKeyingStagedBudget(inputBytes: number, packs: number, encodedBytes: number): void {
	if (packs > KEYING_MAXIMUM_PACKS || inputBytes * 2 + encodedBytes > KEYING_MAXIMUM_JOB_BYTES) throw sourceLimitError();
}
export function sourceLimitError(): RangeError {
	return new RangeError('The video source exceeds CorridorKey’s current processing limit at this resolution.');
}
