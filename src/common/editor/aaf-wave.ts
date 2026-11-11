/* SPDX-License-Identifier: AGPL-3.0-only */

import { parseWavPcmFormat } from './wav-pcm-chunk-reader.ts';

/** A RIFF header usable as WAVEDescriptor.Summary or before raw PCM essence. */
export function aafWaveSummary(rate: number, channels: number, frames: number, bits = 24): Uint8Array {
	if (!Number.isSafeInteger(rate) || rate < 1 || !Number.isSafeInteger(channels) || channels < 1 || channels > 64
		|| ![8, 16, 24, 32].includes(bits) || !Number.isSafeInteger(frames) || frames < 0) throw new TypeError('Invalid AAF PCM geometry.');
	const alignment = channels * bits / 8, size = frames * alignment;
	if (!Number.isSafeInteger(size) || size > 0xffff_ffff - 37) throw new RangeError('AAF PCM exceeds the WAV size limit.');
	const bytes = new Uint8Array(44), view = new DataView(bytes.buffer), encoder = new TextEncoder();
	bytes.set(encoder.encode('RIFF')); view.setUint32(4, 36 + size + (size & 1), true); bytes.set(encoder.encode('WAVEfmt '), 8);
	view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
	view.setUint32(24, rate, true); view.setUint32(28, rate * alignment, true); view.setUint16(32, alignment, true); view.setUint16(34, bits, true);
	bytes.set(encoder.encode('data'), 36); view.setUint32(40, size, true); return bytes;
}

export function inspectAafWave(bytes: Uint8Array, rate: number, channels: number, frames: number): { summary: Uint8Array; sampleFormat: string } {
	const decoder = new TextDecoder(), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
	if (bytes.length < 44 || decoder.decode(bytes.subarray(0, 4)) !== 'RIFF' || decoder.decode(bytes.subarray(8, 12)) !== 'WAVE'
		|| view.getUint32(4, true) + 8 > bytes.length) throw new TypeError('AAF embedded audio requires a complete RIFF WAVE file.');
	let format: ReturnType<typeof parseWavPcmFormat> | undefined;
	for (let offset = 12; offset + 8 <= bytes.length;) {
		const tag = decoder.decode(bytes.subarray(offset, offset + 4)), size = view.getUint32(offset + 4, true);
		if (offset + 8 + size > bytes.length) throw new RangeError('Truncated AAF embedded WAVE chunk.');
		if (tag === 'fmt ') {
			if (size < 16) throw new TypeError('Truncated AAF WAVE format.');
			format = parseWavPcmFormat(bytes.subarray(offset + 8, offset + 8 + size), size);
			if (format.channelCount !== channels || format.sampleRate !== rate) throw new RangeError('AAF embedded WAVE geometry disagrees with its source.');
		}
		if (tag === 'data') {
			if (!format || size !== frames * format.blockAlign) throw new RangeError('AAF embedded WAVE geometry disagrees with its source length.');
			const summary = bytes.slice(0, offset + 8);
			if (summary.length > 65_535) throw new RangeError('AAF WAVE summary exceeds its property limit.');
			return { summary, sampleFormat: format.sampleFormat };
		}
		offset += 8 + size + (size & 1);
	}
	throw new TypeError('AAF embedded WAVE has no PCM data.');
}
