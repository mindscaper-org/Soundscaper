/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoSample } from 'mediabunny';
import { raceAbortableRead } from '../../foundation/abort-race.ts';
import { createVideoRetimeHtmlVideoPresentationRequest } from '../video-retime-html-video-seek-port.ts';
import type { VideoKeyframeOfflineHtmlVideoSourceAssetSnapshot } from './video-keyframe-offline-html-video-source-admission.ts';
import type { VideoKeyframeOfflineSourcePresentation } from './video-keyframe-offline-rgba-source.ts';

const MAXIMUM_FORWARDS_SKIP = 120;

/** Decode only an admitted picture clock and use one buffered traversal per occurrence. */
export async function createPacketPicturePresentation(options: Readonly<{
	body: Blob;
	asset: VideoKeyframeOfflineHtmlVideoSourceAssetSnapshot;
	document: Pick<Document, 'createElement'>;
	signal: AbortSignal;
	timeoutMs: number;
	bindEntry(value: unknown): Readonly<Record<string, unknown>>;
	onClose(): void;
}>): Promise<VideoKeyframeOfflineSourcePresentation | null> {
	const { body, asset, document, signal, timeoutMs, bindEntry, onClose } = options;
	const { sourceId, identity, decodedWidth, decodedHeight, displayWidth, displayHeight } = asset;
	if (decodedWidth !== displayWidth || decodedHeight !== displayHeight) return null;
	const { BlobSource, Input, MP4, QTFF, VideoSampleSink } = await import('mediabunny');
	signal.throwIfAborted();
	const input = new Input({ source: new BlobSource(body, { maxCacheSize: 1024 ** 2, useStreamReader: false }), formats: [MP4, QTFF] });
	let transferred = false;
	try {
		const setup = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
		const [track, ...otherPictures] = await raceAbortableRead(() => input.getVideoTracks(), setup);
		if (!track || otherPictures.length || await raceAbortableRead(() => track.getCodec(), setup) !== 'avc') return null;
		const matrix = await raceAbortableRead(() => track.getTransformationMatrix(), setup);
		if (!matrix.every((value, index) => value === (index % 4 === 0 ? 1 : 0))) return null;
		if (!await raceAbortableRead(() => track.canDecode(), setup)) return null;
		setup.throwIfAborted();
		const drawable = document.createElement('canvas');
		drawable.width = decodedWidth;
		drawable.height = decodedHeight;
		const context = drawable.getContext('2d', { alpha: false });
		if (!context) return null;
		const sink = new VideoSampleSink(track);
		let stream: AsyncGenerator<VideoSample, void, unknown> | null = null;
		const lifetime = new AbortController();
		let lastOrdinal = -1;
		let retired = false;
		const closeStream = async (): Promise<void> => {
			const current = stream;
			stream = null;
			if (current) await current.return();
		};
		const presentation: VideoKeyframeOfflineSourcePresentation = {
			sourceId, identity, drawable, decodedWidth, decodedHeight, displayWidth, displayHeight,
			async present(entry, request) {
				if (retired) throw new Error('The packet picture decoder is closed.');
				const deadline = AbortSignal.any([lifetime.signal, request.signal, AbortSignal.timeout(timeoutMs)]);
				deadline.throwIfAborted();
				const descriptor = asset.presentationForEntry(bindEntry(entry));
				const seek = createVideoRetimeHtmlVideoPresentationRequest(descriptor, deadline);
				if (lastOrdinal === seek.drawableSourceFrame) return;
				if (!stream || seek.drawableSourceFrame < lastOrdinal || seek.drawableSourceFrame - lastOrdinal > MAXIMUM_FORWARDS_SKIP) {
					await closeStream();
					deadline.throwIfAborted();
					stream = sink.samples(seek.intervalStartSeconds);
				}
				await drawExactSample(stream, seek.intervalStartSeconds, context, deadline, closeStream);
				lastOrdinal = seek.drawableSourceFrame;
			},
			async dispose() {
				if (retired) return;
				retired = true;
				lifetime.abort();
				try { await closeStream(); }
				finally { input.dispose(); drawable.width = 0; onClose(); }
			},
		};
		transferred = true;
		return Object.freeze(presentation);
	} finally { if (!transferred) input.dispose(); }
}

async function drawExactSample(
	stream: AsyncGenerator<VideoSample, void, unknown>, timestamp: number, context: CanvasRenderingContext2D, signal: AbortSignal,
	closeStream: () => Promise<void>,
): Promise<void> {
	const cancel = (): void => { void closeStream().catch(() => undefined); };
	signal.addEventListener('abort', cancel, { once: true });
	try {
		while (!signal.aborted) {
			const { value: sample, done } = await stream.next();
			if (done) break;
			try {
				signal.throwIfAborted();
				if (sample.timestamp < timestamp) continue;
				if (sample.timestamp !== timestamp) break;
				if (sample.displayWidth !== context.canvas.width || sample.displayHeight !== context.canvas.height) {
					throw new RangeError('The packet picture dimensions disagree with the admitted source.');
				}
				sample.draw(context, 0, 0);
				return;
			} finally { sample.close(); }
		}
		signal.throwIfAborted();
		throw new RangeError('No decoded packet picture matches the authored frame timestamp.');
	} finally { signal.removeEventListener('abort', cancel); }
}
