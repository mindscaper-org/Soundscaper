/* SPDX-License-Identifier: AGPL-3.0-only */

const MAGIC = 'Creative Voice File\u001a';

/** Complete VOC1.20 recordings with one terminated type9 PCM16 mono/stereo block. */
export function inspectVocPcmSampleRate(bytes: Uint8Array): number | null {
	if (bytes.length < 45 || [...MAGIC].some((value, index) => bytes[index] !== value.charCodeAt(0))) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const version = view.getUint16(22, true);
	if (view.getUint16(20, true) !== 26 || version !== 0x0114
		|| view.getUint16(24, true) !== ((~version + 0x1234) & 0xffff) || bytes[26] !== 9) return null;
	const blockBytes = bytes[27]! + bytes[28]! * 256 + bytes[29]! * 65536;
	if (blockBytes <= 12 || 30 + blockBytes + 1 !== bytes.length || bytes[bytes.length - 1] !== 0) return null;
	const sampleRate = view.getUint32(30, true), channelCount = bytes[35]!;
	if (sampleRate < 3000 || sampleRate > 384_000 || bytes[34] !== 16
		|| ![1, 2].includes(channelCount) || view.getUint16(36, true) !== 4
		|| (blockBytes - 12) % (channelCount * 2) !== 0) return null;
	return sampleRate;
}
