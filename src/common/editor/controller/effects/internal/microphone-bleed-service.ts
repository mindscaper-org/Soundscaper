/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../../../commands/protocol.ts';
import { composeMicrophoneBleedEnvelope } from '../../../microphone-bleed-envelope.ts';
import { buildMicrophoneBleedCurves, MICROPHONE_BLEED_MAXIMUM_TRACKS, microphoneBleedHopFrames,
	normalizeMicrophoneBleedOptions, type MicrophoneBleedOptions, type MicrophoneBleedPoint } from '../../../microphone-bleed.ts';
import { analyzeMicrophoneBleedInWorker } from '../../../microphone-bleed-worker-client.ts';
import { createLocalizedError } from '../../../../i18n/presentation-message.ts';
import { EDITOR_PROJECT_TASK_SCOPE, EditorProjectChangedError, type EditorControllerLifetime, type EditorProjectGeneration } from '../../shared/lifecycle.ts';
import type { EffectSelection } from '../effect-selection-service.ts';

interface BleedProject {
	readonly id: string;
	readonly revision?: unknown;
	readonly tracks: readonly { readonly id: string; readonly type: string; readonly locked?: unknown; readonly audioFreeze?: unknown; readonly clipIds?: readonly string[] }[];
	readonly clips: readonly { readonly id: string; readonly kind?: string; readonly sourceId: string;
		readonly timelineStartFrame: number; readonly durationFrames: number; readonly envelope?: readonly MicrophoneBleedPoint[] }[];
}
export interface MicrophoneBleedCopy {
	readonly microphoneBleedBlocked: string;
	readonly microphoneBleedSelectionRequired: string;
	readonly microphoneBleedLocked: string;
	readonly microphoneBleedRangeTooLong: string;
	readonly microphoneBleedApplied: string;
	readonly microphoneBleedUnchanged: string;
}
interface Dependencies {
	readonly lifetime: Pick<EditorControllerLifetime, 'startTask'>;
	readonly copy: MicrophoneBleedCopy;
	getProject(): BleedProject;
	captureProject(): ReturnType<EditorProjectGeneration['capture']>;
	assertProject(token: ReturnType<EditorProjectGeneration['capture']>): void;
	getSelection(): EffectSelection | null;
	projectSampleRate(): number;
	editingBlocked(): boolean;
	render(trackId: string, startFrame: number, endFrame: number, clipIds: readonly string[] | null, signal: AbortSignal): Promise<readonly Float32Array[]>;
	readonly analyze?: typeof analyzeMicrophoneBleedInWorker;
	commit(command: AudioEditorCommand): unknown;
	setProcessing(value: boolean): void;
	publish(): void;
	onProgress(value: number): void;
}

/** Analyze one immutable selection, then publish all editable gain changes as one history entry. */
export function createMicrophoneBleedService(deps: Dependencies) {
	return async (options: MicrophoneBleedOptions = {}, signal?: AbortSignal): Promise<{ changedClipCount: number }> => {
		signal?.throwIfAborted();
		if (deps.editingBlocked()) throw createLocalizedError(Error, deps.copy, 'microphoneBleedBlocked');
		const settings = normalizeMicrophoneBleedOptions(options), project = deps.getProject(), token = deps.captureProject();
		const revision = project.revision, selection = deps.getSelection(), rate = deps.projectSampleRate(), hop = microphoneBleedHopFrames(rate);
		const ids = new Set(selection?.trackIds ?? []), tracks = project.tracks.filter(track => ids.has(track.id) && track.type === 'audio');
		if (!selection || selection.frequencyRange || tracks.length < 2 || tracks.length > MICROPHONE_BLEED_MAXIMUM_TRACKS
			|| !Number.isSafeInteger(selection.startFrame) || selection.startFrame < 0
			|| !Number.isSafeInteger(selection.endFrame) || selection.endFrame <= selection.startFrame) {
			throw createLocalizedError(Error, deps.copy, 'microphoneBleedSelectionRequired');
		}
		if (tracks.some(track => track.locked === true || track.audioFreeze != null)) throw createLocalizedError(Error, deps.copy, 'microphoneBleedLocked');
		const selectedClips = selection.clipIds?.length ? new Set(selection.clipIds) : null;
		const rangeStart = selection.startFrame, rangeEnd = selection.endFrame, duration = rangeEnd - rangeStart;
		if (Math.ceil(duration / hop) * tracks.length > 4_000_000) throw createLocalizedError(RangeError, deps.copy, 'microphoneBleedRangeTooLong');
		const clips = tracks.map(track => project.clips.filter(clip => track.clipIds?.includes(clip.id)
			&& (!selectedClips || selectedClips.has(clip.id)) && clip.kind !== 'video' && clip.kind !== 'image'
			&& clip.timelineStartFrame < rangeEnd && clip.timelineStartFrame + clip.durationFrames > rangeStart));
		if (clips.some(track => !track.length)) throw createLocalizedError(Error, deps.copy, 'microphoneBleedSelectionRequired');
		const task = deps.lifetime.startTask('microphone-bleed', { scope: EDITOR_PROJECT_TASK_SCOPE });
		const cancel = (): void => { task.abort(signal?.reason); };
		const assertCurrent = (): void => {
			task.assertCurrent(); signal?.throwIfAborted(); deps.assertProject(token);
			const current = deps.getProject();
			if (current.id !== project.id || current.revision !== revision) throw new EditorProjectChangedError();
		};
		signal?.addEventListener('abort', cancel, { once: true });
		deps.setProcessing(true); deps.publish();
		try {
			const decisions = tracks.map(() => [] as boolean[]);
			for (let offset = 0; offset < duration; offset += hop * 250) {
				assertCurrent();
				const frameCount = Math.min(duration - offset, hop * 250);
				const start = Math.max(rangeStart, rangeStart + offset - hop * 2), end = Math.min(rangeEnd, rangeStart + offset + frameCount + hop * 2);
				const pcm: (readonly Float32Array[])[] = [];
				for (const [index, track] of tracks.entries()) {
					pcm.push(await deps.render(track.id, start, end, clips[index]!.map(clip => clip.id), task.signal));
					assertCurrent();
					if (pcm.at(-1)!.length < 1 || pcm.at(-1)!.length > 2) throw createLocalizedError(Error, deps.copy, 'microphoneBleedSelectionRequired');
					if (pcm.at(-1)!.some(channel => channel.length !== end - start)) throw new RangeError('Microphone-bleed rendering must return exact project-rate PCM.');
				}
				const result = await (deps.analyze ?? analyzeMicrophoneBleedInWorker)({ tracks: pcm, sampleRate: rate,
					offsetFrames: rangeStart + offset - start, frameCount, options: settings }, task.signal);
				assertCurrent();
				if (!Array.isArray(result) || result.length !== tracks.length || result.some(track => !Array.isArray(track)
					|| track.length !== Math.ceil(frameCount / hop) || track.some(value => typeof value !== 'boolean'))) throw new TypeError('Invalid microphone-bleed worker result.');
				for (const [index, values] of result.entries()) for (const value of values) decisions[index]!.push(value);
				deps.onProgress((offset + frameCount) / duration);
			}
			const curves = buildMicrophoneBleedCurves(decisions, rate, duration, settings), commands: AudioEditorCommand[] = [];
			for (const [index, trackClips] of clips.entries()) for (const clip of trackClips) {
				const envelope = composeMicrophoneBleedEnvelope(clip.envelope ?? [], clip.durationFrames, curves[index]!, rangeStart - clip.timelineStartFrame);
				if (JSON.stringify(envelope) !== JSON.stringify(clip.envelope ?? [])) commands.push({ type: 'clip/update', clipId: clip.id, changes: { envelope } });
			}
			assertCurrent();
			if (commands.length) deps.commit({ type: 'batch', commands });
			return { changedClipCount: commands.length };
		} finally {
			signal?.removeEventListener('abort', cancel);
			deps.setProcessing(false); deps.publish(); task.finish();
		}
	};
}
