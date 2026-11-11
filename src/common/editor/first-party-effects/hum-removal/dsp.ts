/* SPDX-License-Identifier: AGPL-3.0-only */

import { humRemovalCoefficients, normalizeHumRemovalParams } from './definition.ts';
import { validateGeometry } from '../dynamics/core.ts';
import type { NormalizedIirCoefficients } from '../standard/filters-coefficients.ts';

interface Options {
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly params?: Readonly<Record<string, unknown>>;
}

class NotchBank {
	private readonly state: Float64Array;
	constructor(private readonly coefficients: readonly NormalizedIirCoefficients[], channels: number) {
		this.state = new Float64Array(channels * coefficients.length * 2);
	}

	reset(): void { this.state.fill(0); }

	tick(sample: number, channel: number): number {
		const base = channel * this.coefficients.length * 2;
		let value = sample;
		for (let stage = 0; stage < this.coefficients.length; stage++) {
			const coefficient = this.coefficients[stage];
			const index = base + stage * 2;
			const filtered = coefficient[0] * value + this.state[index];
			this.state[index] = coefficient[1] * value - coefficient[3] * filtered + this.state[index + 1];
			this.state[index + 1] = coefficient[2] * value - coefficient[4] * filtered;
			value = filtered;
		}
		return value;
	}
}

/** Fixed-frequency harmonic rejection with independent channel histories.
 * Live updates crossfade banks over 20 ms. Rapid changes replace only the
 * latest queued bank, preserving the in-flight fade and bounding retained
 * storage. Coefficients and buffers are allocated only at construction or
 * configuration, never in the audio callback.
 */
export function createHumRemovalProcessor({ sampleRate, channelCount, params = {} }: Options) {
	validateGeometry(sampleRate, channelCount);
	let settings = normalizeHumRemovalParams(params);
	let active = new NotchBank(humRemovalCoefficients(settings, sampleRate), channelCount);
	let incoming: NotchBank | null = null;
	let queued: NotchBank | null = null;
	let fadeFrame = 0;
	const fadeFrames = Math.max(1, Math.round(.02 * sampleRate));
	return {
		reset(): void {
			active = queued ?? incoming ?? active;
			active.reset();
			incoming = null;
			queued = null;
			fadeFrame = 0;
		},
		updateParams(nextParams: Readonly<Record<string, unknown>>): void {
			const next = normalizeHumRemovalParams({ ...settings, ...nextParams });
			if (next.frequency === settings.frequency && next.harmonics === settings.harmonics
				&& next.bandwidth === settings.bandwidth && next.reduction === settings.reduction) return;
			const bank = new NotchBank(humRemovalCoefficients(next, sampleRate), channelCount);
			settings = next;
			if (incoming) queued = bank;
			else incoming = bank;
		},
		processBlock(input: readonly Float32Array[], output: readonly Float32Array[], frames: number): void {
			if (!Number.isSafeInteger(frames) || frames < 0 || input.length > channelCount || output.length !== channelCount) {
				throw new RangeError('The hum removal block must match its channel count.');
			}
			for (let channel = 0; channel < channelCount; channel++) {
				if ((input[channel] && input[channel].length < frames) || output[channel].length < frames) {
					throw new RangeError('The hum removal block must provide a buffer for every frame.');
				}
			}
			for (let frame = 0; frame < frames; frame++) {
				const mix = incoming ? (fadeFrame + 1) / fadeFrames : 0;
				for (let channel = 0; channel < channelCount; channel++) {
					const sample = input[channel]?.[frame] ?? 0;
					const safe = Number.isFinite(sample) ? sample : 0;
					const value = active.tick(safe, channel);
					output[channel][frame] = incoming ? value + mix * (incoming.tick(safe, channel) - value) : value;
				}
				if (incoming && ++fadeFrame >= fadeFrames) {
					active = incoming;
					incoming = queued;
					queued = null;
					fadeFrame = 0;
				}
			}
		},
	};
}
