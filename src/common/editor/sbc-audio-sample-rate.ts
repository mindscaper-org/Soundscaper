/* SPDX-License-Identifier: AGPL-3.0-only */

/** Complete uniform rawSBC frames; the existing native decoder owns their audio payload. */
export function inspectSbcAudioSampleRate(bytes: Uint8Array): number | null {
	if (bytes.length < 7 || bytes[0] !== 0x9c) return null;
	const configuration = bytes[1]!, sampleRate = [16_000, 32_000, 44_100, 48_000][configuration >> 6]!;
	let offset = 0, frames = 0;
	while (offset < bytes.length) {
		if (++frames > 1_000_000 || offset + 4 > bytes.length || bytes[offset] !== 0x9c || bytes[offset + 1] !== configuration) return null;
		const blocks = 4 * ((configuration >> 4 & 3) + 1), mode = configuration >> 2 & 3;
		const subbands = configuration & 1 ? 8 : 4, channels = mode === 0 ? 1 : 2, bitpool = bytes[offset + 2]!;
		if (bitpool < 2 || bitpool > Math.min(250, (mode < 2 ? 16 : 32) * subbands)) return null;
		const joint = mode === 3 ? subbands : 0;
		const frameBytes = 4 + subbands * channels / 2 + Math.ceil(((mode === 1 ? 2 : 1) * blocks * bitpool + joint) / 8);
		if (offset + frameBytes > bytes.length || headerCrc(bytes, offset, joint + 4 * subbands * channels) !== bytes[offset + 3]) return null;
		offset += frameBytes;
	}
	return sampleRate;
}

function headerCrc(bytes: Uint8Array, offset: number, scaleBits: number): number {
	let crc = 0x0f;
	for (let index = 0; index < 16 + scaleBits; index++) {
		const sourceBit = index < 16 ? 8 + index : 32 + index - 16;
		const input = bytes[offset + (sourceBit >> 3)]! >> (7 - (sourceBit & 7)) & 1;
		const feedback = (crc >> 7) ^ input;
		crc = (crc << 1 & 255) ^ (feedback ? 0x1d : 0);
	}
	return crc;
}
