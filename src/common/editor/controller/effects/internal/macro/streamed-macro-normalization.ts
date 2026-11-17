/* SPDX-License-Identifier: AGPL-3.0-only */
import { prepareStreamedNormalization, NORMALIZATION_CHUNK_FRAMES, type NormalizationStep } from '../../../../audacity-effects/streamed-normalization.ts';
import { createWaveformPeakBuilder, type WaveformPeakPyramid } from '../../../../waveform-peak-builder.ts';
import { WAVEFORM_PEAK_MAX_SOURCE_BYTES } from '../../../../waveform-peak-contract.ts';
import { peakCacheKey } from '../../../../source-analysis-cache.ts';
import { loadSourceProvenanceDerivation } from '../../../../source-provenance-derivation-loader.ts';
import type { AudioEditorCommand } from '../../../../commands/protocol.ts';
import type { EffectTarget } from '../../effect-selection-service.ts';
import type { EffectResultProject, EffectResultSource, EffectResultStore, EffectResultSelectionDetails } from '../effect-result-service.ts';

export interface StreamedMacroNormalizationPlan {
	readonly target: EffectTarget;
	readonly effects: readonly NormalizationStep[];
}
export interface StreamedMacroNormalizationOptions {
	readonly effectName: string;
	readonly sampleRate: number;
	readonly assertCurrent: () => void;
	readonly selectionDetails: EffectResultSelectionDetails;
	readonly signal: AbortSignal;
}
export type RunStreamedMacroNormalization = (plans: readonly StreamedMacroNormalizationPlan[], options: StreamedMacroNormalizationOptions) => Promise<void>;
interface Runtime {
	readonly chunkFrames: number;
	readonly memoryLimitBytes: number;
	readonly getProject: () => EffectResultProject;
	readonly createId: () => string;
	readonly read: (trackId: string, start: number, end: number, channels: number, clipIds?: readonly string[]) => Promise<readonly Float32Array[]>;
	readonly store: EffectResultStore;
	readonly activateSource: (source: EffectResultSource, signal: AbortSignal, peaks: WaveformPeakPyramid) => Promise<unknown>;
	readonly releaseSource: (sourceId: string) => Promise<unknown>;
	readonly prepareReplacement: (target: EffectTarget, source: EffectResultSource) => AudioEditorCommand;
	readonly publish: (command: AudioEditorCommand, trackId: string, clipId?: string) => unknown;
}

/** Write every selected track before publishing one history edit; failures remove all staged media. */
export function createStreamedMacroNormalizationService(runtime: Runtime): RunStreamedMacroNormalization {
	return async (plans, options) => {
		const { assertCurrent, sampleRate, effectName } = options;
		const sources: string[] = [], commands: AudioEditorCommand[] = [];
		const first = plans[0]?.target;
		if (!first || plans.some(({ target }) => target.sourceId || target.clipId || target.durationFrames !== first.durationFrames || target.startFrame !== first.startFrame)) {
			throw new RangeError('Streamed macro normalization requires aligned timeline ranges.');
		}
		// Peaks coarsen to a fixed cap. Budget both the builder and persistence copy,
		// four PCM chunks, and independent loudness rings/histograms at the native rate.
		const width = Math.max(...plans.map(({ target }) => target.channelCount));
		const peakBytes = WAVEFORM_PEAK_MAX_SOURCE_BYTES * 2 + width * (NORMALIZATION_CHUNK_FRAMES * 4 * 4 + Math.ceil(sampleRate * .4) * 8 + 65_536 * 4);
		if (peakBytes > runtime.memoryLimitBytes) throw new RangeError('Streamed normalization exceeds the effect memory budget.');
		try {
			assertCurrent();
			const { deriveEffectResultProvenance } = await loadSourceProvenanceDerivation();
			assertCurrent();
			for (const { target, effects } of plans) {
				if (!target.hasAudio) continue;
				const stream = await prepareStreamedNormalization({ effects, sampleRate, frameCount: target.durationFrames,
					channelCount: target.channelCount, assertCurrent,
					read: (start, end) => runtime.read(target.track.id, target.startFrame + start, target.startFrame + end, target.channelCount, target.clipIds) });
				assertCurrent();
				const sourceId = runtime.createId(), name = `${target.track.name} — ${effectName}.wav`;
				const provenance = deriveEffectResultProvenance(runtime.getProject(), target);
				const source: EffectResultSource = { id: sourceId, storageKey: sourceId, name, mimeType: 'audio/wav',
					frameCount: target.durationFrames, channelCount: target.channelCount, sampleRate, originalSampleRate: sampleRate,
					...(provenance ? { provenance } : {}) };
				const writer = await runtime.store.beginSourceWrite(sourceId, { name, mimeType: 'audio/wav', sampleRate,
					channelCount: target.channelCount, chunkFrames: runtime.chunkFrames });
				try {
					assertCurrent();
					const peaks = createWaveformPeakBuilder(source);
					for await (const channels of stream()) {
						assertCurrent(); peaks.append(channels);
						await writer.write(channels); assertCurrent();
					}
					await writer.commit({ sampleRate, channelCount: target.channelCount });
					sources.push(sourceId); assertCurrent();
					await runtime.activateSource(source, options.signal, peaks.finish());
					assertCurrent(); commands.push(runtime.prepareReplacement(target, source));
				} catch (error) {
					await Promise.resolve(writer.abort(error)).catch(() => undefined);
					throw error;
				}
			}
			assertCurrent();
			const replacement = commands.length === 1 && commands[0]?.type === 'range/replace' ? commands[0] : undefined;
			runtime.publish({ type: 'batch', commands: [...commands, { type: 'selection/set',
				startFrame: first.startFrame, endFrame: first.endFrame, ...options.selectionDetails }] }, first.track.id, replacement?.clipId);
		} catch (error) {
			for (const sourceId of sources) {
				await runtime.releaseSource(sourceId).catch(() => undefined);
				await runtime.store.deleteAnalysis?.(peakCacheKey(sourceId)).catch(() => undefined);
				await runtime.store.deleteSource(sourceId).catch(() => undefined);
			}
			throw error;
		}
	};
}
