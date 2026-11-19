/* SPDX-License-Identifier: AGPL-3.0-only */
import { STREAMED_EFFECT_CHUNK_FRAMES } from '../../../../streamed-effects/admission.ts';
import { assertAudacityEffectOutput } from '../../../../audacity-effects/pcm-channel-validation.ts';
import type { EffectTarget } from '../../effect-selection-service.ts';

/** Amplify's dialog and untouched Apply defaults need a scalar, never retained selection PCM. */
export async function measureSelectionPeak(targets: readonly EffectTarget[], read: (target: EffectTarget, start: number, end: number) => Promise<readonly Float32Array[]>, assertCurrent: () => void): Promise<number> {
	let peak = 0, lastYield = performance.now();
	for (const target of targets) for (let start = target.startFrame; start < target.endFrame; start += STREAMED_EFFECT_CHUNK_FRAMES) {
		assertCurrent(); const end = Math.min(target.endFrame, start + STREAMED_EFFECT_CHUNK_FRAMES);
		const channels = [...await read(target, start, end)]; assertCurrent(); assertAudacityEffectOutput(channels);
		if (channels.length !== target.channelCount || channels.some(channel => channel.length !== end - start)) throw new RangeError('Incomplete Amplify peak read.');
		for (const channel of channels) for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
		if (performance.now() - lastYield >= 8) { await new Promise<void>(resolve => setTimeout(resolve, 0)); assertCurrent(); lastYield = performance.now(); }
	}
	return peak;
}
