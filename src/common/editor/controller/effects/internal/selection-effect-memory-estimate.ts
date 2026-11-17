/* SPDX-License-Identifier: AGPL-3.0-only */
import type { EffectTarget } from '../effect-selection-service.ts';
import type { SelectionEffectExecutionRuntime } from './effect-execution-service.ts';

/** Keep legacy buffered admission available for processors without a streamed adapter. */
export function selectionEffectMemoryEstimate(runtime: SelectionEffectExecutionRuntime, type: string, params: Readonly<Record<string, unknown>>,
	targets: readonly EffectTarget[], sampleRate: number, contextFrames: number, afterContextFrames: number,
	requiresControlTrack: boolean, spectralSelections: ReadonlyMap<string, { windowSize?: number } | null | undefined>) {
	let estimatedOutputBytes = 0, estimatedPeakBytes = 0;
	for (const target of targets) {
		const estimatedFrames = Number(runtime.estimateAudioSelectionEffectOutputFrames(type, target.durationFrames, params, { sampleRate }));
		if (target.hasAudio !== false) {
			const outputFrames = target.sourceFrameCount ? target.sourceFrameCount + estimatedFrames - target.durationFrames : estimatedFrames;
			estimatedOutputBytes += outputFrames * target.channelCount * Float32Array.BYTES_PER_ELEMENT;
			if (target.sourceFrameCount) estimatedPeakBytes += (target.sourceFrameCount + outputFrames) * target.channelCount * Float32Array.BYTES_PER_ELEMENT;
		}
		estimatedPeakBytes += Number(runtime.estimateAudioSelectionEffectPeakBytes(type, target.durationFrames, params, {
			channelCount: target.channelCount, controlChannelCount: requiresControlTrack ? 2 : undefined, sampleRate,
			beforeFrames: Math.min(target.startFrame, contextFrames), afterFrames: afterContextFrames,
			spectralWindowSize: spectralSelections.get(target.track.id)?.windowSize,
		}));
	}
	return { estimatedOutputBytes, estimatedPeakBytes };
}
