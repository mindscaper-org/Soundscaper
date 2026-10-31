/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MotionAsset } from '../../motion-asset.ts';
import { verifyMotionAssetBody } from '../../motion-asset.ts';
import { validateMotionSurface } from '../../motion-surface.ts';
import type { MotionPreviewWorkerPort, MotionPreviewWorkerRequest, MotionPreviewWorkerResponse } from '../../motion-preview-worker-protocol.ts';
import type { MotionPreviewAssetLoader, MotionPreviewBackend, MotionPreviewFootageDecoder } from './motion-preview-types.ts';
import { createMotionPreviewWorkerWatchdog } from './internal/motion-preview-worker-watchdog.ts';
import { createMotionPreviewWorkerDrain, type MotionPreviewWorkerDrain } from './internal/motion-preview-worker-drain.ts';

export class MotionPreviewWorkerUnavailableError extends Error { override name = 'MotionPreviewWorkerUnavailableError'; }
export class MotionPreviewRenderDeadlineError extends Error { override name = 'MotionPreviewRenderDeadlineError'; }
interface Pending {
	readonly signal: AbortSignal; readonly cancellation: AbortController; readonly drain: MotionPreviewWorkerDrain; cancelled: boolean;
	resolve(message: MotionPreviewWorkerResponse): void; reject(error: Error): void; cleanup(): void; finish(): void;
	progress(message: Extract<MotionPreviewWorkerResponse, { type: 'progress' }>): void;
}

/** The worker owns one persistent scene; only requested immutable assets or decoded frames cross this port. */
export function createMotionPreviewWorkerBackend(port: MotionPreviewWorkerPort, limits: Readonly<{ maximumAssetBytes: number; maximumWorkingBytes: number }>): MotionPreviewBackend {
	let disposed = false; let requestId = 0; let assets = new Map<string, MotionAsset>();
	let loadAsset: MotionPreviewAssetLoader | null = null; let decodeFootage: MotionPreviewFootageDecoder | undefined;
	const pending = new Map<number, Pending>();
	let draining: MotionPreviewWorkerDrain | null = null;
	const onMessage = (event: MessageEvent<MotionPreviewWorkerResponse>): void => {
		const message = event.data;
		if (message.type === 'asset' || message.type === 'footage') { void provide(message).catch((error: unknown) => failAll(asError(error))); return; }
		const request = pending.get(message.requestId); if (!request) return;
		if (message.type === 'progress') { if (!request.cancelled) request.progress(message); return; }
		pending.delete(message.requestId); request.cleanup(); request.finish(); if (draining === request.drain) draining = null;
		if (request.cancelled) return;
		if (message.type === 'error') { const error = new Error(message.message); error.name = message.name; request.reject(error); }
		else request.resolve(message);
	};
	const onFailure = (): void => failAll(new MotionPreviewWorkerUnavailableError('The motion preview worker stopped or could not load.'));
	port.addEventListener('message', onMessage); port.addEventListener('error', onFailure); port.addEventListener('messageerror', onFailure);
	return {
		async setProject(project, provider, signal, decoder) {
			assets = new Map(project.assets.map((asset) => [asset.id, asset])); loadAsset = provider; decodeFootage = decoder;
			const response = await send({ type: 'project', requestId: ++requestId, project, ...limits, hasFootageDecoder: Boolean(decoder) }, signal);
			if (response.type !== 'ready') throw new Error('Motion worker did not acknowledge its project.');
			return response.backend;
		},
		async render(request, signal) {
			const response = await send({ type: 'render', requestId: ++requestId, ...request }, signal);
			if (response.type !== 'frame') throw new Error('Motion worker did not return a frame.');
			return response.frame;
		},
		dispose() { if (!disposed) { failAll(new DOMException('Motion preview was cancelled.', 'AbortError')); loadAsset = null; decodeFootage = undefined; assets.clear(); } },
	};

	async function send(message: Extract<MotionPreviewWorkerRequest, { type: 'project' | 'render' }>, signal: AbortSignal): Promise<MotionPreviewWorkerResponse> {
		if (draining) await draining.wait(signal);
		signal.throwIfAborted(); if (disposed) return Promise.reject(new MotionPreviewWorkerUnavailableError('The motion preview worker is disposed.'));
		return new Promise((resolve, reject) => {
			const cancellation = new AbortController(); const resourceSignal = AbortSignal.any([signal, cancellation.signal]);
			const drain = createMotionPreviewWorkerDrain();
			const watchdog = createMotionPreviewWorkerWatchdog(message.type, reason => failAll(reason === 'absolute'
				? new MotionPreviewRenderDeadlineError('The motion preview frame exceeded its 600-second rendering deadline.')
				: reason === 'invalid-progress' ? new TypeError('Invalid motion preview progress.')
					: new MotionPreviewWorkerUnavailableError('The motion preview worker exceeded its 30-second response deadline.')));
			const request: Pending = { signal: resourceSignal, cancellation, drain, cancelled: false, resolve, reject, finish: drain.finish, progress: watchdog.progress,
				cleanup() { watchdog.stop(); signal.removeEventListener('abort', cancel); } };
			const cancel = (): void => {
				if (disposed || request.cancelled) return;
				request.cancelled = true; watchdog.cancel(); draining = drain; cancellation.abort(); request.reject(new DOMException('Motion preview was cancelled.', 'AbortError'));
				try { port.postMessage({ type: 'cancel', requestId: message.requestId }); }
				catch (error) { failAll(new MotionPreviewWorkerUnavailableError(asError(error).message)); }
			};
			signal.addEventListener('abort', cancel, { once: true });
			pending.set(message.requestId, request);
			try { port.postMessage(message); } catch (error) { failAll(new MotionPreviewWorkerUnavailableError(asError(error).message)); }
		});
	}
	async function provide(message: Extract<MotionPreviewWorkerResponse, { type: 'asset' | 'footage' }>): Promise<void> {
		const request = pending.get(message.requestId);
		try {
			if (!request) throw new DOMException('The requested preview frame was cancelled.', 'AbortError');
			request.signal.throwIfAborted(); const asset = assets.get(message.assetId);
			if (!asset) throw new ReferenceError('The motion worker requested an asset outside the retained project.');
			if (message.type === 'asset') {
				if (asset.byteLength > limits.maximumAssetBytes) throw new RangeError(`Motion asset ${asset.name} exceeds the preview decode budget.`);
				if (!loadAsset) throw new Error('The motion preview asset provider is unavailable.');
				const loaded = await loadAsset(asset, request.signal); request.signal.throwIfAborted(); verifyMotionAssetBody(asset, loaded);
				const bytes = new Uint8Array(loaded); if (!disposed) port.postMessage({ type: 'asset-result', resourceId: message.resourceId, bytes }, [bytes.buffer]);
			} else {
				if (asset.kind !== 'footage' || !decodeFootage) throw new Error('The motion preview footage decoder is unavailable.');
				const surface = await decodeFootage(asset, message.time, request.signal); request.signal.throwIfAborted(); validateMotionSurface(surface);
				if (surface.width !== asset.width || surface.height !== asset.height || surface.pixels.byteLength > limits.maximumWorkingBytes) throw new RangeError('Decoded motion footage exceeds its retained dimensions or working budget.');
				const pixels = new Float32Array(surface.pixels); if (!disposed) port.postMessage({ type: 'footage-result', resourceId: message.resourceId, surface: { ...surface, pixels } }, [pixels.buffer]);
			}
		} catch (value) { if (!disposed) { const error = asError(value); port.postMessage({ type: 'resource-error', resourceId: message.resourceId, message: error.message, name: error.name }); } }
	}
	function failAll(error: Error): void {
		if (disposed) return; disposed = true;
		for (const request of pending.values()) { request.cleanup(); request.cancellation.abort(); request.reject(error); request.finish(); } pending.clear(); draining = null;
		port.removeEventListener('message', onMessage); port.removeEventListener('error', onFailure); port.removeEventListener('messageerror', onFailure); port.terminate();
	}
}
function asError(value: unknown): Error { return value instanceof Error ? value : new Error(String(value)); }
