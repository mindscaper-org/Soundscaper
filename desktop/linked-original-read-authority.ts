/* SPDX-License-Identifier: AGPL-3.0-only */
import { persistedLinkedVideoFileIdentityFromStat, type LinkedVideoFileStat, type PersistedLinkedVideoFileIdentity } from './linked-video-locator-registry.ts';

/** Only filesystem absence proves the original is missing; failed inspection is not evidence. */
export async function readLinkedOriginalFileIdentity(
	path: string, stat: (path: string) => PromiseLike<LinkedVideoFileStat> | LinkedVideoFileStat,
): Promise<PersistedLinkedVideoFileIdentity | null> {
	try {
		return persistedLinkedVideoFileIdentityFromStat(await stat(path));
	} catch (error) {
		if (error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return null;
		throw error;
	}
}

/** A retired grant says nothing about the continued existence of its external file. */
export function assertLinkedOriginalReadAuthority(current: boolean): asserts current {
	if (current) return;
	const error = new Error('The linked-original read authority is no longer current.');
	error.name = 'InvalidStateError';
	throw error;
}
