/* SPDX-License-Identifier: AGPL-3.0-only */

/** Operation-owned membership index: a duplicate remains distinguishable from one record. */
export function exactRecordIdIndex<T extends { readonly id?: unknown }>(records: readonly T[]): ReadonlyMap<unknown, T | null> {
	const byId = new Map<unknown, T | null>();
	for (const record of records) byId.set(record.id, byId.has(record.id) ? null : record);
	return byId;
}
