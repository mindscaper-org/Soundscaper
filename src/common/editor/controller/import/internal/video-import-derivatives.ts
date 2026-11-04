/* SPDX-License-Identifier: AGPL-3.0-only */

import { VideoPreviewEncodedPayloadTooLargeError, VideoPreviewSourceGeometryTooLargeError } from '../../../video-preview-capture-admission.ts';
import type { VideoDerivativeInput } from '../../../storage/video-derivative-repository.ts';
import type { LinkedVideoOriginalBinding } from '../../../storage/linked-video-original-binding.ts';
import type { EditorControllerLifetime, EditorProjectToken } from '../../shared/lifecycle.ts';
import type { ImportVideoFrameExtractor, ImportVideoRuntime, ImportVideoSource } from './source-import-types.d.ts';
import type { VideoTimingIndexLease } from '../../../video-source-time.ts';
import { claimProtectedSources } from './protected-source-claims.ts';

export interface VideoImportDerivativeRequest {
	readonly source: ImportVideoSource;
	readonly projectToken: EditorProjectToken;
	readonly extractor: ImportVideoFrameExtractor;
	readonly durationSeconds: number;
	readonly linkedBinding: LinkedVideoOriginalBinding | null;
	readonly timingLease?: VideoTimingIndexLease;
	readonly audio: Readonly<{ sourceId: string; contentSha256: string; channels: Float32Array[] }> | null;
}

interface VideoImportDerivativeOptions extends Pick<ImportVideoRuntime,
	'assertProject' | 'getProject' | 'store' | 'sourcePeaks' | 'peakCacheKey' | 'audioEditorVideoThumbnailTimes'
> {
	readonly lifetime: Pick<EditorControllerLifetime, 'startTask' | 'assertActive'>;
	readonly activationUnavailableError?: () => Error;
	readonly activateVideoSource: ImportVideoRuntime['activateVideoSource'];
	readonly revokeVideoVisual: ImportVideoRuntime['revokeVideoVisual'];
	readonly protectedSourceIds: Set<string>;
	readonly generatePeaks: (channels: Float32Array[], signal: AbortSignal) => ReturnType<ImportVideoRuntime['generateWaveformPeaks']>;
	readonly publishDerivative: (source: ImportVideoSource, derivative: VideoDerivativeInput) => boolean;
	readonly publish: () => void;
}

/** Disposable work owns no history mutation, import busy state, or canonical rollback. */
export function createVideoImportDerivativeScheduler(options: VideoImportDerivativeOptions) {
	const pending = new Set<Promise<void>>();
	// Outcomes follow their canonical source object's lifetime, including a late
	// required waiter after optional work has completed. Keep no PCM or decoder.
	const activations = new WeakMap<object, Readonly<{
		outcome: Promise<void>; projectToken: EditorProjectToken;
		contentSha256: string; storageKey: string;
	}>>();
	return { schedule, awaitActivation, whenIdle: async () => { await Promise.all([...pending]); } };

	async function awaitActivation(sourceId: string, { signal }: Readonly<{ signal: AbortSignal }>): Promise<void> {
		signal.throwIfAborted();
		const source = options.getProject()?.sources?.find(candidate => candidate.id === sourceId);
		const activation = source && activations.get(source);
		if (!activation) throw new DOMException('The imported video activation is unavailable.', 'AbortError');
		const assertCurrent = (): void => {
			options.lifetime.assertActive(); options.assertProject(activation.projectToken);
			const current = options.getProject()?.sources?.find(candidate => candidate.id === sourceId);
			if (!current || current.contentSha256 !== activation.contentSha256
				|| (current.storageKey || current.id) !== activation.storageKey) {
				throw new DOMException('The imported video source is no longer current.', 'AbortError');
			}
		};
		assertCurrent();
		await new Promise<void>((resolve, reject) => {
			const cleanup = (): void => { signal.removeEventListener('abort', aborted); };
			const aborted = (): void => { cleanup(); reject(signal.reason); };
			signal.addEventListener('abort', aborted, { once: true });
			void activation.outcome.then(() => { cleanup(); resolve(); }, (error: unknown) => { cleanup(); reject(error); });
			if (signal.aborted) aborted();
		});
		signal.throwIfAborted();
		assertCurrent();
	}

	function schedule(request: VideoImportDerivativeRequest): void {
		const contentSha256 = request.source.contentSha256;
		if (typeof contentSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(contentSha256)) {
			throw new TypeError('Imported video activation requires a canonical content digest.');
		}
		const task = options.lifetime.startTask(`video-import-derivatives:${request.source.id}`, { scope: 'project' });
		let activated!: () => void, activationFailed!: (reason: unknown) => void;
		const activation = new Promise<void>((resolve, reject) => { activated = resolve; activationFailed = reject; });
		void activation.catch(() => undefined);
		const source = options.getProject()?.sources?.find(candidate => candidate.id === request.source.id);
		if (source) activations.set(source, { outcome: activation, projectToken: request.projectToken,
			contentSha256, storageKey: request.source.storageKey || request.source.id });
		const sourceIds = [request.source.id, ...(request.audio ? [request.audio.sourceId] : [])];
		const releaseProtection = claimProtectedSources(sourceIds, options.protectedSourceIds);
		const assertCurrent = (sourceId = request.source.id): void => {
			task.assertCurrent();
			options.assertProject(request.projectToken);
			const sources = options.getProject()?.sources ?? [];
			const current = sources.find(source => source.id === sourceId);
			const digest = sourceId === request.source.id ? request.source.contentSha256 : request.audio?.contentSha256;
			const storageKey = sourceId === request.source.id ? request.source.storageKey : sourceId;
			if (!current || current.contentSha256 !== digest || (current.storageKey || current.id) !== storageKey) {
				throw new DOMException('The imported source is no longer current.', 'AbortError');
			}
		};
		const operation = (async () => {
			try {
				// Let the importer release its busy claim and the browser paint the clips.
				await yieldToEditor(task.signal);
				await Promise.allSettled([
					generateVideo(request, task.signal, assertCurrent, visual => {
						if (visual == null) activationFailed(options.activationUnavailableError?.()
							?? new DOMException('The imported video preview is unavailable.', 'AbortError'));
						else activated();
					}).catch((error: unknown) => { activationFailed(error); throw error; }),
					generateAudio(request, task.signal, assertCurrent),
				]);
			} catch { /* Source retirement makes disposable work unnecessary. */ }
			finally {
				activationFailed(new DOMException('The imported video activation was retired.', 'AbortError'));
				request.timingLease?.release();
				try { request.extractor.dispose(); } catch { /* Disposable decoder. */ }
				releaseProtection();
				task.finish();
			}
		})();
		pending.add(operation);
		void operation.finally(() => { pending.delete(operation); });
	}

	async function generateAudio(request: VideoImportDerivativeRequest, signal: AbortSignal, assertCurrent: (sourceId?: string) => void): Promise<void> {
		if (!request.audio) return;
		const { sourceId, channels } = request.audio;
		assertCurrent(sourceId);
		const peaks = await options.generatePeaks(channels, signal);
		assertCurrent(sourceId);
		options.sourcePeaks.set(sourceId, peaks);
		options.publish();
		await options.store.saveAnalysis(options.peakCacheKey(sourceId), peaks);
		assertCurrent(sourceId);
	}

	async function generateVideo(request: VideoImportDerivativeRequest, signal: AbortSignal, assertCurrent: () => void, activated: (visual: unknown) => void): Promise<void> {
		assertCurrent();
		const visual = await options.activateVideoSource(request.source, { signal });
		try { assertCurrent(); }
		catch (error) {
			if (visual && typeof visual === 'object' && 'mediaUrl' in visual && typeof visual.mediaUrl === 'string') {
				await options.revokeVideoVisual(request.source.id, visual.mediaUrl);
			}
			throw error;
		}
		activated(visual);
		options.publish();
		let consecutiveFailures = 0;
		const capture = async (timestamp: number, poster: boolean): Promise<boolean> => {
			assertCurrent();
			try {
				const frame = await request.extractor.capture(timestamp, {
					...(poster ? { maximumWidth: 640, maximumHeight: 360 } : {}),
					preferKeyframe: !poster,
					alpha: request.source.characteristics.hasAlpha === true, signal,
				});
				assertCurrent();
				const derivative: VideoDerivativeInput = {
					timestamp: frame.timestampSeconds, type: poster ? 'poster' : 'thumbnail', blob: frame.blob,
					metadata: { width: frame.width, height: frame.height, mimeType: frame.mimeType },
				};
				// Present decoded pixels before waiting for disposable cache storage.
				if (options.publishDerivative(request.source, derivative)) options.publish();
				if (request.linkedBinding) await options.store.saveLinkedVideoDerivative(
					request.projectToken.projectId, request.source, request.linkedBinding, derivative,
				);
				else await options.store.saveVideoDerivative(request.source.id, derivative);
				assertCurrent();
				consecutiveFailures = 0;
				return true;
			} catch (error) {
				assertCurrent();
				consecutiveFailures += 1;
				return !(error instanceof VideoPreviewEncodedPayloadTooLargeError
					|| error instanceof VideoPreviewSourceGeometryTooLargeError || consecutiveFailures >= 3);
			}
		};
		if (!await capture(0, true)) return;
		for (const timestamp of options.audioEditorVideoThumbnailTimes(request.durationSeconds)) {
			await yieldToEditor(signal);
			if (!await capture(timestamp, false)) break;
		}
	}
}

function yieldToEditor(signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const onAbort = (): void => { clearTimeout(timer); reject(signal.reason); };
		const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, 0);
		if (signal.aborted) onAbort();
		else signal.addEventListener('abort', onAbort, { once: true });
	});
}
