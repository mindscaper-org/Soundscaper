/* SPDX-License-Identifier: AGPL-3.0-only */

/** Native RIFF readers can wait forever when a G.711 stream ends at its odd data pad.
 * An empty, valid following chunk closes that boundary without altering encoded samples. */
export function prepareNativeRiffAudioDecode(encoded: ArrayBuffer): ArrayBuffer {
	const bytes = new Uint8Array(encoded), view = new DataView(encoded);
	if (bytes.length < 58 || bytes.length > 0xffff_fff7 || ascii(bytes, 0) !== 'RIFF'
		|| ascii(bytes, 8) !== 'WAVE' || view.getUint32(4, true) !== bytes.length - 8) return encoded;
	let format: number | null = null, frames: number | null = null, data: Readonly<{ start: number; size: number }> | null = null;
	let offset = 12;
	for (let chunks = 0; offset < bytes.length; chunks++) {
		if (chunks >= 4096 || offset + 8 > bytes.length) return encoded;
		const id = ascii(bytes, offset), size = view.getUint32(offset + 4, true), start = offset + 8;
		if (start + size + (size & 1) > bytes.length) return encoded;
		if (id === 'fmt ') { if (format !== null || size !== 18) return encoded; format = start; }
		else if (id === 'fact') { if (frames !== null || size !== 4) return encoded; frames = view.getUint32(start, true); }
		else if (id === 'data') { if (data !== null) return encoded; data = { start, size }; }
		offset = start + size + (size & 1);
	}
	if (format === null || !data || !frames || (data.size & 1) !== 1 || data.start + data.size + 1 !== bytes.length) return encoded;
	const tag = view.getUint16(format, true), sampleRate = view.getUint32(format + 4, true);
	if (tag !== 6 && tag !== 7 || view.getUint16(format + 2, true) !== 1
		|| sampleRate < 3000 || sampleRate > 384_000 || view.getUint32(format + 8, true) !== sampleRate
		|| view.getUint16(format + 12, true) !== 1 || view.getUint16(format + 14, true) !== 8
		|| view.getUint16(format + 16, true) !== 0 || frames !== data.size) return encoded;
	const output = new Uint8Array(bytes.length + 8); output.set(bytes);
	const outputView = new DataView(output.buffer);
	outputView.setUint32(4, output.length - 8, true);
	outputView.setUint32(bytes.length, 0x4b4e554a, true); // Empty JUNK, after the original data pad.
	return output.buffer;
}

function ascii(bytes: Uint8Array, offset: number): string { return String.fromCharCode(...bytes.subarray(offset, offset + 4)); }
