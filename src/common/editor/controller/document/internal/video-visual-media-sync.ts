/* SPDX-License-Identifier: AGPL-3.0-only */
import type { ProjectVisualSource, VideoVisual, VideoVisualRecord } from '../project-visual-types.ts';

export function videoVisualMediaIdentity(source: ProjectVisualSource): string {
	return JSON.stringify([source.storageKey || source.id, source.contentSha256 ?? null]);
}

/** Rebind only previously activated video sources whose immutable media changed. */
export function createVideoVisualMediaSynchronizer(
	getSources: () => readonly ProjectVisualSource[],
	records: ReadonlyMap<string, Readonly<VideoVisualRecord>>,
	knownMedia: ReadonlyMap<string, string>,
	revoke: (sourceId: string, expectedUrl?: string | null) => Promise<boolean>,
	activate: (source: ProjectVisualSource) => Promise<Readonly<VideoVisual> | null>,
): () => Promise<boolean> {
	return async () => {
		const operations = getSources().filter(source => source.kind === 'video' && knownMedia.has(source.id))
			.flatMap(source => {
				const identity = videoVisualMediaIdentity(source), record = records.get(source.id);
				if (knownMedia.get(source.id) === identity) return [];
				// Both calls begin synchronously against this activation. Retirement
				// removes the old record before yielding; activation captures its own
				// project/generation fence before any storage read can finish.
				const retired = revoke(source.id, record?.visual.mediaUrl);
				const activated = activate(source);
				return [Promise.all([retired, activated]).then(([, visual]) => Boolean(visual
					&& records.get(source.id)?.visual === visual))];
			});
		return (await Promise.all(operations)).some(Boolean);
	};
}
