/* SPDX-License-Identifier: AGPL-3.0-only */

import { ID3_DESCRIPTIVE_FIELDS } from './id3-descriptive-fields.ts';
import { ID3_CONTROL_KEYS, normalizeId3Key } from './id3-frame-values.ts';

export interface Id3FieldEntry {
	readonly key: string;
	readonly normalizedKey: string;
	readonly value: string;
}

const COMPANION_NAMES = new Map([
	...ID3_DESCRIPTIVE_FIELDS.filter(field => ID3_CONTROL_KEYS.has(normalizeId3Key(field.key))).map(field => [normalizeId3Key(field.key), field.key] as const),
	...['id3Artwork', 'tracksTotal', 'discsTotal'].map(key => [normalizeId3Key(key), key] as const),
]);
const STRUCTURED_NAMES = new Map(ID3_DESCRIPTIVE_FIELDS
	.filter(field => field.kind === 'structured' && !ID3_CONTROL_KEYS.has(normalizeId3Key(field.key)))
	.map(field => [normalizeId3Key(field.key), field.key]));

/** Companion values use the same case and separator aliases as their parent frames. */
export function id3CompanionMetadata(metadata: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
	const result = { ...metadata };
	for (const [key, value] of Object.entries(metadata)) {
		const canonical = COMPANION_NAMES.get(normalizeId3Key(key));
		if (canonical && !Object.hasOwn(metadata, canonical)) Object.defineProperty(result, canonical, { value, enumerable: true, configurable: true, writable: true });
	}
	return Object.freeze(result);
}

export function id3StructuredGroup(normalizedKey: string): string {
	return normalizedKey === 'comment' ? 'comments' : normalizedKey;
}

/** A standard structured frame is unique; secondary aliases remain custom TXXX fields. */
export function preferredId3StructuredEntries(entries: readonly Id3FieldEntry[]): ReadonlyMap<string, Id3FieldEntry> {
	const selected = new Map<string, Id3FieldEntry>();
	const priority = (entry: Id3FieldEntry, canonical: string): number => entry.key === canonical ? 3
		: entry.normalizedKey === normalizeId3Key(canonical) ? 2 : 1;
	for (const entry of entries) {
		const group = id3StructuredGroup(entry.normalizedKey);
		const canonical = STRUCTURED_NAMES.get(group);
		if (!canonical) continue;
		const current = selected.get(group);
		if (!current || priority(entry, canonical) > priority(current, canonical)
			|| priority(entry, canonical) === priority(current, canonical) && entry.key < current.key) selected.set(group, entry);
	}
	return selected;
}
