/* SPDX-License-Identifier: AGPL-3.0-only */

const STANDARD_RATES = new Map([[3, 32_000], [8, 44_100], [13, 48_000]]);

/** ETSI TS102114 §5.3: complete 16-bit big-endian core frames own their clock. */
export function inspectDtsAudioSampleRate(bytes: Uint8Array): number | null {
	let offset = 0, sampleRate: number | null = null;
	for (let frames = 0; offset < bytes.length && frames < 1_000_000; frames++) {
		if (bytes.length - offset < 18 || bytes[offset] !== 0x7f || bytes[offset + 1] !== 0xfe
			|| bytes[offset + 2] !== 0x80 || bytes[offset + 3] !== 1) return null;
		// Normal frames have 32-sample blocks; termination/extension rates are not inferred.
		const blocks = ((bytes[offset + 4]! & 1) * 64 + (bytes[offset + 5]! >>> 2)) + 1;
		const length = ((bytes[offset + 5]! & 3) * 4096 + bytes[offset + 6]! * 16 + (bytes[offset + 7]! >>> 4)) + 1;
		const channelMode = (bytes[offset + 7]! & 15) * 4 + (bytes[offset + 8]! >>> 6);
		const rate = STANDARD_RATES.get(bytes[offset + 8]! >>> 2 & 15);
		if ((bytes[offset + 4]! & 0xfc) !== 0xfc || blocks % 8 !== 0 || length < 96
			|| length > bytes.length - offset || channelMode > 15 || !rate
			|| bytes[offset + 9]! & 16 || bytes[offset + 10]! & 0xf0
			|| (bytes[offset + 10]! >>> 1 & 3) === 3 || sampleRate !== null && rate !== sampleRate) return null;
		offset += length; sampleRate = rate;
	}
	return offset === bytes.length ? sampleRate : null;
}
