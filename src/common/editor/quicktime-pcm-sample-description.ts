/* SPDX-License-Identifier: AGPL-3.0-only */

/** Apple version-zero uncompressed16-bit sound descriptions have no reconstructed clock. */
export function readQuickTimePcmSampleDescription(bytes: Uint8Array): Readonly<{ sampleRate: number; channelCount: number }> | null {
	if (bytes.length < 52 || bytes.length > 65_536) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getUint32(0) !== bytes.length || ascii(bytes, 4) !== 'stsd' || view.getUint32(8) !== 0
		|| view.getUint32(12) !== 1 || view.getUint32(16) !== bytes.length - 16
		|| !['twos', 'sowt'].includes(ascii(bytes, 20)) || view.getUint32(32) !== 0 || view.getUint32(36) !== 0
		|| view.getUint16(42) !== 16 || view.getUint32(44) !== 0) return null;
	const channelCount = view.getUint16(40), sampleRate = view.getUint32(48) / 65_536;
	if (![1, 2].includes(channelCount) || !Number.isInteger(sampleRate) || sampleRate < 8_000 || sampleRate > 65_535) return null;
	// Version-zero entries may carry optional complete extension atoms (for example chan).
	let offset = 52;
	for (let atoms = 0; offset < bytes.length && atoms < 256; atoms++) {
		if (bytes.length - offset < 8) return null;
		const length = view.getUint32(offset);
		if (length < 8 || length > bytes.length - offset) return null;
		offset += length;
	}
	return offset === bytes.length ? { sampleRate, channelCount } : null;
}

function ascii(bytes: Uint8Array, offset: number): string { return String.fromCharCode(...bytes.subarray(offset, offset + 4)); }
