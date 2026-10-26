/* SPDX-License-Identifier: AGPL-3.0-only */

import type { SampleEditSource, SampleEditStore, SampleEditStoredChunk } from './sample-edit-types.ts';
import type { SourcePcmReadSession } from './storage/source-read-repository.ts';

/** Random-access only the requested chunks within an owned, generation-fenced read. */
export async function* readSampleEditChunks(
	store: SampleEditStore,
	source: SampleEditSource,
	indices: readonly number[],
	signal: AbortSignal | null,
): AsyncGenerator<Readonly<{ index: number; chunk: SampleEditStoredChunk }>> {
	signal?.throwIfAborted();
	if (store.openSourceReadSession) {
		const expectedSource = await store.getSourceMetadata?.(source.id);
		const session = await store.openSourceReadSession(source.id, {
			...(signal ? { signal } : {}), ...(expectedSource ? { expectedSource } : {}),
		});
		if (session) {
			let failure: unknown; let failed = false;
			try {
				for (const index of indices) {
					signal?.throwIfAborted();
					yield { index, chunk: await session.chunk(index, signal ? { signal } : {}) };
				}
			} catch (error) { failed = true; failure = error; throw error; }
			finally { await releaseSession(session, failed, failure); }
			return;
		}
	}
	let index = 0;
	for await (const chunk of store.readSourceChunks(source.id)) {
		signal?.throwIfAborted();
		yield { index, chunk }; index += 1;
	}
}

async function releaseSession(session: SourcePcmReadSession, failed: boolean, failure: unknown): Promise<void> {
	try { await session.release(); }
	catch (cleanup) {
		if (failed) throw new AggregateError([failure, cleanup], 'Sample source read and cleanup both failed.', { cause: cleanup });
		throw cleanup;
	}
}
