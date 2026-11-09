/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAddLabelTrackCommand } from '../../../commands/factories.ts';
import type { AudioEditorCommand } from '../../../commands/protocol.ts';
import { findRepeatedSoundInWorker } from '../../../repeated-sound-worker-client.ts';
import { repeatedSoundThreshold, selectRepeatedSoundMatches, type RepeatedSoundMatch,
	type RepeatedSoundOptions, type RepeatedSoundResult } from '../../../repeated-sound.ts';
import { createLocalizedError, formatPresentationMessage } from '../../../../i18n/presentation-message.ts';
import { EDITOR_PROJECT_TASK_SCOPE, EditorProjectChangedError } from '../../shared/lifecycle.ts';
import type { AnalysisAudioBuffer, AnalysisRange, AnalysisDependencies } from '../analysis-service.ts';

export interface RepeatedSoundDependencies {
	readonly lifetime: AnalysisDependencies['lifetime'];
	readonly copy: Readonly<Record<string, string>>;
	getProject(): Readonly<{ id: string; revision: number; tracks: readonly { id: string; type: string }[] }>;
	captureProject: AnalysisDependencies['captureProject'];
	assertProject: AnalysisDependencies['assertProject'];
	getSelection(): (AnalysisRange & { readonly trackIds?: readonly string[] }) | null;
	getSelectedTrackId(): string | null;
	projectSampleRate(): number;
	projectDurationFrames(): number;
	renderAudio(scope: string, range: AnalysisRange, signal: AbortSignal, trackId: string): Promise<AnalysisAudioBuffer>;
	commit(command: AudioEditorCommand): unknown;
	setProcessing(value: boolean): void;
	publish(): void;
}

/** Search timeline PCM, then author one track only while the captured document is current. */
export function createRepeatedSoundService(deps: RepeatedSoundDependencies) {
	return async (options: RepeatedSoundOptions = {}, signal?: AbortSignal): Promise<RepeatedSoundResult> => {
		deps.lifetime.assertActive(); signal?.throwIfAborted();
		const project = deps.getProject(), token = deps.captureProject();
		const selection = deps.getSelection(), rate = deps.projectSampleRate(), duration = deps.projectDurationFrames();
		const ids = selection?.trackIds?.length ? selection.trackIds : [deps.getSelectedTrackId()];
		const track = ids.length === 1 ? project.tracks.find(candidate => candidate.id === ids[0] && candidate.type === 'audio') : null;
		if (!track) throw createLocalizedError(Error, deps.copy, 'repeatedSoundTrackRequired');
		if (!selection || !Number.isSafeInteger(selection.startFrame) || !Number.isSafeInteger(selection.endFrame)
			|| selection.startFrame < 0 || selection.endFrame > duration || selection.endFrame <= selection.startFrame) {
			throw createLocalizedError(Error, deps.copy, 'timeSelectionRequired');
		}
		const length = selection.endFrame - selection.startFrame;
		if (length < Math.max(16, Math.ceil(rate * .02)) || length > rate * 30) {
			throw createLocalizedError(RangeError, deps.copy, 'repeatedSoundExampleLength');
		}
		let threshold: number;
		try { threshold = repeatedSoundThreshold(options.similarityThreshold); }
		catch { throw createLocalizedError(RangeError, deps.copy, 'repeatedSoundThresholdInvalid'); }
		const original = { startFrame: selection.startFrame, endFrame: selection.endFrame, similarity: 1, original: true };
		const task = deps.lifetime.startTask('analysis', { scope: EDITOR_PROJECT_TASK_SCOPE });
		let released = false;
		const release = (): void => {
			if (released) return;
			released = true; deps.setProcessing(false); deps.publish();
		};
		const cancel = (): void => { task.abort(signal?.reason); };
		const assertCurrent = (): void => {
			task.assertCurrent(); deps.assertProject(token);
			const current = deps.getProject();
			if (current.id !== project.id || current.revision !== project.revision) throw new EditorProjectChangedError();
		};
		deps.setProcessing(true); deps.publish();
		task.signal.addEventListener('abort', release, { once: true });
		signal?.addEventListener('abort', cancel, { once: true });
		try {
			const render = async (range: AnalysisRange): Promise<readonly Float32Array[]> => {
				assertCurrent();
				const buffer = await deps.renderAudio('track', range, task.signal, track.id);
				assertCurrent();
				if (buffer.length !== range.endFrame - range.startFrame || buffer.sampleRate !== rate) {
					throw new RangeError('Repeated sound analysis requires exact project-rate PCM.');
				}
				return Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel));
			};
			const example = await render(original);
			if (length * example.length * 4 > 16 * 1024 * 1024) throw createLocalizedError(RangeError, deps.copy, 'repeatedSoundExampleMemory');
			const step = Math.min(Math.round(rate * 15), Math.floor(64 * 1024 * 1024 / (4 * example.length)) - length + 1);
			let matches: readonly RepeatedSoundMatch[] = [original];
			for (let startFrame = 0; startFrame <= duration - length; startFrame += step) {
				const channels = await render({ startFrame, endFrame: Math.min(duration, startFrame + step + length - 1) });
				let found: readonly RepeatedSoundMatch[];
				try { found = await findRepeatedSoundInWorker(example, channels, threshold, task.signal); }
				catch (error) {
					if (error instanceof Error && error.message.includes('silent or constant')) throw createLocalizedError(RangeError, deps.copy, 'repeatedSoundSilent');
					throw error;
				}
				assertCurrent();
				matches = selectRepeatedSoundMatches([...matches, ...found.map(match => ({ ...match,
					startFrame: match.startFrame + startFrame, endFrame: match.endFrame + startFrame }))], original);
			}
			const command = createAddLabelTrackCommand({ name: deps.copy.repeatedSoundTrackName,
				labels: matches.map((match, index) => ({ startFrame: match.startFrame, endFrame: match.endFrame,
					title: match.original ? deps.copy.repeatedSoundOriginal : formatPresentationMessage(deps.copy, { key: 'repeatedSoundDuplicate', parameters: { number: index + (match.startFrame < original.startFrame ? 1 : 0) } }),
				})),
			});
			assertCurrent();
			deps.commit(command);
			return { trackId: String(command.track.id), sourceTrackId: track.id, matches };
		} finally {
			signal?.removeEventListener('abort', cancel); task.signal.removeEventListener('abort', release);
			release(); task.finish();
		}
	};
}
