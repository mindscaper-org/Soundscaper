/* SPDX-License-Identifier: AGPL-3.0-only */
import { estimateAudioSelectionEffectPeakBytes } from '../selection-effects.js';
import { TRUE_PEAK_FACTOR } from '../audacity-effects/true-peak-limiter-parameters.ts';
import { normalizeAudioSelectionEffectParams } from '../effects.js';
import { STREAMED_EFFECT_CHUNK_FRAMES, type StreamedEffectStep } from './admission.ts';

/** Include simultaneous host/worker packets and persistent histories that a short one-shot estimate omits. */
export function streamedEffectPeakBytes(effects: readonly StreamedEffectStep[], frames: number, channels: number, sampleRate: number): number {
	let bytes = STREAMED_EFFECT_CHUNK_FRAMES * channels * 4 * 8;
	for (const effect of effects) {
		const params = normalizeAudioSelectionEffectParams(effect.type, effect.params) as Readonly<Record<string, unknown>>;
		bytes += estimateAudioSelectionEffectPeakBytes(effect.type, Math.min(frames, STREAMED_EFFECT_CHUNK_FRAMES), params, { sampleRate, channelCount: channels });
		if (effect.type === 'audacity-echo') {
			const delay = Math.floor(sampleRate * Number(params.delaySeconds));
			if (Number(params.decay) !== 0 && delay < frames) bytes += delay * channels * 4;
		}
		if (effect.type === 'audacity-compressor' || effect.type === 'audacity-limiter') bytes += Math.ceil(sampleRate * Number(params.lookaheadMs) / 1000) * (channels * 4 + 24);
		if (effect.type === 'audacity-limiter' && params.limitTruePeaks) bytes += STREAMED_EFFECT_CHUNK_FRAMES * TRUE_PEAK_FACTOR * (channels * 12 + 24);
		if (effect.type === 'audacity-loudness-normalization') bytes += channels * (Math.ceil(sampleRate * .4) * 8 + 65536 * 4);
		if (effect.type === 'audacity-auto-duck') bytes += Math.ceil(sampleRate * (Number(params.maximumPause) + Number(params.outerFadeDown) + Number(params.outerFadeUp) + Number(params.innerFadeUp))) * (channels * 4 + 32);
		if (effect.type === 'audacity-reverb') bytes += channels * sampleRate * 8;
		if (effect.type === 'audacity-distortion' && params.dcBlock) bytes += channels * Math.ceil(sampleRate / 20) * 8;
		if (effect.type === 'audacity-noise-reduction') {
			const context = 4096 + 2 * 2048 + (6 + Math.floor(.12 * sampleRate / 512)) * 512;
			bytes += context * (channels * 12 + 40);
		}
	}
	if (!Number.isSafeInteger(bytes) || bytes < 0) throw new RangeError('Invalid streamed effect memory envelope.');
	return bytes;
}
