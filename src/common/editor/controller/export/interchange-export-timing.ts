/* SPDX-License-Identifier: AGPL-3.0-only */

import { createVisibleVideoTrackPredicate } from '../../video-track-visibility.js';
import { loadVideoTimingAsset } from '../../video-timing-storage.ts';
import { acquireVideoTimingIndex, registeredVideoTimingIndex, type VideoTimingIndexLease } from '../../video-source-time.ts';
import { isVideoTimingIndexVerifiedForReference } from '../../video-timing-asset.ts';

type Data = Readonly<Record<string, unknown>>;

export interface InterchangeTimingRuntime {
	readonly getProject: () => Data | null | undefined;
	readonly store?: Readonly<{
		loadMediaAsset(storageKey: string): PromiseLike<unknown>;
	}> | null;
}

/** Restore persisted exact source clocks for synchronous exchange writers, then release only our leases. */
export async function withInterchangeExportTiming<Result>(
	runtime: InterchangeTimingRuntime, project: Data, original: Data, write: () => Result,
	/** Undefined selects all picture tracks; null selects the first, as the EDL menu does. */
	trackId?: string | null,
): Promise<Result> {
	if (!runtime.store) return write();
	const assertCurrent = () => {
		if (runtime.getProject() !== original) throw new DOMException('The interchange export project changed.', 'AbortError');
	};
	const visible = createVisibleVideoTrackPredicate(records(project.tracks));
	let tracks = records(project.tracks).filter(track => visible(track));
	if (trackId !== undefined) tracks = trackId === null ? tracks.slice(0, 1) : tracks.filter(track => track.id === trackId);
	const clipIds = new Set(tracks.flatMap(track => Array.isArray(track.clipIds) ? track.clipIds.map(String) : []));
	const sourceIds = new Set(records(project.clips)
		.filter(clip => clip.kind === 'video' && Object.hasOwn(clip, 'sourceInFrame') && clipIds.has(String(clip.id)))
		.map(clip => String(clip.sourceId)));
	const leases: VideoTimingIndexLease[] = [];
	try {
		for (const source of records(project.sources)) {
			if (!sourceIds.has(String(source.id)) || record(source.timingDecision).mode !== 'exact') continue;
			const existing = registeredVideoTimingIndex(source);
			if (existing && isVideoTimingIndexVerifiedForReference(existing, source.timingAsset)) continue;
			assertCurrent();
			const loaded = await loadVideoTimingAsset(runtime.store, source.timingAsset, {
				sourceSha256: typeof source.contentSha256 === 'string' ? source.contentSha256 : undefined,
			});
			assertCurrent();
			if (loaded.status !== 'available' || !loaded.index) {
				throw new Error(`The interchange video timing asset is ${loaded.status}.`);
			}
			leases.push(acquireVideoTimingIndex(source, loaded.index));
		}
		assertCurrent();
		return write();
	} finally {
		for (let index = leases.length - 1; index >= 0; index--) leases[index]?.release();
	}
}

function record(value: unknown): Data {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Data : {};
}

function records(value: unknown): readonly Data[] {
	return Array.isArray(value) ? value.filter((item): item is Data => item !== null && typeof item === 'object' && !Array.isArray(item)) : [];
}
