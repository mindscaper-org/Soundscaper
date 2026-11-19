/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EffectsCompositionDependencies } from '../effects-composition-types.ts';
import type { MicrophoneBleedOptions } from '../../../microphone-bleed.ts';
import type { createEffectAudioService } from './effect-audio-service.ts';
import { EditorProjectChangedError } from '../../shared/lifecycle.ts';
import { setLocalizedStatus } from '../../../../i18n/presentation-message.ts';

/** Keep the joint processor lazy and route publication through the existing effect owner. */
export function createMicrophoneBleedAction(deps: EffectsCompositionDependencies,
	audio: Pick<ReturnType<typeof createEffectAudioService>, 'renderDryTrackRange'>) {
	return async (options: MicrophoneBleedOptions = {}, signal?: AbortSignal) => {
		const project = deps.getProject();
		if (!project || !deps.composition.effects) throw new Error('Microphone-bleed reduction requires an editable audio project.');
		const token = deps.projectGeneration.capture(project.id), revision = project.revision;
		const selection = structuredClone(deps.activeSelection()), settings = { ...options };
		const { createMicrophoneBleedService } = await import('./microphone-bleed-service.ts');
		deps.projectGeneration.assertCurrent(token); signal?.throwIfAborted();
		if (deps.getProject()?.revision !== revision) throw new EditorProjectChangedError();
		return deps.taskProgress.run('effect', deps.copy.microphoneBleedProcessing, task => {
			const cancellation = new AbortController();
			task.setCancellation(() => cancellation.abort(new DOMException('Microphone-bleed reduction was cancelled.', 'AbortError')));
			return createMicrophoneBleedService({
				lifetime: deps.lifetime, copy: deps.copy, getProject: () => {
					const current = deps.getCommandProject();
					return { id: current.id, revision: current.revision,
						tracks: current.tracks.map(track => ({ id: track.id, type: track.type, locked: track.locked,
							audioFreeze: track.audioFreeze, clipIds: track.clipIds })),
						clips: current.clips.map(clip => ({ id: clip.id, sourceId: clip.sourceId, kind: clip.kind,
							timelineStartFrame: Number(clip.timelineStartFrame), durationFrames: Number(clip.durationFrames),
							envelope: Array.isArray(clip.envelope) ? clip.envelope.map((point: { readonly frame: unknown; readonly value: unknown }) => ({ frame: Number(point.frame), value: Number(point.value) })) : undefined })),
					};
				},
				captureProject: () => token, assertProject: value => deps.projectGeneration.assertCurrent(value),
				getSelection: () => selection, projectSampleRate: deps.projectSampleRate, editingBlocked: deps.editingBlocked,
				render: (trackId, start, end, clipIds, abort) => audio.renderDryTrackRange(trackId, start, end, null, clipIds, abort),
				commit: deps.commit, setProcessing: value => { deps.state.audacityEffectProcessing = value; },
				publish: deps.publishDocumentSnapshot, onProgress: value => deps.taskProgress.updateActive(value),
			})(settings, signal ? AbortSignal.any([signal, cancellation.signal]) : cancellation.signal).then(result => {
				setLocalizedStatus(deps.setStatus, deps.copy, result.changedClipCount ? 'microphoneBleedApplied' : 'microphoneBleedUnchanged', undefined, 'success');
				return result;
			});
		}, undefined, { key: 'microphoneBleedProcessing' });
	};
}
