/*
 * SPDX-License-Identifier: GPL-3.0-only
 * Bounded adaptation of the Audacity 3.7.7 normalization arithmetic in basic.js
 * and basic-loudness.js; their upstream attribution and notices apply.
 */
import { normalizeAudacityEffectParams } from './manifest.js';
import { multiplyChannel, multiplyChannels } from './basic-channel-math.js';
import { createIntegratedLoudnessPowerMeter } from './basic-loudness.js';
import { ebuChannelWeights } from '../ebu-r128.js';
import { assertAudacityEffectOutput } from './pcm-channel-validation.ts';

export const NORMALIZATION_CHUNK_FRAMES = 65_536;
export interface NormalizationStep { readonly type: string; readonly params: Readonly<Record<string, unknown>> }
export interface StreamedNormalizationRequest {
	readonly effects: readonly NormalizationStep[];
	readonly frameCount: number;
	readonly channelCount: number;
	readonly sampleRate: number;
	readonly chunkFrames?: number;
	readonly yieldToMainThread?: boolean;
	readonly read: (startFrame: number, endFrame: number) => Promise<readonly Float32Array[]>;
	readonly assertCurrent: () => void;
}
type Transform = (channels: readonly Float32Array[]) => Float32Array[];

export function isStreamedNormalizationStep(step: NormalizationStep): boolean {
	return step.type === 'audacity-normalize' || step.type === 'audacity-loudness-normalization' || step.type === 'audacity-amplify' || step.type === 'audacity-remove-dc-offset';
}

/** Measure whole selections, then replay bounded reads through each Float32 stage. */
export async function prepareStreamedNormalization(request: StreamedNormalizationRequest): Promise<() => AsyncGenerator<Float32Array[]>> {
	const { frameCount, channelCount, sampleRate, effects, assertCurrent } = request;
	const chunkFrames = request.chunkFrames ?? NORMALIZATION_CHUNK_FRAMES;
	if (!Number.isSafeInteger(frameCount) || frameCount < 1 || !Number.isSafeInteger(channelCount) || channelCount < 1 || channelCount > 32
		|| !Number.isSafeInteger(chunkFrames) || chunkFrames < 1 || chunkFrames > NORMALIZATION_CHUNK_FRAMES
		|| !Number.isFinite(sampleRate) || sampleRate <= 0 || !effects.length || !effects.every(isStreamedNormalizationStep)) {
		throw new RangeError('Invalid streamed normalization dimensions or effects.');
	}
	const transforms: Transform[] = [];
	for (const effect of effects) {
		const settings = normalizeAudacityEffectParams(effect.type, effect.params) as Readonly<Record<string, unknown>>;
		transforms.push(effect.type === 'audacity-normalize' ? await measurePeak(settings)
			: effect.type === 'audacity-remove-dc-offset' ? await measurePeak({ removeDc: true, applyGain: false })
			: effect.type === 'audacity-amplify' ? await measureAmplify(settings) : await measureLoudness(settings));
	}
	return readProcessed;

	async function readPcm(start: number): Promise<Float32Array[]> {
		assertCurrent();
		const end = Math.min(frameCount, start + chunkFrames);
		const channels = [...await request.read(start, end)];
		assertCurrent();
		if (channels.length !== channelCount || channels.some(channel => channel.length !== end - start)) throw new RangeError('Invalid normalization PCM read.');
		return assertAudacityEffectOutput(channels);
	}

	async function* readProcessed(): AsyncGenerator<Float32Array[]> {
		let lastYield = performance.now();
		let pending: Promise<Float32Array[]> | undefined;
		for (let start = 0; start < frameCount; start += chunkFrames) {
			let channels = await (pending ?? readPcm(start));
			assertCurrent();
			for (const transform of transforms) channels = assertAudacityEffectOutput(transform(channels));
			const next = start + chunkFrames;
			// Only transformed packets own their PCM. The first analysis may borrow reusable read buffers.
			pending = transforms.length > 0 && next < frameCount ? readPcm(next) : undefined;
			// A sink failure may close the stream before it consumes the pending read.
			void pending?.catch(() => undefined);
			yield channels;
			if (request.yieldToMainThread !== false && performance.now() - lastYield >= 8) {
				await new Promise<void>(resolve => setTimeout(resolve, 0));
				assertCurrent(); lastYield = performance.now();
			}
		}
	}

	async function measureAmplify(settings: Readonly<Record<string, unknown>>): Promise<Transform> {
		let peak = 0, gain = 10 ** (Number(settings.gainDb) / 20);
		if (!settings.allowClipping) {
			for await (const channels of readProcessed()) for (const channel of channels) {
				for (let frame = 0; frame < channel.length; frame++) peak = Math.max(peak, Math.abs(channel[frame]!));
			}
			if (peak > 0 && peak * gain > 1) gain = 1 / peak;
		}
		return channels => multiplyChannels(channels, gain);
	}

	async function measurePeak(settings: Readonly<Record<string, unknown>>): Promise<Transform> {
		const { removeDc, applyGain, stereoIndependent } = settings;
		if (!removeDc && !applyGain) return channels => channels.map(channel => channel.slice());
		const sums = Array<number>(channelCount).fill(0), minimums = Array<number>(channelCount).fill(Infinity), maximums = Array<number>(channelCount).fill(-Infinity);
		for await (const channels of readProcessed()) for (const [index, channel] of channels.entries()) {
			let sum = sums[index]!, minimum = minimums[index]!, maximum = maximums[index]!;
			for (let frame = 0; frame < channel.length; frame++) {
				const sample = channel[frame]!;
				if (removeDc) sum += sample;
				if (applyGain) { minimum = Math.min(minimum, sample); maximum = Math.max(maximum, sample); }
			}
			sums[index] = sum;
			minimums[index] = minimum;
			maximums[index] = maximum;
		}
		const offsets = sums.map(sum => removeDc ? Math.fround(-sum / frameCount) : 0);
		const extents = offsets.map((offset, index) => applyGain ? Math.max(Math.abs(minimums[index]! + offset), Math.abs(maximums[index]! + offset)) : 0);
		const linked = Math.max(...extents), target = 10 ** (Number(settings.peakDb) / 20);
		const gains = extents.map(extent => {
			const peak = stereoIndependent ? extent : linked;
			const exact = applyGain && peak > 0 ? target / peak : 1, rounded = Math.fround(exact);
			return rounded > 0 && Number.isFinite(rounded) ? rounded : exact;
		});
		return channels => channels.map((channel, index) => {
			const output = new Float32Array(channel.length), offset = offsets[index]!, gain = gains[index]!;
			for (let frame = 0; frame < channel.length; frame++) output[frame] = (channel[frame]! + offset) * gain;
			return output;
		});
	}

	async function measureLoudness(settings: Readonly<Record<string, unknown>>): Promise<Transform> {
		const independent = Boolean(settings.stereoIndependent), rms = settings.mode === 'rms';
		if (!rms && sampleRate < 8_000) throw new RangeError('Perceived loudness normalization requires at least 8000 Hz; resample the recording or choose RMS normalization.');
		const sums = Array<number>(channelCount).fill(0);
		const meters = rms ? [] : Array.from({ length: independent ? channelCount : 1 }, () => createIntegratedLoudnessPowerMeter(independent ? 1 : channelCount, sampleRate));
		for await (const channels of readProcessed()) {
			if (rms) for (const [index, channel] of channels.entries()) {
				let sum = sums[index]!;
				for (let frame = 0; frame < channel.length; frame++) { const sample = channel[frame]!; sum += sample * sample; }
				sums[index] = sum;
			}
			else if (independent) channels.forEach((channel, index) => { meters[index]!.push([channel]); });
			else meters[0]!.push(channels);
		}
		let gains: number[];
		if (rms) {
			const values = sums.map(sum => Math.sqrt(sum / frameCount)), target = 10 ** (Number(settings.targetRmsDb) / 20);
			const linked = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / channelCount);
			gains = values.map(value => { const extent = independent ? value : linked; return extent === 0 ? 1 : target / extent; });
		} else {
			const powers = meters.map(meter => meter.finish()), target = 10 ** (Number(settings.targetLufs) / 10);
			const weights: number[] = ebuChannelWeights(channelCount);
			const programmeWeight = channelCount === 1 && settings.dualMono ? 2 : weights.reduce((sum, weight) => sum + weight, 0);
			gains = weights.map((weight, index) => {
				const power = powers[independent ? index : 0]!;
				if (power === 0 || independent && weight === 0) return 1;
				const divisor = independent ? programmeWeight : channelCount === 1 && settings.dualMono ? 2 : 1;
				return Math.sqrt(target / divisor / power);
			});
		}
		return channels => channels.map((channel, index) => multiplyChannel(channel, gains[index]!));
	}
}
