/* SPDX-License-Identifier: AGPL-3.0-only */

import { ScapeProjectReopenConflictError } from '../common/editor/scape-project-canonical-inspection.ts';
import { isMissingMediaAssetError } from '../common/editor/storage/media-asset-load-repository.ts';
import { normalizeFramescaperImageSourceV1 } from '../common/editor/timeline-image-model.ts';
import { digestMediaContent } from '../common/media/content-digest.ts';
import { awaitScapeReadOperation, throwIfScapeAborted } from '../common/scape/abort.ts';
import type { FramescaperProject } from './editor-project.ts';
import type { FramescaperScapeNativeStore } from './editor-scape-native.ts';

/** Same-image reuse needs the current stored body in addition to the archive's verified body. */
export async function requireReusedTimelineImageBodies(
	project: FramescaperProject,
	store: FramescaperScapeNativeStore,
	signal?: AbortSignal,
): Promise<void> {
	for (const candidate of project.sources) {
		if (candidate.kind !== 'image') continue;
		const source = normalizeFramescaperImageSourceV1(candidate);
		const load = store.loadMediaAsset;
		if (typeof load !== 'function') throw new TypeError('Reopening a timeline image requires local media reads.');
		try {
			const body = await awaitScapeReadOperation(() => load.call(store, source.storageKey, { signal }), signal);
			if (body?.size === source.assetByteLength && await digestMediaContent(body, { signal }) === source.contentSha256) continue;
		} catch (error) {
			throwIfScapeAborted(signal);
			if (!isMissingMediaAssetError(error)) throw error;
		}
		throw new ScapeProjectReopenConflictError();
	}
}
