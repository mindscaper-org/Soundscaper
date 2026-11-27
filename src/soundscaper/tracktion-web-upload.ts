/* SPDX-License-Identifier: AGPL-3.0-only */

import { DS64_UINT32_SENTINEL } from '../common/editor/wav-ds64.js';
import { ascii } from '../common/editor/wav-import-io.ts';

const uploadLimitMiB = { WAV: 16, ZIP: 65 } as const;

export function requireTracktionWebUpload(bytes: number, format: keyof typeof uploadLimitMiB): void {
	const limit = uploadLimitMiB[format];
	if (bytes === 0) throw new Error(`Choose a nonempty ${format} file for Tracktion`);
	if (bytes > limit * 1024 * 1024) throw new Error(`The browser Tracktion core accepts ${format} files up to ${limit} MiB`);
}

/** Keep the bounded upload consistent for JUCE without touching the user's File. */
export function prepareTracktionWebWave(input: ArrayBuffer): void {
	const bytes = new Uint8Array(input);
	if (bytes.length < 4 || ascii(bytes, 0, 4) !== 'RF64') return;
	const ds64Start = 20;
	const minimumDs64Size = 28;
	if (bytes.length < ds64Start + minimumDs64Size || ascii(bytes, 8, 8) !== 'WAVEds64') {
		throw new Error('The RF64 WAV is missing a complete ds64 header.');
	}
	const header = new DataView(input);
	const directorySize = header.getUint32(16, true);
	const payload32 = header.getUint32(4, true);
	const riffSize = payload32 === DS64_UINT32_SENTINEL ? header.getBigUint64(ds64Start, true) : BigInt(payload32);
	const riffEnd = Number(riffSize + 8n);
	const firstChunk = ds64Start + directorySize + (directorySize % 2);
	if (directorySize < minimumDs64Size || riffEnd > bytes.length || firstChunk > riffEnd) {
		throw new Error('The RF64 WAV payload is truncated.');
	}
	// JUCE uses ds64 sizes even when a finite 32-bit field is authoritative.
	header.setBigUint64(ds64Start, riffSize, true);
	for (let offset = firstChunk; offset + 8 <= riffEnd;) {
		const length32 = header.getUint32(offset + 4, true);
		const payload = offset + 8;
		if (ascii(bytes, offset, 4) === 'data') {
			const dataSizeOffset = ds64Start + 8;
			const length = length32 === DS64_UINT32_SENTINEL ? header.getBigUint64(dataSizeOffset, true) : BigInt(length32);
			if (length > BigInt(riffEnd - payload)) throw new Error('The RF64 WAV audio data is truncated.');
			// Give JUCE's 32-bit chunk-bound check the same bounded length.
			header.setBigUint64(dataSizeOffset, length, true);
			header.setUint32(offset + 4, Number(length), true);
			return;
		}
		offset = payload + length32 + (length32 % 2);
	}
}
