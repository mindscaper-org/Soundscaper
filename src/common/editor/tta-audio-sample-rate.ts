/* SPDX-License-Identifier: AGPL-3.0-only */

/** Authenticate an ordinary unencrypted TTA1 clock; native decoding still owns PCM and trailers. */
export function inspectTtaAudioSampleRate(bytes: Uint8Array): number | null {
	if (bytes.length < 30 || bytes[0] !== 84 || bytes[1] !== 84 || bytes[2] !== 65 || bytes[3] !== 49) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const sampleRate = view.getUint32(10, true), frames = view.getUint32(14, true);
	if (view.getUint16(4, true) !== 1 || ![1, 2].includes(view.getUint16(6, true)) || ![16, 24].includes(view.getUint16(8, true))
		|| sampleRate < 3000 || sampleRate > 384_000 || frames === 0 || crc32(bytes.subarray(0, 18)) !== view.getUint32(18, true)) return null;
	const packetFrames = Math.floor(sampleRate * 256 / 245), packets = Math.ceil(frames / packetFrames);
	const tableEnd = 22 + packets * 4;
	if (packets > 1_000_000 || tableEnd + 4 > bytes.length || crc32(bytes.subarray(22, tableEnd)) !== view.getUint32(tableEnd, true)) return null;
	let end = tableEnd + 4;
	for (let index = 0; index < packets; index++) {
		const size = view.getUint32(22 + index * 4, true);
		if (size < 4 || end + size > bytes.length) return null;
		end += size;
	}
	return sampleRate;
}

function crc32(bytes: Uint8Array): number {
	let value = 0xffff_ffff;
	for (const byte of bytes) {
		value ^= byte;
		for (let bit = 0; bit < 8; bit++) value = value >>> 1 ^ (value & 1 ? 0xedb8_8320 : 0);
	}
	return (value ^ 0xffff_ffff) >>> 0;
}
