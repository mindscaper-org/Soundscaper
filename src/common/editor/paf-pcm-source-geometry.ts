/* SPDX-License-Identifier: AGPL-3.0-only */
export interface PafPcmSourceGeometry {
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly frameCount: number;
}

/** Complete version-zero, big-endian PARIS PCM16 mono/stereo; audio starts at2048. */
export function inspectPafPcmSourceGeometry(bytes: Uint8Array): PafPcmSourceGeometry | null {
	if (bytes.length < 2050 || bytes[0] !== 32 || bytes[1] !== 112 || bytes[2] !== 97 || bytes[3] !== 102) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getUint32(4, false) !== 0 || view.getUint32(8, false) !== 0 || view.getUint32(16, false) !== 0) return null;
	const sampleRate = view.getUint32(12, false), channelCount = view.getUint32(20, false), dataBytes = bytes.length - 2048;
	if (sampleRate < 3000 || sampleRate > 384_000 || ![1, 2].includes(channelCount) || dataBytes % (channelCount * 2) !== 0) return null;
	return Object.freeze({ sampleRate, channelCount, frameCount: dataBytes / (channelCount * 2) });
}
