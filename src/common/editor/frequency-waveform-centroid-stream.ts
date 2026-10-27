/*
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Rainbow spectral-centroid analysis adapted from Freesound's processing.py at
 * commit ef5e42938c9ca4aace39d9d04b65752d161321e8. Copyright (C) 2008 MUSIC
 * TECHNOLOGY GROUP (MTG), UNIVERSITAT POMPEU FABRA; author Bram de Jong;
 * AGPL-3.0-or-later upstream, with version 3 selected for this adaptation.
 * See THIRD_PARTY_LICENSES.md for the exact source and modification notice.
 */

import { FREQUENCY_WAVEFORM_FFT_SIZE, FREQUENCY_WAVEFORM_HOP_SIZE } from './frequency-waveform-contract.ts';

export type FrequencyWaveformFft = (real: Float32Array, imaginary: Float32Array) => void;
export interface FrequencyWaveformCentroidLevel {
	readonly blockSize: number;
	readonly centroid: { readonly numerators: Float32Array; readonly weights: Float32Array };
}

/** The shared ordered FFT stream serves both source pyramids and detailed windows. */
export class FrequencyWaveformCentroidStream {
	private readonly spectralBuffers: Float32Array[];
	private readonly hann: Float32Array;
	private readonly real = new Float32Array(FREQUENCY_WAVEFORM_FFT_SIZE);
	private readonly imaginary = new Float32Array(FREQUENCY_WAVEFORM_FFT_SIZE);
	private spectralLength = FREQUENCY_WAVEFORM_FFT_SIZE / 2;
	private spectralStart = 0;
	private nextCenterFrame = 0;
	constructor(private readonly sampleRate: number, private readonly visualChannelCount: number,
		private readonly levels: readonly FrequencyWaveformCentroidLevel[], private readonly transform: FrequencyWaveformFft) {
		this.spectralBuffers = Array.from({ length: visualChannelCount }, () => new Float32Array(FREQUENCY_WAVEFORM_FFT_SIZE));
		this.hann = Float32Array.from({ length: FREQUENCY_WAVEFORM_FFT_SIZE }, (_, index) => (
			0.5 - 0.5 * Math.cos(2 * Math.PI * index / (FREQUENCY_WAVEFORM_FFT_SIZE - 1))
		));
	}
	push(channels: readonly Float32Array[]): void {
		for (let frame = 0; frame < (channels[0]?.length ?? 0); frame++) this.appendSpectralFrame(channels, frame);
	}
	finish(frameCount: number): void {
		while (this.nextCenterFrame < frameCount) this.appendSpectralSilence();
	}
	private appendSpectralFrame(channels: readonly Float32Array[], frame: number): void {
		let writeIndex = this.spectralStart + this.spectralLength;
		if (writeIndex >= FREQUENCY_WAVEFORM_FFT_SIZE) writeIndex -= FREQUENCY_WAVEFORM_FFT_SIZE;
		for (let channel = 0; channel < this.visualChannelCount; channel += 1) {
			this.spectralBuffers[channel]![writeIndex] = finiteSample(channels[channel]![frame]);
		}
		this.spectralLength += 1;
		this.analyzeFullSpectralBuffer();
	}

	private appendSpectralSilence(): void {
		let writeIndex = this.spectralStart + this.spectralLength;
		if (writeIndex >= FREQUENCY_WAVEFORM_FFT_SIZE) writeIndex -= FREQUENCY_WAVEFORM_FFT_SIZE;
		for (let channel = 0; channel < this.visualChannelCount; channel += 1) {
			this.spectralBuffers[channel]![writeIndex] = 0;
		}
		this.spectralLength += 1;
		this.analyzeFullSpectralBuffer();
	}

	private analyzeFullSpectralBuffer(): void {
		if (this.spectralLength < FREQUENCY_WAVEFORM_FFT_SIZE) return;
		let numerator = 0;
		let weight = 0;
		for (let channel = 0; channel < this.visualChannelCount; channel += 1) {
			const buffer = this.spectralBuffers[channel]!;
			this.imaginary.fill(0);
			const firstSpan = FREQUENCY_WAVEFORM_FFT_SIZE - this.spectralStart;
			for (let index = 0; index < firstSpan; index += 1) {
				this.real[index] = buffer[this.spectralStart + index]! * this.hann[index]!;
			}
			for (let index = firstSpan; index < FREQUENCY_WAVEFORM_FFT_SIZE; index += 1) {
				this.real[index] = buffer[index - firstSpan]! * this.hann[index]!;
			}
			this.transform(this.real, this.imaginary);
			for (let bin = 2; bin <= FREQUENCY_WAVEFORM_FFT_SIZE / 2; bin += 1) {
				const magnitude = Math.hypot(this.real[bin]!, this.imaginary[bin]!);
				weight += magnitude;
				numerator += magnitude * bin * this.sampleRate / FREQUENCY_WAVEFORM_FFT_SIZE;
			}
		}
		for (const level of this.levels) {
			const bucket = Math.floor(this.nextCenterFrame / level.blockSize);
			if (bucket < level.centroid.weights.length) {
				level.centroid.numerators[bucket] += numerator;
				level.centroid.weights[bucket] += weight;
			}
		}
		this.nextCenterFrame += FREQUENCY_WAVEFORM_HOP_SIZE;
		this.spectralStart += FREQUENCY_WAVEFORM_HOP_SIZE;
		if (this.spectralStart >= FREQUENCY_WAVEFORM_FFT_SIZE) this.spectralStart -= FREQUENCY_WAVEFORM_FFT_SIZE;
		this.spectralLength -= FREQUENCY_WAVEFORM_HOP_SIZE;
	}
}
function finiteSample(value: number | undefined): number { return Number.isFinite(value) ? value! : 0; }
