/* SPDX-License-Identifier: AGPL-3.0-only */

export const SPLIT_TOOL_INDEX_ENTRY_LIMIT = 65_536;
export const SPLIT_TOOL_INDEX_OWNER_LIMIT = 64;
interface Entry { readonly weight: number; active: boolean; readonly evict: () => void; }

/** Eviction bookkeeping never keeps a key or its index alive on its own. */
export function createSplitToolIndexBudget(entryLimit = SPLIT_TOOL_INDEX_ENTRY_LIMIT, ownerLimit = SPLIT_TOOL_INDEX_OWNER_LIMIT) {
	let entries: WeakRef<Entry>[] = [];
	function admit(entry: Entry): void {
		const live = entries.flatMap(reference => { const current = reference.deref(); return current?.active ? [current] : []; });
		let weight = live.reduce((total, current) => total + current.weight, entry.weight);
		while (live.length && (weight > entryLimit || live.length >= ownerLimit)) {
			const oldest = live.shift()!;
			weight -= oldest.weight;
			oldest.evict();
		}
		live.push(entry);
		entries = live.map(current => new WeakRef(current));
	}
	return {
		cache<Key extends object, Value>() {
			const values = new WeakMap<Key, Entry & { readonly value: Value }>();
			return {
				get(key: Key): Value | undefined { return values.get(key)?.value; },
				set(key: Key, value: Value, weight: number): void {
					const previous = values.get(key);
					if (previous) previous.active = false;
					values.delete(key);
					if (weight > entryLimit || ownerLimit < 1) return;
					const owner = new WeakRef(key);
					const entry = { value, weight, active: true, evict(): void { entry.active = false; const current = owner.deref(); if (current && values.get(current) === entry) values.delete(current); } };
					values.set(key, entry);
					admit(entry);
				},
			};
		},
	};
}
