/* SPDX-License-Identifier: AGPL-3.0-only */

import type { LocalAssistanceVideoKeyingRun } from './local-assistance-video-keying-publication.ts';
import type { FullRasterKeyingVideoDecoder } from './local-assistance-video-keying-frames.ts';

/** A single source-sized canvas and paused decoder, bounded by the frame-pack geometry gate. */
export async function createFullRasterKeyingVideoDecoder(body: Blob, run: LocalAssistanceVideoKeyingRun,
	signal: AbortSignal): Promise<FullRasterKeyingVideoDecoder> {
	if (!globalThis.document?.createElement || !globalThis.URL?.createObjectURL) throw new Error('Full-resolution browser video decoding is unavailable.');
	signal.throwIfAborted();
	const video = document.createElement('video');
	const canvas = document.createElement('canvas');
	canvas.width = run.width; canvas.height = run.height;
	const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true });
	if (!context) throw new Error('Full-resolution keying requires canvas pixel readback.');
	const { selectedRangeDescriptorForBlob } = await import('../../../../desktop-selected-range-blob.ts');
	const selected = selectedRangeDescriptorForBlob(body);
	const url = selected?.url ?? URL.createObjectURL(body);
	let disposed = false;
	const dispose = (): void => {
		if (disposed) return; disposed = true;
		video.pause(); video.removeAttribute('src'); video.load(); canvas.width = 0; canvas.height = 0;
		if (!selected) URL.revokeObjectURL(url);
	};
	try {
		video.preload = 'auto'; video.muted = true; video.playsInline = true;
		const loaded = event(video, 'loadeddata', signal);
		video.src = url; await loaded;
		if (video.videoWidth !== run.width || video.videoHeight !== run.height) {
			throw new Error('The browser decoder changed source dimensions or applied an unsupported display rotation.');
		}
		return Object.freeze({ async capture(timestampSeconds: number, captureSignal: AbortSignal) {
			captureSignal.throwIfAborted();
			if (disposed) throw new Error('The keying video decoder is closed.');
			if (Math.abs(video.currentTime - timestampSeconds) > 0.000001) {
				const seeked = event(video, 'seeked', captureSignal);
				const presented = presentedFrame(video, captureSignal, timestampSeconds, run.frameRate.den / run.frameRate.num);
				video.currentTime = timestampSeconds; await Promise.all([seeked, presented]);
			}
			captureSignal.throwIfAborted();
			context.clearRect(0, 0, run.width, run.height);
			context.drawImage(video, 0, 0, run.width, run.height);
			return Uint8Array.from(context.getImageData(0, 0, run.width, run.height).data);
		}, dispose });
	} catch (error) { dispose(); throw error; }
}

function event(video: HTMLVideoElement, name: 'loadeddata' | 'seeked', signal: AbortSignal): Promise<void> {
	signal.throwIfAborted();
	return new Promise((resolve, reject) => {
		const complete = (error?: unknown): void => {
			clearTimeout(timer); video.removeEventListener(name, ready); video.removeEventListener('error', failed);
			signal.removeEventListener('abort', aborted);
			if (error !== undefined) reject(error); else resolve();
		};
		const ready = (): void => complete();
		const failed = (): void => complete(new Error('The browser could not decode this source video.'));
		const aborted = (): void => complete(signal.reason);
		const timer = setTimeout(() => complete(new Error('Full-resolution keying video decode timed out.')), 30_000);
		video.addEventListener(name, ready, { once: true }); video.addEventListener('error', failed, { once: true });
		signal.addEventListener('abort', aborted, { once: true });
	});
}

function presentedFrame(video: HTMLVideoElement, signal: AbortSignal, timestamp: number, duration: number): Promise<void> {
	if (typeof video.requestVideoFrameCallback !== 'function') return Promise.resolve();
	return new Promise((resolve, reject) => {
		let callbackId = 0;
		const clean = (): void => { clearTimeout(timer); signal.removeEventListener('abort', aborted);
			video.cancelVideoFrameCallback(callbackId); };
		const aborted = (): void => { clean(); reject(signal.reason); };
		const timer = setTimeout(() => { clean(); reject(new Error('The keying source frame was not presented.')); }, 30_000);
		signal.addEventListener('abort', aborted, { once: true });
		const presented: VideoFrameRequestCallback = (_now, metadata) => {
			if (metadata.mediaTime <= timestamp + 0.001 && metadata.mediaTime > timestamp - duration - 0.001) {
				clean(); resolve();
			} else callbackId = video.requestVideoFrameCallback(presented);
		};
		callbackId = video.requestVideoFrameCallback(presented);
	});
}
