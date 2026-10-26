/* SPDX-License-Identifier: AGPL-3.0-only */

const SAMPLE_RATES = [48_000, 44_100, 32_000] as const;
const BITRATES = [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 448, 512, 576, 640] as const;

/** Complete AC-3 bsid8 / independent E-AC-3 bsid16 frames own their decoded clock. */
export function inspectDolbyAudioSampleRate(bytes: Uint8Array): number | null {
	let offset = 0, sampleRate: number | null = null, bitstream: number | null = null;
	for (let count = 0; offset < bytes.length && count < 1_000_000; count++) {
		if (bytes.length - offset < 7 || bytes[offset] !== 0x0b || bytes[offset + 1] !== 0x77) return null;
		const version = bytes[offset + 5]! >>> 3, rateCode = bytes[offset + 4]! >>> 6;
		const rate = SAMPLE_RATES[rateCode];
		if (!rate || sampleRate !== null && rate !== sampleRate || bitstream !== null && version !== bitstream) return null;
		let frameBytes: number;
		if (version === 8) {
			const code = bytes[offset + 4]! & 63, bitrate = BITRATES[code >>> 1];
			if (!bitrate) return null;
			// A/52 frame-size words:44.1kHz alternates the two adjacent word lengths.
			frameBytes = rateCode === 0 ? bitrate * 4 : rateCode === 2 ? bitrate * 6
				: 2 * (Math.floor(bitrate * 320 / 147) + (code & 1));
		} else if (version === 16 && (bytes[offset + 2]! & 0xf8) === 0) {
			frameBytes = 2 * (1 + ((bytes[offset + 2]! & 7) * 256 + bytes[offset + 3]!));
		} else return null;
		if (frameBytes < 7 || frameBytes > bytes.length - offset) return null;
		offset += frameBytes; sampleRate = rate; bitstream = version;
	}
	return offset === bytes.length ? sampleRate : null;
}
