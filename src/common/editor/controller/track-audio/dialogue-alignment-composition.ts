/* SPDX-License-Identifier: AGPL-3.0-only */

import type { TrackAudioCompositionDependencies } from './track-audio-composition-types.ts';
import type { DerivedSourceService } from './internal/derived-audio/derived-source-service.ts';
import type { DialogueAlignmentOptions } from './internal/dialogue-alignment-service.ts';
import { EditorProjectChangedError } from '../shared/lifecycle.ts';

/** Load acoustic analysis, review ownership and preview only when the user invokes the dialog. */
export function createDialogueAlignmentComposition(deps: TrackAudioCompositionDependencies, derivedSources: DerivedSourceService) {
	let service: Promise<ReturnType<typeof import('./internal/dialogue-alignment-service.ts')['createDialogueAlignmentService']>> | null = null;
	let preview: ReturnType<typeof import('./internal/dialogue-alignment-preview.ts')['createDialogueAlignmentPreview']> | null = null;
	const load = () => service ??= import('./internal/dialogue-alignment-service.ts').then(({ createDialogueAlignmentService }) => createDialogueAlignmentService({
		lifetime: deps.lifetime, copy: deps.copy, derivedSources, getProject: deps.getCommandProject, editingBlocked: deps.editingBlocked,
		captureProject: () => deps.projectGeneration.capture(deps.getProject()?.id), assertProject: token => deps.projectGeneration.assertCurrent(token),
		createId: prefix => crypto.randomUUID() + '-' + prefix,
		render: deps.renderDryTrackRange, preflightStorage: deps.preflightStorage, commit: deps.commit,
		setProcessing: deps.setEffectProcessing, publish: deps.publishDocumentSnapshot,
	}));
	const stopPreview = async (): Promise<void> => { await preview?.stop(); };
	const discard = async (): Promise<void> => { await stopPreview(); (await service)?.discard(); };
	deps.lifetime.signal.addEventListener('abort', () => { void discard().catch(deps.handleError); }, { once: true });
	return Object.freeze({
		async prepare(options: DialogueAlignmentOptions, signal?: AbortSignal) {
			const project = deps.getCommandProject(), revision = project.revision, token = deps.projectGeneration.capture(project.id);
			await stopPreview();
			const runtime = await load(); deps.projectGeneration.assertCurrent(token); signal?.throwIfAborted();
			if (deps.getCommandProject().revision !== revision) throw new EditorProjectChangedError();
			return runtime.prepare(options, signal);
		},
		async apply(id: string, signal?: AbortSignal) { await stopPreview(); return (await load()).apply(id, signal); },
		async preview(id: string, kind: 'reference' | 'replacement' | 'aligned', signal?: AbortSignal) {
			signal?.throwIfAborted();
			const runtime = await load();
			const { createDialogueAlignmentPreview } = await import('./internal/dialogue-alignment-preview.ts');
			signal?.throwIfAborted();
			preview ??= createDialogueAlignmentPreview(deps.lifetime, deps.createPreviewEngine, async () => { deps.engine.stop(); await deps.stopProjectBinPreview(); }, async audio => {
				const context = await deps.engine.getAudioContext({ resume: false });
				const buffer = context.createBuffer(audio.channels.length, audio.channels[0]!.length, audio.sampleRate);
				for (let channel = 0; channel < audio.channels.length; channel++) buffer.getChannelData(channel).set(audio.channels[channel]!);
				return buffer;
			});
			await preview.play(runtime.previewAudio(id, kind), () => {
				signal?.throwIfAborted();
				runtime.previewAudio(id, kind);
			});
		}, stopPreview, discard,
	});
}
