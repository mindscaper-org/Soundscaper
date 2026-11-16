/* SPDX-License-Identifier: AGPL-3.0-only */

import { createLocalizedError, formatPresentationMessage } from '../../../../i18n/presentation-message.ts';
import { dialogueAlignmentTargets, type DialogueTargetProject } from '../../../dialogue-alignment-targets.ts';
import { alignDialogueInWorker, type RenderedDialogueAlignment } from '../../../dialogue-alignment-worker-client.ts';
import { createAudioClip, createAudioTrack } from '../../../project-media-factory.ts';
import type { AudioEditorCommand, CommandObject } from '../../../commands/protocol.ts';
import { EDITOR_PROJECT_TASK_SCOPE, EditorProjectChangedError, type EditorControllerLifetime, type EditorProjectToken } from '../../shared/lifecycle.ts';
import type { DerivedSourceService } from './derived-audio/derived-source-service.ts';
import { findControllerSource, type ControllerProject, type DerivedSourceRecord } from '../track-domain-types.ts';

export interface DialogueAlignmentOptions { readonly referenceClipId: string; readonly replacementClipId: string; readonly strength: number }
export interface DialogueAlignmentReview { readonly id: string; readonly mismatch: number; readonly durationSeconds: number }
export interface DialogueAlignmentServiceDependencies {
	readonly lifetime: Pick<EditorControllerLifetime, 'assertActive' | 'startTask'>;
	readonly copy: object;
	readonly derivedSources: Pick<DerivedSourceService, 'persistDerivedSource' | 'rollbackDerivedSources'>;
	getProject(): ControllerProject & DialogueTargetProject;
	editingBlocked(): boolean;
	captureProject(): EditorProjectToken;
	assertProject(token: EditorProjectToken): void;
	createId(prefix: string): string;
	render(trackId: string, start: number, end: number, channels: number, clipIds: readonly string[], signal: AbortSignal): Promise<Float32Array[]>;
	preflightStorage(bytes: number, category: 'effect'): Promise<unknown>;
	commit(command: AudioEditorCommand, selection?: { selectTrackId: string; selectClipId: string }): unknown;
	setProcessing(value: boolean): void;
	publish(): void;
	align?: typeof alignDialogueInWorker;
}
interface Preparation {
	readonly review: DialogueAlignmentReview;
	readonly project: ReturnType<DialogueAlignmentServiceDependencies['getProject']>;
	readonly revision: unknown;
	readonly token: EditorProjectToken;
	readonly reference: ReturnType<typeof dialogueAlignmentTargets>[number];
	readonly replacement: ReturnType<typeof dialogueAlignmentTargets>[number];
	readonly referencePcm: Float32Array[];
	readonly replacementPcm: Float32Array[];
	readonly result: RenderedDialogueAlignment;
}

/** Private review assets publish once, only while their exact document revision is current. */
export function createDialogueAlignmentService(deps: DialogueAlignmentServiceDependencies) {
	let prepared: Preparation | null = null, publishing = false, preparing = false;
	let activeCancellation: AbortController | null = null;
	const fail = (key: string): Error => createLocalizedError(Error, deps.copy, key);
	const assertOwned = (value: Pick<Preparation, 'token' | 'revision'>): void => {
		deps.lifetime.assertActive(); deps.assertProject(value.token);
		if (deps.getProject().revision !== value.revision) throw new EditorProjectChangedError();
	};
	return Object.freeze({ prepare, apply, discard, previewAudio });

	function discard(): void { prepared = null; activeCancellation?.abort(new DOMException('Dialogue review discarded.', 'AbortError')); }
	function requirePreparation(id: string): Preparation {
		if (!prepared || prepared.review.id !== id) throw fail('dialogueAlignmentStale');
		assertOwned(prepared); return prepared;
	}
	function previewAudio(id: string, kind: 'reference' | 'replacement' | 'aligned') {
		const value = requirePreparation(id);
		return { sampleRate: value.project.sampleRate, channels: kind === 'reference' ? value.referencePcm
			: kind === 'replacement' ? value.replacementPcm : value.result.channels };
	}
	async function prepare(options: DialogueAlignmentOptions, signal?: AbortSignal): Promise<DialogueAlignmentReview> {
		deps.lifetime.assertActive();
		if (deps.editingBlocked() || publishing || preparing) throw fail('dialogueAlignmentBlocked');
		const project = deps.getProject(), targets = dialogueAlignmentTargets(project);
		const reference = targets.find(target => target.clipId === options.referenceClipId), replacement = targets.find(target => target.clipId === options.replacementClipId);
		if (!reference || !replacement || reference.clipId === replacement.clipId) throw fail('dialogueAlignmentSelection');
		if (!Number.isFinite(options.strength) || options.strength < 0 || options.strength > 1) throw fail('dialogueAlignmentSelection');
		const strength = options.strength;
		if (replacement.frameCount / reference.frameCount < .5 || replacement.frameCount / reference.frameCount > 2) throw fail('dialogueAlignmentDurations');
		const task = deps.lifetime.startTask('align-dialogue', { scope: EDITOR_PROJECT_TASK_SCOPE });
		const cancellation = new AbortController(); activeCancellation = cancellation;
		const abort = AbortSignal.any([task.signal, cancellation.signal, ...(signal ? [signal] : [])]);
		const ownership = { token: deps.captureProject(), revision: project.revision };
		prepared = null; preparing = true; deps.setProcessing(true); deps.publish();
		const check = (): void => { abort.throwIfAborted(); task.assertCurrent(); assertOwned(ownership); };
		try {
			check();
			await deps.preflightStorage(reference.frameCount * replacement.channelCount * 4, 'effect'); check();
			const read = async (target: typeof reference): Promise<Float32Array[]> => {
				const pcm = await deps.render(target.trackId, target.startFrame, target.startFrame + target.frameCount, target.channelCount, [target.clipId], abort); check();
				if (pcm.length !== target.channelCount || pcm.some(channel => channel.length !== target.frameCount)) throw fail('dialogueAlignmentFailed');
				return pcm;
			};
			const referencePcm = await read(reference), replacementPcm = await read(replacement);
			const result = await (deps.align ?? alignDialogueInWorker)({ reference: referencePcm, replacement: replacementPcm,
				sampleRate: project.sampleRate, strength }, abort); check();
			if (result.alignment.outputFrames !== reference.frameCount || result.channels.length !== replacement.channelCount
				|| !Number.isFinite(result.alignment.mismatch) || result.alignment.mismatch > .4
				|| result.channels.some(channel => !(channel instanceof Float32Array) || channel.length !== reference.frameCount || channel.some(value => !Number.isFinite(value)))) throw fail('dialogueAlignmentFailed');
			const review = { id: deps.createId('dialogue-review'), mismatch: result.alignment.mismatch, durationSeconds: reference.frameCount / project.sampleRate };
			prepared = { ...ownership, review, project, reference, replacement, referencePcm, replacementPcm, result };
			return review;
		} catch (cause) {
			abort.throwIfAborted();
			assertOwned(ownership);
			if (cause instanceof RangeError || cause instanceof Error && cause.name === 'RangeError') throw fail('dialogueAlignmentNoMatch');
			throw cause;
		} finally { task.finish(); preparing = false; activeCancellation = null; deps.setProcessing(false); deps.publish(); }
	}
	async function apply(id: string, signal?: AbortSignal): Promise<string> {
		if (deps.editingBlocked() || publishing || preparing) throw fail('dialogueAlignmentBlocked');
		const value = requirePreparation(id);
		const task = deps.lifetime.startTask('publish-aligned-dialogue', { scope: EDITOR_PROJECT_TASK_SCOPE });
		const abort = signal ? AbortSignal.any([signal, task.signal]) : task.signal;
		const check = (): void => { abort.throwIfAborted(); task.assertCurrent(); assertOwned(value); if (prepared !== value) throw fail('dialogueAlignmentStale'); };
		let record: DerivedSourceRecord | null = null;
		publishing = true; deps.setProcessing(true); deps.publish();
		try {
			check();
			const source = findControllerSource(value.project, value.replacement.sourceId);
			if (!source) throw fail('dialogueAlignmentStale');
			// The dry render already has the project clock, even when the original source used another rate.
			record = await deps.derivedSources.persistDerivedSource({ ...source, sampleRate: value.project.sampleRate },
				value.result.channels, `${value.replacement.title} — ${formatPresentationMessage(deps.copy, { key: 'dialogueAlignmentAligned' })}`, 'aligned-dialogue-source'); check();
			const trackId = deps.createId('aligned-dialogue-track'), clipId = deps.createId('aligned-dialogue-clip');
			const track = createAudioTrack({ id: trackId, name: record.source.name }, value.project.sampleRate);
			const clip = createAudioClip({ id: clipId, sourceId: record.source.id, title: record.source.name, anchor: 'sample',
				timelineStartFrame: value.reference.startFrame, durationFrames: value.reference.frameCount, sourceStartFrame: 0, sourceDurationFrames: value.reference.frameCount });
			deps.commit({ type: 'batch', commands: [
				{ type: 'source/add', source: record.source as CommandObject },
				{ type: 'track/add', track: track as CommandObject },
				{ type: 'clip/add', trackId, clip: clip as CommandObject },
			] }, { selectTrackId: trackId, selectClipId: clipId });
			record = null; prepared = null; return clipId;
		} catch (cause) { if (record) await deps.derivedSources.rollbackDerivedSources([record]); throw cause; }
		finally { task.finish(); publishing = false; deps.setProcessing(false); deps.publish(); }
	}
}
