/* SPDX-License-Identifier: AGPL-3.0-only */
const RIFF = [114, 105, 102, 102, 46, 145, 207, 17, 165, 214, 40, 219, 4, 193, 0, 0] as const;
const TAIL = [243, 172, 211, 17, 140, 209, 0, 192, 79, 142, 219, 138] as const;
export interface Wave64PcmSourceGeometry {
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly frameCount: number;
}

/** Complete Sony Wave64 PCM16 mono/stereo extents; chunk sizes include their24-byte headers. */
export function inspectWave64PcmSourceGeometry(bytes: Uint8Array): Wave64PcmSourceGeometry | null {
	if (bytes.length < 104 || !RIFF.every((value, index) => bytes[index] === value) || !guid(bytes, 24, 'wave')) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getBigUint64(16, true) !== BigInt(bytes.length)) return null;
	let offset = 40, headers = 0, format: { sampleRate: number; channelCount: number; blockAlign: number } | null = null, dataBytes: number | null = null;
	while (offset < bytes.length) {
		if (++headers > 4096 || offset > bytes.length - 24) return null;
		const size = view.getBigUint64(offset + 16, true);
		if (size < 24n || size > BigInt(bytes.length - offset)) return null;
		const body = Number(size) - 24, next = offset + Math.ceil(Number(size) / 8) * 8;
		if (!Number.isSafeInteger(next) || next > bytes.length) return null;
		if (guid(bytes, offset, 'fmt ')) {
			if (format || body !== 16 && body !== 18 || body === 18 && view.getUint16(offset + 40, true) !== 0) return null;
			const sampleRate = view.getUint32(offset + 28, true), channelCount = view.getUint16(offset + 26, true), blockAlign = view.getUint16(offset + 36, true);
			if (view.getUint16(offset + 24, true) !== 1 || ![1, 2].includes(channelCount)
				|| sampleRate < 3000 || sampleRate > 384_000 || view.getUint16(offset + 38, true) !== 16
				|| blockAlign !== channelCount * 2 || view.getUint32(offset + 32, true) !== sampleRate * blockAlign) return null;
			format = { sampleRate, channelCount, blockAlign };
		} else if (guid(bytes, offset, 'data')) {
			if (dataBytes !== null || body < 1) return null;
			dataBytes = body;
		}
		offset = next;
	}
	if (!format || dataBytes === null || dataBytes % format.blockAlign !== 0) return null;
	return Object.freeze({ sampleRate: format.sampleRate, channelCount: format.channelCount, frameCount: dataBytes / format.blockAlign });
}

function guid(bytes: Uint8Array, offset: number, name: string): boolean {
	return offset <= bytes.length - 16 && [...name].every((value, index) => bytes[offset + index] === value.charCodeAt(0))
		&& TAIL.every((value, index) => bytes[offset + 4 + index] === value);
}
