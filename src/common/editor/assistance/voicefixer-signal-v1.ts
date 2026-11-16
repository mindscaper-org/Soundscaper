/* SPDX-License-Identifier: AGPL-3.0-only */
import { fftRadixTwoFloat64V1 } from './internal/radix-two-fft-v1.ts';
import { createStreamingWindowedSincResampler } from '../resample.js';
import { VOICEFIXER_SAMPLE_RATE, VOICEFIXER_NATIVE_RATE, VOICEFIXER_NATIVE_FRAMES,
	VOICEFIXER_CHUNK_FRAMES, VOICEFIXER_VOCODER_FRAMES } from './voicefixer-model.ts';

const FFT = 2_048, BINS = 1_025, HOP = 441, TIMES = 501, MELS = 128;

/** Closed NumPy v1 little-endian Float32 filterbank, never a general NumPy deserializer. */
export function parseVoiceFixerMelFiltersV1(bytes: Uint8Array): Float32Array {
	if (bytes.length < 10 || bytes[0] !== 147 || new TextDecoder().decode(bytes.subarray(1, 6)) !== 'NUMPY'
		|| bytes[6] !== 1 || bytes[7] !== 0) throw new TypeError('The VoiceFixer mel filter header is invalid.');
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const offset = 10 + view.getUint16(8, true);
	const header = new TextDecoder().decode(bytes.subarray(10, offset));
	if (!/['"]descr['"]\s*:\s*['"]<f4['"]/u.test(header)
		|| !/['"]fortran_order['"]\s*:\s*False/u.test(header)
		|| !/['"]shape['"]\s*:\s*\(1025,\s*128\)/u.test(header)
		|| bytes.length !== offset + BINS * MELS * 4) throw new TypeError('The VoiceFixer mel filter geometry is invalid.');
	const filters = new Float32Array(BINS * MELS);
	for (let i = 0; i < filters.length; i += 1) {
		const value = view.getFloat32(offset + 4 * i, true);
		if (!Number.isFinite(value) || value < 0) throw new TypeError('VoiceFixer mel filters must be finite and non-negative.');
		filters[i] = value;
	}
	return filters;
}

/** Learned inference stays in ONNX; only resampling and magnitude/mel projection live here. */
export function createVoiceFixerSignalV1(filters: Float32Array) {
	if (filters.length !== BINS * MELS || !filters.every(value => Number.isFinite(value) && value >= 0)) {
		throw new TypeError('The VoiceFixer filterbank is invalid.');
	}
	const bands = Array.from({ length: MELS }, (_, mel) => {
		const values: { bin: number; weight: number }[] = [];
		for (let bin = 0; bin < BINS; bin += 1) {
			const weight = filters[bin * MELS + mel]!;
			if (weight > 0) values.push({ bin, weight });
		}
		return values;
	});
	const window = Float64Array.from({ length: FFT }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / FFT));
	return Object.freeze({
		analyze(waveform: Float32Array, signal?: AbortSignal): Float32Array {
			finiteWave(waveform, VOICEFIXER_CHUNK_FRAMES);
			const input = resample(waveform, VOICEFIXER_SAMPLE_RATE, VOICEFIXER_NATIVE_RATE, VOICEFIXER_NATIVE_FRAMES);
			const mel = new Float32Array(TIMES * MELS);
			const real = new Float64Array(FFT), imaginary = new Float64Array(FFT), magnitude = new Float64Array(BINS);
			for (let time = 0; time < TIMES; time += 1) {
				if (time % 8 === 0) signal?.throwIfAborted();
				imaginary.fill(0);
				for (let i = 0; i < FFT; i += 1) {
					let index = time * HOP + i - FFT / 2;
					if (index < 0) index = -index;
					if (index >= input.length) index = 2 * input.length - 2 - index;
					real[i] = input[index]! * window[i]!;
				}
				fftRadixTwoFloat64V1(real, imaginary, false);
				for (let bin = 0; bin < BINS; bin += 1) magnitude[bin] = Math.hypot(real[bin]!, imaginary[bin]!);
				for (let band = 0; band < MELS; band += 1) {
					let sum = 0;
					for (const { bin, weight } of bands[band]!) sum += magnitude[bin]! * weight;
					mel[time * MELS + band] = sum;
				}
			}
			return mel;
		},
		synthesize(output: Float32Array, signal?: AbortSignal): Float32Array {
			signal?.throwIfAborted();
			finiteWave(output, VOICEFIXER_VOCODER_FRAMES);
			let peak = 1;
			for (const sample of output) peak = Math.max(peak, Math.abs(sample));
			// Match upstream restore_inmem: peak restraint followed by center alignment.
			const start = Math.floor((output.length - VOICEFIXER_NATIVE_FRAMES) / 2);
			const aligned = output.slice(start, start + VOICEFIXER_NATIVE_FRAMES);
			if (peak > 1) for (let i = 0; i < aligned.length; i += 1) aligned[i]! /= peak;
			return resample(aligned, VOICEFIXER_NATIVE_RATE, VOICEFIXER_SAMPLE_RATE, VOICEFIXER_CHUNK_FRAMES);
		},
	});
}

function resample(input: Float32Array, inputRate: number, outputRate: number, frames: number): Float32Array {
	const sampler = createStreamingWindowedSincResampler(inputRate, outputRate, 1);
	const head = sampler.push([input])[0]!, tail = sampler.finish(frames)[0]!;
	if (head.length + tail.length !== frames) throw new RangeError('The VoiceFixer resampler changed the exact duration.');
	const output = new Float32Array(frames); output.set(head); output.set(tail, head.length); return output;
}

function finiteWave(input: Float32Array, frames: number): void {
	if (!(input instanceof Float32Array) || input.length !== frames || !input.every(Number.isFinite)) {
		throw new TypeError('The VoiceFixer waveform geometry or values are invalid.');
	}
}
