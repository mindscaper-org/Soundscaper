/* SPDX-License-Identifier: AGPL-3.0-only */
import type { createAudioEditorController } from '../common/editor/app.js';
import type { ControllerOptions } from '../common/editor/controller/composition/controller-options.ts';
import type { MacroFileBatchSession } from '../common/editor/controller/effects/macro-file-batch-service.ts';
import { createSoundscaperProjectRuntimeSelection } from './editor-project-runtime-selection.ts';
import { createSoundscaperEphemeralProjectStore } from './editor-project-store.ts';
import type { MacroBatchInput, MacroBatchTarget } from './desktop-macro-file-batch.ts';

interface Options extends Pick<ControllerOptions, 'locale' | 'copy' | 'confirmFileSizeWarning' | 'confirmMonoConversion'> {
	readonly createController: (options: ControllerOptions) => ReturnType<typeof createAudioEditorController>;
	readonly fileService: NonNullable<ControllerOptions['fileService']>;
	readonly savedMacros: readonly Readonly<{ id: string; name: string; effects: readonly Readonly<Record<string, unknown>>[] }>[];
	readonly signal: AbortSignal;
}

/** A file batch never activates, edits or saves into the visible editor's project library. */
export async function createSoundscaperMacroFileSession(input: MacroBatchInput, options: Options): Promise<MacroFileBatchSession<MacroBatchTarget>> {
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createSoundscaperEphemeralProjectStore();
	const controller = options.createController({ ...options,
		store, projectRuntime: runtime, sessionController: runtime.createSessionController(),
		sourceBufferCacheMaxBytes: 64 * 1024 * 1024, mixRenderMemoryLimitBytes: 128 * 1024 * 1024,
	});
	const cancel = (): void => {
		controller.actions.macros.cancel();
		void Promise.resolve(controller.actions.export.cancel()).catch(() => undefined);
	};
	options.signal.addEventListener('abort', cancel, { once: true });
	const dispose = async (): Promise<void> => {
		options.signal.removeEventListener('abort', cancel);
		try { await controller.dispose(); } finally { await store.close(); }
	};
	try {
		await controller.ready; options.signal.throwIfAborted();
		// The dialog retains input reads; temporary projects receive no original-file write grant.
		await options.fileService.withReadDescriptors([{ ...input, originalFile: undefined }], { signal: options.signal, retainReads: true }, async (files: readonly File[]) => {
			await controller.actions.project.importFiles(files, { signal: options.signal });
		});
		options.signal.throwIfAborted();
		const project = controller.project;
		const track = project?.tracks.find(candidate => candidate.type === 'audio' && candidate.clipIds?.length);
		if (!project || !track || !project.clips.length) throw new Error('The input audio file could not be imported.');
		controller.actions.timeline.selectTrack(track.id);
		controller.actions.timeline.setSelection(0, Math.max(...project.clips.map(clip => Number(clip.timelineStartFrame) + Number(clip.durationFrames))),
			{ trackIds: [track.id], clipIds: [], frequencyRange: null });
		for (const macro of options.savedMacros) controller.actions.macros.library.save(macro);
		return {
			async run(macro, resolveAudioInput, signal) {
				signal.throwIfAborted();
				if (macro.kind === 'script') return controller.actions.macros.runScript({ name: macro.name, source: macro.source, resolveAudioInput });
				const result = await controller.actions.macros.run({ name: macro.name, effects: macro.effects });
				if (result === null) throw new Error('The macro could not run on this file.');
				return result;
			},
			async export(destination, format, signal) {
				signal.throwIfAborted();
				const target = await options.fileService.prepareBatchSaveTarget(destination.batchId, destination.index);
				if (!target) throw new Error('The batch output destination is unavailable.');
				try {
					const result: unknown = await controller.actions.export.start({ format, mode: 'mix', range: 'project', bitDepth: 24,
						includeTail: false, saveToFile: true, saveTarget: target });
					signal.throwIfAborted();
					if (!result || typeof result !== 'object' || Reflect.get(result, 'cancelled')) throw new Error(controller.getSnapshot().status.message || 'The processed file could not be exported.');
					return result;
				} finally { await options.fileService.releaseSaveTarget(target); }
			},
			dispose,
		};
	} catch (error) { await dispose(); throw error; }
}
