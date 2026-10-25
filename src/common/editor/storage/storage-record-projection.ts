/* SPDX-License-Identifier: AGPL-3.0-only */
import type { StorageRecord } from './media-records.ts';
import { cloneStorageValue } from './storage-clone.ts';

/** Materialize only selected records, retaining source order and full cloned payload ownership. */
export function cloneSelectedStorageRecords(values: Iterable<unknown>, matches?: (record: StorageRecord) => boolean): StorageRecord[] {
	const result: StorageRecord[] = [];
	for (const value of values) {
		if (!value || typeof value !== 'object') continue;
		const record = value as StorageRecord;
		if (!matches || matches(record)) result.push(record);
	}
	for (let index = 0; index < result.length; index++) result[index] = cloneStorageValue(result[index]!);
	return result;
}

/** Temporary cleanup owns only scalar path/token roots, never encoded media bytes. */
export function mediaAssetRetentionRecords(values: Iterable<unknown>): StorageRecord[] {
	const result: StorageRecord[] = [];
	for (const value of values) {
		if (!value || typeof value !== 'object') continue;
		const record = value as StorageRecord;
		result.push({ path: record.path, mediaChunkToken: record.mediaChunkToken });
	}
	return result;
}
