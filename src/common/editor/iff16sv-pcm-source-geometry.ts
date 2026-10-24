/* SPDX-License-Identifier: AGPL-3.0-only */
export interface Iff16svPcmSourceGeometry {
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly frameCount: number;
}

/** Complete unlooped mono16SV PCM; CHAN placement and compressed/octave profiles stay native. */
export function inspectIff16svPcmSourceGeometry(bytes: Uint8Array): Iff16svPcmSourceGeometry | null {
	if (bytes.length < 50) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getUint32(0, false) !== 0x464f524d || view.getUint32(8, false) !== 0x31365356
		|| view.getUint32(4, false) + 8 !== bytes.length) return null;
	let offset = 12, chunks = 0, sampleRate = 0, frameCount = 0, dataFrames = 0;
	while (offset < bytes.length) {
		if (++chunks > 4096 || bytes.length - offset < 8) return null;
		const id = view.getUint32(offset, false), size = view.getUint32(offset + 4, false), start = offset + 8;
		const end = start + size, next = end + (size & 1);
		if (end > bytes.length || next > bytes.length) return null;
		if (id === 0x56484452) {
			if (sampleRate || size !== 20 || view.getUint32(start + 4, false) !== 0 || view.getUint32(start + 8, false) !== 0
				|| bytes[start + 14] !== 1 || bytes[start + 15] !== 0) return null;
			sampleRate = view.getUint16(start + 12, false); frameCount = view.getUint32(start, false);
			if (sampleRate < 3000 || frameCount === 0) return null;
		} else if (id === 0x424f4459) {
			if (dataFrames || size === 0 || size % 2 !== 0) return null;
			dataFrames = size / 2;
		} else if (id === 0x4348414e) return null;
		offset = next;
	}
	return sampleRate && frameCount === dataFrames ? Object.freeze({ sampleRate, channelCount: 1, frameCount }) : null;
}
