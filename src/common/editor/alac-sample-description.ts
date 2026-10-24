/* SPDX-License-Identifier: AGPL-3.0-only */
const MAXIMUM_PCM_BYTES = 128 * 1024 ** 2;

/** One ordinary version-zero ALAC sample entry with its complete 24-byte cookie. */
export function readAlacSampleDescription(bytes: Uint8Array): Readonly<{ sampleRate: number; channelCount: number }> | null {
	if (bytes.length !== 88) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getUint32(0) !== bytes.length || ascii(bytes, 4) !== 'stsd' || view.getUint32(8) !== 0
		|| view.getUint32(12) !== 1 || view.getUint32(16) !== 72 || ascii(bytes, 20) !== 'alac'
		|| view.getUint16(32) !== 0 || view.getUint32(52) !== 36 || ascii(bytes, 56) !== 'alac'
		|| view.getUint32(60) !== 0) return null;
	const sampleRate = view.getUint32(48) / 65536, channelCount = view.getUint16(40);
	if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192_000 || channelCount < 1 || channelCount > 32
		|| view.getUint32(84) !== sampleRate || bytes[73] !== channelCount || bytes[68] !== 0
		|| ![16, 20, 24, 32].includes(bytes[69]!) || view.getUint32(64) < 1
		|| view.getUint32(64) * channelCount * 4 > MAXIMUM_PCM_BYTES) return null;
	return { sampleRate, channelCount };
}

function ascii(bytes: Uint8Array, offset: number): string { return String.fromCharCode(...bytes.subarray(offset, offset + 4)); }
