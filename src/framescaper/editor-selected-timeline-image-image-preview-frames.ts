/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FramescaperImageFramePackSnapshotReaderV1 } from '../common/editor/timeline-image-frame-pack-v1.ts';
import {
	openFramescaperStoredImageFramePackTimelineImage,
	scaleFramescaperImageRgbaTimelineImage,
	throwIfFramescaperImagePreviewAbortedTimelineImage,
	type FramescaperStoredImageAssetStoreTimelineImage,
} from './editor-selected-timeline-image-image-frame-source.ts';
import {
	assertFramescaperImagePreviewReaderMetadataTimelineImage,
	FRAMESCAPER_IMAGE_PREVIEW_CACHE_FRAMES_PER_SOURCE_TIMELINE_IMAGE,
	type FramescaperImagePreviewResourceContextTimelineImage,
} from './editor-selected-timeline-image-image-preview-resources.ts';

export interface FramescaperImagePreviewFramesTimelineImage extends FramescaperImagePreviewResourceContextTimelineImage {
	readonly reader: FramescaperImageFramePackSnapshotReaderV1;
	/** Borrowed until the next cache miss or disposal. Present onto the drawable immediately. */
	read(index: number): Uint8Array<ArrayBuffer>;
	prefetchAfter(index: number): (() => void) | undefined;
	dispose(): void;
}

/** Authenticate every source up front and leave picture inflation to the preview clock. */
export async function openFramescaperImagePreviewFramesTimelineImage(
	store: FramescaperStoredImageAssetStoreTimelineImage,
	contexts: readonly FramescaperImagePreviewResourceContextTimelineImage[],
	signal?: AbortSignal,
): Promise<FramescaperImagePreviewFramesTimelineImage[]> {
	const sources: FramescaperImagePreviewFramesTimelineImage[] = [];
	try {
		for (const context of [...contexts].sort((left, right) => (
			left.source.id < right.source.id ? -1 : left.source.id > right.source.id ? 1 : 0
		))) {
			const reader = await openFramescaperStoredImageFramePackTimelineImage(
				store, context.source, signal,
				(byteLength) => { assertFramescaperImagePreviewReaderMetadataTimelineImage(context.source, byteLength); },
			);
			sources.push(createFramescaperImagePreviewFramesTimelineImage(context, reader, signal));
		}
		return sources;
	} catch (error) {
		disposeFramescaperImagePreviewFramesTimelineImage(sources);
		throw error;
	}
}

export function createFramescaperImagePreviewFramesTimelineImage(
	context: FramescaperImagePreviewResourceContextTimelineImage,
	reader: FramescaperImageFramePackSnapshotReaderV1,
	signal?: AbortSignal,
): FramescaperImagePreviewFramesTimelineImage {
	const { source, width, height } = context;
	const pictures = new Map<number, Uint8Array<ArrayBuffer>>();
	let disposed = false;
	let refusedPrefetch = -1;
	function read(index: number): Uint8Array<ArrayBuffer> {
		if (disposed) throw new Error('The timelineImage picture cache is disposed.');
		throwIfFramescaperImagePreviewAbortedTimelineImage(signal);
		const cached = pictures.get(index);
		if (cached) {
			pictures.delete(index);
			pictures.set(index, cached);
			return cached;
		}
		const raw = reader.readFrameSync(index, signal);
		let rgba: Uint8Array<ArrayBuffer>;
		try {
			rgba = scaleFramescaperImageRgbaTimelineImage(raw, source.canonical.width, source.canonical.height, width, height, signal);
		} finally { raw.fill(0); }
		if (pictures.size >= FRAMESCAPER_IMAGE_PREVIEW_CACHE_FRAMES_PER_SOURCE_TIMELINE_IMAGE) {
			const oldest = pictures.keys().next().value!;
			pictures.get(oldest)!.fill(0);
			pictures.delete(oldest);
		}
		pictures.set(index, rgba);
		return rgba;
	}
	return Object.freeze({ ...context, reader, read,
		prefetchAfter(index: number): (() => void) | undefined {
			const next = index + 1;
			if (next >= source.canonical.frameCount || next === refusedPrefetch || pictures.has(next)) return undefined;
			return () => {
				if (disposed || signal?.aborted || pictures.has(next)) return;
				try { read(next); } catch { refusedPrefetch = next; }
			};
		},
		dispose(): void {
			disposed = true;
			for (const picture of pictures.values()) picture.fill(0);
			pictures.clear();
		},
	});
}

export function disposeFramescaperImagePreviewFramesTimelineImage(sources: FramescaperImagePreviewFramesTimelineImage[]): void {
	for (const source of sources) source.dispose();
	sources.length = 0;
}

/** One cancellable nearby picture for the latest playhead resolve across all sources. */
export function createFramescaperImagePreviewPrefetchTimelineImage() {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let pending: (() => void) | undefined;
	return (next?: () => void): void => {
		pending = next;
		if (!next) {
			clearTimeout(timer);
			timer = undefined;
		} else if (timer === undefined) {
			timer = setTimeout(() => {
				const load = pending;
				pending = undefined;
				timer = undefined;
				load?.();
			}, 0);
		}
	};
}
