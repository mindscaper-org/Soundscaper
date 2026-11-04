/* SPDX-License-Identifier: AGPL-3.0-only */

interface Protection { claims: number; readonly borrowed: boolean }
const protections = new WeakMap<Set<string>, Map<string, Protection>>();

/** Background import work and staged replacement choices may retain the same source. */
export function claimProtectedSources(sourceIds: readonly string[], protectedSourceIds: Set<string>): () => void {
	const entries = protections.get(protectedSourceIds) ?? new Map<string, Protection>();
	protections.set(protectedSourceIds, entries);
	const owned = [...new Set(sourceIds)];
	for (const sourceId of owned) {
		const protection = entries.get(sourceId);
		if (protection) protection.claims += 1;
		else entries.set(sourceId, { claims: 1, borrowed: protectedSourceIds.has(sourceId) });
		protectedSourceIds.add(sourceId);
	}
	let released = false;
	return () => {
		if (released) return;
		released = true;
		for (const sourceId of owned) {
			const protection = entries.get(sourceId)!;
			if (--protection.claims > 0) continue;
			entries.delete(sourceId);
			if (!protection.borrowed) protectedSourceIds.delete(sourceId);
		}
	};
}
