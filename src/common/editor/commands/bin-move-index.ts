/* SPDX-License-Identifier: AGPL-3.0-only */

interface BinMoveClip { readonly id: string; readonly kind?: unknown; readonly avLinkId?: unknown }

/** Resolve each moved A/V item once, retaining project order and its first video ID. */
export function movedBinItemIds<Clip extends BinMoveClip>(clips: readonly Clip[], existingItemIds: Iterable<string> = []): Map<string, string> {
	const ids = new Set<string>();
	const occupied = new Set(existingItemIds);
	const allocated = new Map<string, string>();
	const linked = new Map<unknown, Clip[]>();
	let duplicates = false;
	for (const clip of clips) {
		if (ids.has(clip.id)) duplicates = true;
		ids.add(clip.id);
		if (!clip.avLinkId) continue;
		const members = linked.get(clip.avLinkId);
		if (members) members.push(clip);
		else linked.set(clip.avLinkId, [clip]);
	}
	const items = new Map<string, string>();
	const seen = new Set<unknown>();
	for (const clip of clips) {
		if (!duplicates && clip.avLinkId && seen.has(clip.avLinkId)) continue;
		const members = clip.avLinkId ? linked.get(clip.avLinkId)! : [clip];
		const base = members.find(member => member.kind === 'video')?.id || members[0]?.id || clip.id;
		let id = allocated.get(base);
		if (id === undefined) {
			id = base;
			let suffix = 0;
			while (occupied.has(id)) id = `${base}:bin:${String(++suffix)}`;
			occupied.add(id);
			allocated.set(base, id);
		}
		for (const member of members) items.set(member.id, id);
		seen.add(clip.avLinkId);
	}
	return items;
}
