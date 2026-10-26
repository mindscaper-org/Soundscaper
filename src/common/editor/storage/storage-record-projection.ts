/* SPDX-License-Identifier: AGPL-3.0-only */
import type { StorageRecord } from './media-records.ts';
import { cloneStorageValue } from './storage-clone.ts';

/** Snapshot membership before matching, then compact the privately owned reference array stably. */
export function selectStorageRecords<RecordType extends object = StorageRecord>(
	values: Iterable<unknown>, matches?: (record: RecordType) => boolean,
): RecordType[] {
	const result = Array.from(values);
	let retained = 0;
	for (let index = 0; index < result.length; index++) {
		const value = result[index];
		if (!value || typeof value !== 'object') continue;
		const record = value as RecordType;
		if (!matches || matches(record)) result[retained++] = record;
	}
	result.length = retained;
	return result as RecordType[];
}

/** Clone only selected records after all matching, preserving the original error and ownership boundary. */
export function cloneSelectedStorageRecords(values: Iterable<unknown>, matches?: (record: StorageRecord) => boolean): StorageRecord[] {
	const result = selectStorageRecords(values, matches);
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
