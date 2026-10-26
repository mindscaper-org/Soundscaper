/* SPDX-License-Identifier: AGPL-3.0-only */

type DataRecord = Record<string, unknown>;
type Relationship = 'groupId' | 'avLinkId';
interface Membership { readonly id: string; readonly members: readonly string[] }
export type TrackLockRelationshipReader = (owned: readonly string[], field: Relationship) => readonly Membership[];

/** Direct-handler getters/custom collections retain the established snapshot evaluation order. */
function inertProjectTree(project: object): boolean {
	const pending: unknown[] = [project], seen = new Set<object>();
	while (pending.length) {
		const value = pending.pop();
		if (typeof value === 'function') return false;
		if (!value || typeof value !== 'object' || seen.has(value)) continue;
		seen.add(value);
		const prototype = Object.getPrototypeOf(value) as unknown;
		if (Array.isArray(value)) {
			if (prototype !== Array.prototype) return false;
			for (let index = 0; index < value.length; index++) if (!Object.hasOwn(value, index)) return false;
		} else if (prototype !== Object.prototype && prototype !== null) return false;
		for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
			if (!Object.hasOwn(descriptor, 'value')) return false;
			pending.push(descriptor.value as unknown);
		}
	}
	return true;
}

/** All indexes belong to this snapshot context; published baselines retain only frozen scalar arrays. */
export function createTrackLockRelationshipReader(project: object, clips: readonly DataRecord[]): TrackLockRelationshipReader | null {
	if (!inertProjectTree(project)) return null;
	const byField = new Map<Relationship, {
		readonly idsByClip: Map<string, string[]>;
		readonly members: Map<string, readonly string[]>;
	}>();
	for (const field of ['groupId', 'avLinkId'] as const) {
		const idsByClip = new Map<string, string[]>(), members = new Map<string, string[]>();
		for (const clip of clips) {
			const id = clip.id, relationship = clip[field];
			if (typeof id !== 'string') return null;
			if (typeof relationship !== 'string') continue;
			const ids = idsByClip.get(id);
			if (ids) ids.push(relationship); else idsByClip.set(id, [relationship]);
			const group = members.get(relationship);
			if (group) group.push(id); else members.set(relationship, [id]);
		}
		byField.set(field, { idsByClip, members: new Map([...members].map(([id, values]) => [id, Object.freeze(values.sort())])) });
	}
	return (owned, field) => {
		const index = byField.get(field)!;
		const ids = new Set<string>();
		for (const clipId of owned) for (const id of index.idsByClip.get(clipId) ?? []) ids.add(id);
		return Object.freeze([...ids].sort().map(id => Object.freeze({ id, members: index.members.get(id)! })));
	};
}
