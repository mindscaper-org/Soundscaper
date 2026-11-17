/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWaveformPeakBuilder, type WaveformPeakPyramid } from '../../../../waveform-peak-builder.ts';
import { WAVEFORM_PEAK_MAX_SOURCE_BYTES } from '../../../../waveform-peak-contract.ts';
import { peakCacheKey } from '../../../../source-analysis-cache.ts';
import { loadSourceProvenanceDerivation } from '../../../../source-provenance-derivation-loader.ts';
import { streamedEffectPeakBytes } from '../../../../streamed-effects/memory.ts';
import { isStreamedGainEffect, type StreamedEffectStep } from '../../../../streamed-effects/admission.ts';
import type { StreamedProcessingRequest, StreamedProcessingPorts } from '../../../../streamed-effects/processing.ts';
import type { AudioEditorCommand } from '../../../../commands/protocol.ts';
import type { EffectTarget } from '../../effect-selection-service.ts';
import type { EffectResultProject, EffectResultSource, EffectResultStore, EffectResultSelectionDetails } from '../effect-result-service.ts';
import { prepareExactClipEffectResultCommands } from '../effect-result-clip-commands.ts';
import { createStreamedPcmWriter } from './pcm-writer.ts';

export interface StreamedEffectPlan { readonly target: EffectTarget; readonly effects: readonly StreamedEffectStep[]; readonly preRollFrames?: number }
export interface StreamedEffectOptions {
	readonly effectName: string; readonly sampleRate: number; readonly assertCurrent: () => void;
	readonly selectionDetails: EffectResultSelectionDetails; readonly signal: AbortSignal;
}
export type RunStreamedEffects = (plans: readonly StreamedEffectPlan[], options: StreamedEffectOptions) => Promise<void>;
export interface StreamedEffectRuntime {
	readonly chunkFrames: number; readonly memoryLimitBytes: number; readonly memoryError?: () => Error;
	readonly getProject: () => EffectResultProject; readonly createId: () => string;
	readonly read: (trackId: string, start: number, end: number, channels: number, clipIds?: readonly string[]) => Promise<readonly Float32Array[]>;
	readonly readControl?: (trackId: string, target: EffectTarget) => Promise<readonly Float32Array[]>;
	readonly readStored: (source: EffectResultSource, start: number, end: number, signal: AbortSignal) => Promise<readonly Float32Array[]>;
	readonly process: (request: StreamedProcessingRequest, ports: StreamedProcessingPorts, signal: AbortSignal) => Promise<void>;
	readonly store: EffectResultStore;
	readonly activateSource: (source: EffectResultSource, signal: AbortSignal, peaks: WaveformPeakPyramid) => Promise<unknown>;
	readonly releaseSource: (sourceId: string) => Promise<unknown>;
	readonly prepareReplacement: (target: EffectTarget, source: EffectResultSource) => AudioEditorCommand;
	readonly publish: (command: AudioEditorCommand, trackId: string, clipId?: string) => unknown;
}

/** Shared by ordinary Apply and macros. All selected sources become playable before one history edit. */
export function createStreamedEffectService(runtime: StreamedEffectRuntime): RunStreamedEffects {
	return async (plans, options) => {
		const { sampleRate, signal } = options;
		const assertCurrent = (): void => { signal.throwIfAborted(); options.assertCurrent(); };
		const staged = new Set<string>();
		const entries: Array<{ target: EffectTarget; source: EffectResultSource; frameCount: number }> = [];
		const first = plans[0]?.target;
		if (!first || !plans.every(plan => plan.effects.length > 0) || plans.some(({ target }) => Boolean(target.clipId) !== Boolean(first.clipId)
			|| !first.clipId && (target.startFrame !== first.startFrame || target.durationFrames !== first.durationFrames))) throw new RangeError('Streamed effect targets have incompatible ranges.');
		// One job at a time; DSP histories and I/O are charged independently of selection length.
		for (const plan of plans) {
			const scratch = streamedEffectPeakBytes(plan.effects, plan.target.durationFrames, plan.target.channelCount, sampleRate);
			if (scratch + WAVEFORM_PEAK_MAX_SOURCE_BYTES * 2 > runtime.memoryLimitBytes) throw runtime.memoryError?.() ?? new RangeError('Streamed effects exceed the effect memory budget.');
		}
		try {
			assertCurrent(); const { deriveEffectResultProvenance, deriveSourceProvenanceForIds } = await loadSourceProvenanceDerivation(); assertCurrent();
			for (const plan of plans) {
				const { target } = plan; if (target.hasAudio === false) continue;
				const segments: StreamedEffectStep[][] = [];
				for (const effect of plan.effects) {
					const open = segments.at(-1);
					if (open && isStreamedGainEffect(open[0]!.type) === isStreamedGainEffect(effect.type)) open.push(effect); else segments.push([effect]);
				}
				let previous: EffectResultSource | undefined;
				for (const [index, effects] of segments.entries()) {
					assertCurrent(); const final = index === segments.length - 1;
					const prefix = isStreamedGainEffect(effects[0]!.type) ? 0 : Math.min(target.startFrame, plan.preRollFrames ?? 0);
					const sourceId = runtime.createId(), name = `${target.track.name} — ${options.effectName}.wav`;
					const provenance = target.sourceId ? deriveSourceProvenanceForIds(runtime.getProject().sources ?? [], [target.sourceId]) : deriveEffectResultProvenance(runtime.getProject(), target);
					const source: EffectResultSource = { id: sourceId, storageKey: sourceId, name, mimeType: 'audio/wav',
						frameCount: final && target.sourceId ? target.sourceFrameCount! : target.durationFrames,
						channelCount: target.channelCount, sampleRate, originalSampleRate: sampleRate, ...(provenance ? { provenance } : {}) };
					const writer = await runtime.store.beginSourceWrite(sourceId, { name, mimeType: 'audio/wav', sampleRate, channelCount: target.channelCount, chunkFrames: runtime.chunkFrames });
					try {
						assertCurrent(); const peaks = final ? createWaveformPeakBuilder(source) : undefined;
						const output = createStreamedPcmWriter(writer, target.channelCount, runtime.chunkFrames, assertCurrent, peaks ? channels => peaks.append(channels) : undefined);
						if (final && target.sourceId) await copyOriginal(0, target.startFrame, output.write);
						let discarded = 0;
						await runtime.process({ effects, sampleRate, channelCount: target.channelCount, frameCount: target.durationFrames + prefix }, {
							assertCurrent,
							read: async (start, end) => {
								if (!previous || end <= prefix) return original(target.startFrame - prefix + start, target.startFrame - prefix + end);
								if (start >= prefix) return runtime.readStored(previous, start - prefix, end - prefix, signal);
								const before = await original(target.startFrame - prefix + start, target.startFrame);
								const after = await runtime.readStored(previous, 0, end - prefix, signal);
								return before.map((channel, c) => { const merged = new Float32Array(end - start); merged.set(channel); merged.set(after[c]!, channel.length); return merged; });
							},
							readControl: runtime.readControl ? async (start, end) => {
								const trackId = String(effects.find(effect => effect.type === 'audacity-auto-duck')?.context?.controlTrackId ?? '');
								return runtime.readControl!(trackId, { ...target, startFrame: target.startFrame - prefix + start, endFrame: target.startFrame - prefix + end, durationFrames: end - start });
							} : undefined,
							write: async channels => { const skip = Math.min(prefix - discarded, channels[0]!.length); discarded += skip;
								if (skip < channels[0]!.length) await output.write(channels.map(channel => channel.subarray(skip))); },
						}, signal);
						if (final && target.sourceId) await copyOriginal(target.endFrame, target.sourceFrameCount!, output.write);
						await output.finish(); assertCurrent();
						if (output.framesWritten !== source.frameCount) throw new RangeError('Streamed source frame count changed.');
						await writer.commit({ sampleRate, channelCount: target.channelCount }); staged.add(sourceId); assertCurrent();
						if (final && peaks) { await runtime.activateSource(source, signal, peaks.finish()); assertCurrent(); entries.push({ target, source, frameCount: target.durationFrames }); }
					} catch (error) { await Promise.resolve(writer.abort(error)).catch(() => undefined); throw error; }
					if (previous) { await remove(previous.id); assertCurrent(); }
					previous = source;
				}
				function original(start: number, end: number): Promise<readonly Float32Array[]> { assertCurrent(); return runtime.read(target.track.id, start, end, target.channelCount, target.clipIds); }
				async function copyOriginal(start: number, end: number, write: (channels: Float32Array[]) => Promise<void>): Promise<void> {
					for (let from = start; from < end; from += runtime.chunkFrames) { const channels = [...await original(from, Math.min(end, from + runtime.chunkFrames))]; assertCurrent(); await write(channels); }
				}
			}
			assertCurrent();
			const exact = first.clipId ? entries.map(entry => ({ ...entry, target: { ...entry.target, clipId: entry.target.clipId! } })) : null;
			const commands: AudioEditorCommand[] = exact ? prepareExactClipEffectResultCommands({ tracks: [], clips: [] }, exact, entry => entry.source)
				: entries.map(({ target, source }) => target.sourceId ? { type: 'source/process-audio', sourceId: target.sourceId, source,
					startFrame: target.startFrame, endFrame: target.endFrame } : runtime.prepareReplacement(target, source));
			if (!first.sourceId) commands.push(exact ? { type: 'selection/set', startFrame: 0, endFrame: 0,
				trackIds: [...new Set(exact.map(entry => entry.target.track.id))], clipIds: exact.map(entry => entry.target.clipId), frequencyRange: null }
				: { type: 'selection/set', startFrame: first.startFrame, endFrame: first.endFrame, ...options.selectionDetails });
			runtime.publish({ type: 'batch', commands }, first.sourceTrackId ?? first.track.id, first.sourceClipId ?? (exact ? undefined
				: commands[0]?.type === 'range/replace' ? commands[0].clipId : undefined));
		} catch (error) { for (const sourceId of staged) await remove(sourceId).catch(() => undefined); throw error; }
		async function remove(sourceId: string): Promise<void> {
			const failures: unknown[] = [];
			try { await runtime.releaseSource(sourceId); } catch (error) { failures.push(error); }
			try { await runtime.store.deleteAnalysis?.(peakCacheKey(sourceId)); } catch (error) { failures.push(error); }
			try { await runtime.store.deleteSource(sourceId); staged.delete(sourceId); } catch (error) { failures.push(error); }
			if (failures.length) throw new AggregateError(failures, 'Could not completely release a staged effect source.');
		}
	};
}
