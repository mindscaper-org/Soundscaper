/* SPDX-License-Identifier: AGPL-3.0-only */

import { canonicalMediaContentBlob, digestMediaContent } from '../common/editor/storage/media-content-digest.ts';
import { loadVideoTimingAsset } from '../common/editor/video-timing-storage.ts';

export interface SoundscaperRecoveryVideoStore {
	loadMediaAsset?(storageKey: string): PromiseLike<unknown>;
	getLinkedOriginalBinding?(projectId: string, sourceId: string): PromiseLike<unknown>;
	resolveLinkedVideoOriginal?(projectId: string, source: unknown): PromiseLike<Readonly<{ blob?: unknown }> | null>;
}

/** Preserve only readable original bytes and the timing authority those bytes require. */
export async function soundscaperRecoveryVideoAvailable(
	store: SoundscaperRecoveryVideoStore,
	project: Readonly<Record<string, unknown>>,
	source: Readonly<Record<string, unknown>>,
): Promise<boolean> {
	const load = store.loadMediaAsset;
	if (!load) throw new Error('Video recovery media reads are unavailable.');
	const storageKey = typeof source.storageKey === 'string' && source.storageKey ? source.storageKey : String(source.id);
	const stored = await load.call(store, storageKey);
	const bound = !stored && typeof project.id === 'string'
		&& (!store.getLinkedOriginalBinding || await store.getLinkedOriginalBinding(project.id, String(source.id)));
	const linked = bound && typeof project.id === 'string'
		? await store.resolveLinkedVideoOriginal?.(project.id, source) : null;
	const value = stored ?? linked?.blob;
	if (!value) return false;
	let blob: Blob;
	try { blob = canonicalMediaContentBlob(value); } catch { return false; }
	if (!blob.size || (typeof source.contentSha256 === 'string'
		&& await digestMediaContent(blob) !== source.contentSha256)) return false;
	if (source.timingAsset == null) return true;
	const timing = await loadVideoTimingAsset({ loadMediaAsset: key => load.call(store, key) }, source.timingAsset,
		{ ...(typeof source.contentSha256 === 'string' ? { sourceSha256: source.contentSha256 } : {}) });
	return timing.status === 'available';
}
