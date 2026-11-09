/* SPDX-License-Identifier: AGPL-3.0-only */

import type { RawPcmByteOrder, RawPcmSampleFormat } from './raw-pcm-import.ts';

export interface RawPcmDetection {
	readonly sampleFormat: RawPcmSampleFormat;
	readonly byteOrder: RawPcmByteOrder;
	readonly channelCount: 1 | 2;
}

const WIDTHS = { uint8: 1, int16: 2, int24: 3, int32: 4, float32: 4 } as const;
// Divisible by every candidate frame width, including stereo 24-bit PCM.
const WINDOW_BYTES = 32_760;

/** Estimate headerless PCM settings from signal continuity. Rate is unknowable
 * without metadata; offset is a caller choice. Silence/noise may be inconclusive.
 * At most three small slices are read, even for desktop files larger than RAM. */
export async function detectRawPcmFormat(file: Pick<File, 'size' | 'slice'>,
	options: Readonly<{ offsetBytes?: number; signal?: AbortSignal }> = {}): Promise<RawPcmDetection | null> {
	options.signal?.throwIfAborted();
	const offset = options.offsetBytes ?? 0;
	if (!Number.isSafeInteger(file.size) || !Number.isSafeInteger(offset) || offset < 0 || offset > file.size) return null;
	const length = file.size - offset;
	if (length < 128) return null;
	const positions = new Set([0, Math.floor(Math.max(0, length / 2 - WINDOW_BYTES / 2) / 24) * 24,
		Math.floor(Math.max(0, length - WINDOW_BYTES) / 24) * 24]);
	const windows: DataView[] = [];
	for (const position of positions) {
		options.signal?.throwIfAborted();
		const bytes = await file.slice(offset + position, offset + Math.min(length, position + WINDOW_BYTES)).arrayBuffer();
		options.signal?.throwIfAborted();
		windows.push(new DataView(bytes));
	}
	let best: RawPcmDetection | null = null;
	let bestScore = .25;
	for (const sampleFormat of Object.keys(WIDTHS) as RawPcmSampleFormat[]) {
		for (const byteOrder of ['little', 'big'] as const) {
			if (sampleFormat === 'uint8' && byteOrder === 'big') continue;
			for (const channelCount of [1, 2] as const) {
				if (length % (WIDTHS[sampleFormat] * channelCount)) continue;
				const candidate = { sampleFormat, byteOrder, channelCount };
				const scores = windows.map(window => continuityScore(window, candidate)).filter(Number.isFinite);
				if (!scores.length) continue;
				const score = scores.reduce((sum, value) => sum + value, 0) / scores.length;
				// Similar scores favour narrower samples and mono: wider integer
				// interpretations can hide an interleaved channel in their low bits.
				if (score < bestScore * .9) { best = candidate; bestScore = score; }
			}
		}
	}
	return best;
}

function continuityScore(view: DataView, format: RawPcmDetection): number {
	const width = WIDTHS[format.sampleFormat];
	const frames = Math.min(4096, Math.floor(view.byteLength / (width * format.channelCount)));
	if (frames < 64) return Infinity;
	let score = Infinity;
	for (let channel = 0; channel < format.channelCount; channel += 1) {
		let sum = 0, power = 0, difference = 0, previous = 0;
		for (let frame = 0; frame < frames; frame += 1) {
			const value = readSample(view, (frame * format.channelCount + channel) * width, format);
			if (!Number.isFinite(value) || Math.abs(value) > 1) return Infinity;
			sum += value; power += value * value;
			if (frame) difference += (value - previous) ** 2;
			previous = value;
		}
		const variance = power - sum * sum / frames;
		if (variance <= frames * 1e-12) continue;
		const continuity = difference / variance;
		if (continuity > .5) return Infinity;
		// Stereo channels can have different spectra or one can be silent.
		// Let the channel with the clearest continuity supply the evidence.
		score = Math.min(score, continuity);
	}
	return score;
}

function readSample(view: DataView, offset: number, format: RawPcmDetection): number {
	const little = format.byteOrder === 'little';
	switch (format.sampleFormat) {
		case 'uint8': return (view.getUint8(offset) - 128) / 128;
		case 'int16': return view.getInt16(offset, little) / 32768;
		case 'int32': return view.getInt32(offset, little) / 2147483648;
		case 'float32': return view.getFloat32(offset, little);
		case 'int24': {
			const high = view.getInt8(offset + (little ? 2 : 0));
			const middle = view.getUint8(offset + 1);
			const low = view.getUint8(offset + (little ? 0 : 2));
			return (high * 65536 + middle * 256 + low) / 8388608;
		}
	}
}
