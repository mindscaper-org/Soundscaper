/* SPDX-License-Identifier: AGPL-3.0-only */
import type { EffectsCompositionDependencies } from '../effects-composition-types.ts';
import type { createEffectAudioService } from './effect-audio-service.ts';
import type { RunStreamedEffects } from './streamed/streamed-effect-service.ts';
import type { EffectResultProject } from './effect-result-service.ts';
import { createStableId } from '../../../project.js';
import { createAudioSource } from '../../../project-media-factory.ts';
import { prepareRangeReplacementCommand } from '../../../commands.js';
import { createSourceControlTrackRenderer } from './source-control-track-renderer.ts';
import { audacityEffectMemoryError } from './nyquist/nyquist-audio.ts';
import { deferredEffectRuntime } from '../deferred-effect-runtime.ts';
import { SOURCE_CHUNK_FRAMES } from '../../source/source-audio.ts';

/** Defer execution imports; both existing entry points use the same low-memory service. */
export function createStreamedEffectsComposition(dependencies: EffectsCompositionDependencies,
	audio: Pick<ReturnType<typeof createEffectAudioService>, 'renderDryTrackRange'>, memoryLimitBytes: () => number): RunStreamedEffects {
	return async (plans, options) => {
		const [{ createStreamedEffectService }, { runStreamedEffectWorker }, { loadSourceEditorAudioWindow }] = await Promise.all([
			import('./streamed/streamed-effect-service.ts'), import('./streamed/worker-client.ts'), import('./source-editor-audio-window.ts'),
		]);
		options.assertCurrent();
		await createStreamedEffectService({ memoryError: () => audacityEffectMemoryError(dependencies.copy), chunkFrames: SOURCE_CHUNK_FRAMES, get memoryLimitBytes() { return memoryLimitBytes(); }, store: dependencies.store,
			getProject: () => dependencies.getCommandProject() as unknown as EffectResultProject, createId: () => createStableId('audacity-effect'),
			getSelectedTrackId: () => dependencies.state.selectedTrackId,
			read: (...args) => audio.renderDryTrackRange(...args, options.signal),
			readControl: createSourceControlTrackRenderer(dependencies.getCommandProject, audio.renderDryTrackRange),
			readStored: async (source, startFrame, endFrame, signal) => {
				const window = await loadSourceEditorAudioWindow(source, { startFrame, endFrame, signal }, { store: dependencies.store });
				if (!window) throw new Error('The staged effect source is unavailable.'); return window.channels;
			},
			process: async (request, ports, signal) => {
				const wasmModule = request.effects.some(effect => effect.type === 'eq') ? await deferredEffectRuntime.loadParametricEqWasmModule() : undefined;
				await runStreamedEffectWorker({ ...request, ...(wasmModule instanceof WebAssembly.Module ? { wasmModule } : {}) }, ports, signal, dependencies.composition.selectionEffectWorkers ? undefined : null);
			},
			activateSource: (source, signal, peaks) => dependencies.activateStoredSource(createAudioSource(source), signal, peaks), releaseSource: dependencies.releaseStoredSource,
			prepareReplacement: (target, source) => prepareRangeReplacementCommand(dependencies.getProject()!, {
				trackId: target.track.id, startFrame: target.startFrame, endFrame: target.endFrame, source }),
			publish: (command, trackId, clipId) => dependencies.commit(command,
				{ selectTrackId: trackId, ...(clipId ? { selectClipId: clipId } : {}) }, { microfadeNewClips: false }),
		})(plans, options);
	};
}
