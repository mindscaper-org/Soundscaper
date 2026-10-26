/* SPDX-License-Identifier: AGPL-3.0-only */
export interface SdsPcmSourceGeometry {
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly frameCount: number;
}

/** Complete mono16-bit MIDI Sample Dump with matching header, sequence and packet checksums. */
export function inspectSdsPcmSourceGeometry(bytes: Uint8Array): SdsPcmSourceGeometry | null {
	if (bytes.length < 148 || bytes[0] !== 0xf0 || bytes[1] !== 0x7e || bytes[3] !== 1 || bytes[6] !== 16
		|| bytes[20] !== 0xf7 || bytes.subarray(2, 20).some(byte => byte > 127)
		|| bytes.subarray(13, 20).some(byte => byte !== 0)) return null;
	const period = sevenBitInteger(bytes, 7), frameCount = sevenBitInteger(bytes, 10);
	if (!period || !frameCount) return null;
	// The existing native/independent SDS readers use the integer nanosecond-period clock.
	const sampleRate = Math.floor(1_000_000_000 / period), packets = Math.ceil(frameCount / 40);
	if (sampleRate < 3000 || sampleRate > 768_000 || bytes.length !== 21 + packets * 127) return null;
	for (let packet = 0, offset = 21; packet < packets; packet++, offset += 127) {
		if (bytes[offset] !== 0xf0 || bytes[offset + 1] !== 0x7e || bytes[offset + 2] !== bytes[2]
			|| bytes[offset + 3] !== 2 || bytes[offset + 4] !== packet % 128 || bytes[offset + 126] !== 0xf7) return null;
		let checksum = 0;
		for (let index = 1; index < 125; index++) {
			const byte = bytes[offset + index]!;
			if (byte > 127) return null;
			checksum ^= byte;
		}
		if (checksum !== bytes[offset + 125]) return null;
	}
	return Object.freeze({ sampleRate, channelCount: 1, frameCount });
}

function sevenBitInteger(bytes: Uint8Array, offset: number): number {
	return bytes[offset]! + bytes[offset + 1]! * 128 + bytes[offset + 2]! * 16_384;
}
