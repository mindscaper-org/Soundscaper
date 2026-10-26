/* SPDX-License-Identifier: AGPL-3.0-only */

/** No decoded PCM was accepted: an ordinary LC description instead produced in-band SBR/PS. */
export class InitialAacSbrError extends RangeError {
	constructor() { super('The decoded compressed audio sample geometry changed or is unsupported.'); }
}

export function initialAacSbrError(config: AudioDecoderConfig, sample: Readonly<{ sampleRate: number; numberOfChannels: number }>): InitialAacSbrError | null {
	const description = config.description;
	const bytes = description instanceof ArrayBuffer ? new Uint8Array(description)
		: description && ArrayBuffer.isView(description) ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength) : null;
	if (config.codec !== 'mp4a.40.2' || !bytes || bytes.length !== 2 || bytes[0]! >> 3 !== 2 || bytes[1]! & 7) return null;
	const rateIndex = (bytes[0]! & 7) << 1 | bytes[1]! >> 7, channels = bytes[1]! >> 3 & 15;
	const rate = [96_000, 88_200, 64_000, 48_000, 44_100, 32_000, 24_000, 22_050, 16_000, 12_000, 11_025, 8_000, 7350][rateIndex];
	if (!rate || rate < 8000 || rate > 48_000 || rate !== config.sampleRate || ![1, 2].includes(channels)
		|| channels !== config.numberOfChannels || sample.sampleRate !== rate * 2
		|| !(sample.numberOfChannels === channels || channels === 1 && sample.numberOfChannels === 2)) return null;
	return new InitialAacSbrError();
}
