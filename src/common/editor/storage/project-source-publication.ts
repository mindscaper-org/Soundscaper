/* SPDX-License-Identifier: AGPL-3.0-only */

import { request } from '../../media/indexeddb.ts';
import { publishSource } from './media-records.ts';
import { asRecord } from './project-repository-support.ts';

const SOURCE_PUBLICATION_BATCH_SIZE = 16;

/** Clear staged-source retention inside the transaction that publishes its project. */
export async function publishProjectSources(
	stores: Readonly<{ sources: IDBObjectStore; mediaAssets: IDBObjectStore }>,
	sourceIds: Iterable<string>,
): Promise<void> {
	let batch: string[] = [];
	for (const sourceId of sourceIds) {
		batch.push(sourceId);
		if (batch.length === SOURCE_PUBLICATION_BATCH_SIZE) {
			await publishBatch(stores, batch);
			batch = [];
		}
	}
	if (batch.length) await publishBatch(stores, batch);
}

async function publishBatch(
	{ sources, mediaAssets }: Readonly<{ sources: IDBObjectStore; mediaAssets: IDBObjectStore }>,
	sourceIds: readonly string[],
): Promise<void> {
	await Promise.all(sourceIds.map(async (sourceId) => {
		const [source, media] = await Promise.all([read(sources, sourceId), read(mediaAssets, sourceId)]);
		await Promise.all([publish(sources, source), publish(mediaAssets, media)]);
	}));
}

async function read(store: IDBObjectStore, sourceId: string): Promise<unknown> {
	return request(store.get(sourceId));
}

async function publish(store: IDBObjectStore, value: unknown): Promise<void> {
	const source = asRecord(value);
	if (source?.pendingProjectUntil) await request(store.put(publishSource(source)));
}
