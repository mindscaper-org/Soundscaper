/* SPDX-License-Identifier: AGPL-3.0-only */

import { VideoRetimeFrameIntervalMismatch } from '../video-retime-html-video-seek-port.ts';
import {
	admitVideoKeyframeOfflineHtmlVideoSourceAssets, bindVideoKeyframeOfflineHtmlVideoEntry,
} from './video-keyframe-offline-html-video-source-admission.ts';
import {
	createVideoKeyframeOfflineHtmlVideoSourceResolver, type VideoKeyframeOfflineHtmlVideoSourceResolverOptions,
} from './video-keyframe-offline-html-video-source-resolver.ts';
import type { VideoKeyframeOfflineSourcePresentation, VideoKeyframeOfflineSourceSession } from './video-keyframe-offline-rgba-source.ts';

/** Choose a stable drawable for the occurrence before the compositor admits it. */
export function createVideoKeyframeOfflineDeliverySourceResolver(
	options: VideoKeyframeOfflineHtmlVideoSourceResolverOptions,
): VideoKeyframeOfflineSourceSession {
	const html = createVideoKeyframeOfflineHtmlVideoSourceResolver(options);
	if (typeof VideoDecoder !== 'function') return html;
	const assets = admitVideoKeyframeOfflineHtmlVideoSourceAssets(options.sources);
	const verified = new WeakSet<VideoKeyframeOfflineSourcePresentation>();
	const fallbacks = new Map<string, VideoKeyframeOfflineSourcePresentation>();
	const lifetime = new AbortController();
	const { prepareDecoderSource, document, timeoutMs } = options;
	return Object.freeze<VideoKeyframeOfflineSourceSession>({
		async resolveSource(entry, request) {
			lifetime.signal.throwIfAborted();
			request.signal.throwIfAborted();
			const binding = fallbacks.size ? bindVideoKeyframeOfflineHtmlVideoEntry(entry, assets) : undefined;
			const existing = binding && fallbacks.get(binding.occurrenceKey);
			if (existing) return existing;
			const presentation = await html.resolveSource(entry, request);
			if (verified.has(presentation)) return presentation;
			verified.add(presentation);
			const { asset, occurrenceKey } = binding ?? bindVideoKeyframeOfflineHtmlVideoEntry(entry, assets);
			if (!/^video\/(?:mp4|quicktime|x-m4v)(?:;|$)/iu.test(asset.blob.type)) return presentation;
			const signal = AbortSignal.any([request.signal, lifetime.signal]);
			try {
				await presentation.present(entry, { signal });
				return presentation;
			} catch (error) {
				signal.throwIfAborted();
				if (!(error instanceof VideoRetimeFrameIntervalMismatch)) throw error;
				await presentation.dispose();
				const { createPacketPicturePresentation } = await import('./video-keyframe-offline-packet-picture.ts');
				const body = await prepareDecoderSource?.(asset, signal) ?? asset.blob;
				const fallback = await createPacketPicturePresentation({
					body, asset, document: document ?? globalThis.document, signal,
					useCodedAvcRaster: body === asset.blob && presentation.decodedWidth === asset.postRotationAspectWidth
						&& presentation.decodedHeight === asset.decodedHeight,
					timeoutMs: timeoutMs ?? 5_000,
					bindEntry(value) {
						const next = bindVideoKeyframeOfflineHtmlVideoEntry(value, assets);
						if (next.occurrenceKey !== occurrenceKey) throw new Error('The packet decoder received a different source occurrence.');
						return next.entry;
					},
					onClose: () => { fallbacks.delete(occurrenceKey); },
				});
				if (!fallback) throw error;
				fallbacks.set(occurrenceKey, fallback);
				return fallback;
			}
		},
		async dispose() {
			lifetime.abort();
			const results = await Promise.allSettled([
				Promise.resolve().then(() => html.dispose()),
				...[...fallbacks.values()].map(async presentation => presentation.dispose()),
			]);
			const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
			if (errors.length) throw new AggregateError(errors, 'Offline picture source cleanup failed.');
		},
	});
}
