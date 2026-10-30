/* SPDX-License-Identifier: AGPL-3.0-only */
import { raceAbortableRead } from '../foundation/abort-race.ts';

interface SourceStore {
	getSourceMetadata(sourceId: string): PromiseLike<unknown> | unknown;
}

/** Linked originals retain their document ID when the user accepts new bytes. */
export async function linkedSourceContentDigest(
	store: SourceStore,
	source: Readonly<{ id: string; storageKey?: string }>,
	signal?: AbortSignal,
): Promise<string | undefined> {
	const metadata = await raceAbortableRead(() => store.getSourceMetadata(source.storageKey || source.id), signal);
	if (metadata && typeof metadata === 'object' && 'storage' in metadata
		&& metadata.storage === 'linked-audio-original-v1' && 'sha256' in metadata
		&& typeof metadata.sha256 === 'string' && /^[a-f\d]{64}$/iu.test(metadata.sha256)) {
		return metadata.sha256;
	}
	return undefined;
}
