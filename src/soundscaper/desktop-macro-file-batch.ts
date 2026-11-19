/* SPDX-License-Identifier: AGPL-3.0-only */
import type { createAudioEditorController } from '../common/editor/app.js';
import type { ControllerOptions } from '../common/editor/controller/composition/controller-options.ts';
import type { MacroFileBatchRequest, MacroFileBatchRow } from '../common/editor/controller/effects/macro-file-batch-service.ts';

export interface MacroBatchInput { readonly id: string; readonly name: string }
export interface MacroBatchTarget { readonly batchId: string; readonly index: number; readonly name: string }
export type DesktopMacroFileBatchRequest = MacroFileBatchRequest<MacroBatchInput, MacroBatchTarget>;
export type DesktopMacroFileBatchAction = (request: DesktopMacroFileBatchRequest) => Promise<readonly MacroFileBatchRow[]>;
type Parent = ReturnType<typeof createAudioEditorController>;

/** Keep batch controller construction out of startup and bind its lifetime to the desktop editor. */
export function createDesktopMacroFileBatchBinding(parent: Parent, options: Pick<ControllerOptions,
	'fileService' | 'locale' | 'copy' | 'confirmFileSizeWarning' | 'confirmMonoConversion'>,
	createController: (options: ControllerOptions) => Parent) {
	const fileService = options.fileService;
	if (!fileService?.isDesktop) return null;
	const active = new Map<AbortController, Promise<unknown>>();
	const applyToFiles: DesktopMacroFileBatchAction = async request => {
		const macro = structuredClone(request.macro);
		const cancellation = new AbortController();
		const signal = AbortSignal.any([request.signal, cancellation.signal]);
		const operation = (async () => {
			const [{ runMacroFileBatch }, { createSoundscaperMacroFileSession }, { createMacroAudioInputResolver }] = await Promise.all([
				import('../common/editor/controller/effects/macro-file-batch-service.ts'),
				import('./macro-file-session.ts'),
				import('../common/editor/controller/effects/macro-audio-input-service.ts'),
			]);
			signal.throwIfAborted();
			const inputResolver = request.resolveAudioInput ?? createMacroAudioInputResolver(fileService,
				(bytes, sampleRate) => parent.engine.decodeAudioData(bytes, { sampleRate }));
			const resolveAudioInput: typeof inputResolver = async (...args) => {
				try { return await inputResolver(...args); }
				catch (error) { if (error instanceof Error && error.name === 'AbortError') cancellation.abort(error); throw error; }
			};
			return runMacroFileBatch({ createSession: (input, sessionSignal) => createSoundscaperMacroFileSession(input, {
				...options, fileService, createController, savedMacros: parent.actions.macros.library.list(), signal: sessionSignal,
			}) }, { ...request, macro, signal, resolveAudioInput });
		})();
		active.set(cancellation, operation);
		try { return await operation; } finally { active.delete(cancellation); }
	};
	return Object.freeze({ applyToFiles,
		cancel: (): void => { for (const cancellation of active.keys()) cancellation.abort(new DOMException('Batch cancelled.', 'AbortError')); },
		drain: async (): Promise<void> => { await Promise.allSettled(active.values()); },
	});
}
