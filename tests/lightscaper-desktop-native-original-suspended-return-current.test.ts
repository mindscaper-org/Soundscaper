/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LightscaperNativeOriginalStoreCurrentV1 } from '../desktop/lightscaper-native-original-store-current-v1.ts';
import { deriveLightscaperNativePhotoOriginalPathsCurrentV1 } from '../desktop/lightscaper-native-original-index-current-v1.ts';
import { readLightscaperNativeOriginalCurrentV1 } from '../desktop/lightscaper-native-original-contract-current-v1.ts';

async function caught(operation: Promise<unknown>): Promise<unknown> {
	try { await operation; return undefined; } catch (error) { return error; }
}
function leaves(error: unknown): unknown[] {
	return error instanceof AggregateError ? (error.errors as unknown[]).flatMap(leaves) : [error];
}

test('Lightscaper native Original fulfilled return with done false retains staging and refuses retirement', { timeout: 10_000 }, async () => {
	const appDataPath = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper suspended return ')));
	const bytes = Uint8Array.of(1, 2, 3);
	const original = readLightscaperNativeOriginalCurrentV1({ schemaVersion: 1, kind: 'still', id: 'source-1', name: 'Original.png',
		mimeType: 'image/png', storageKey: 'original-1', contentSha256: createHash('sha256').update(bytes).digest('hex'),
		width: 1, height: 1, hasAlpha: false, byteLength: bytes.length, retention: 'managed' });
	let finallyEntered = false, finallyCompleted = false;
	async function* source(): AsyncGenerator<Uint8Array, void, unknown> {
		try { yield Uint8Array.of(1, 2, 3, 4); }
		finally {
			finallyEntered = true;
			yield Uint8Array.of(9); // return() fulfills, but this producer remains suspended.
			finallyCompleted = true;
		}
	}
	const producer = source();
	let store: LightscaperNativeOriginalStoreCurrentV1 | undefined, checked = false;
	try {
		store = await LightscaperNativeOriginalStoreCurrentV1.open({ appDataPath });
		const error = await caught(store.store(original, producer));
		assert.equal(finallyEntered, true, 'Product cleanup must request producer return.');
		assert.equal(finallyCompleted, false, 'A yielded finally block proves the producer is still suspended.');
		assert.ok(error instanceof AggregateError, 'Unproved producer retirement must accompany the primary body failure.');
		const failures = leaves(error), primary = failures.find(value => value instanceof RangeError);
		assert.ok(primary instanceof RangeError, 'The overlong-body failure remains observable.');
		const retirement = failures.filter(value => value !== primary);
		assert.ok(retirement.length > 0, 'A fulfilled return with done false is a retirement failure.');
		const closeError = await caught(store.close());
		assert.ok(closeError instanceof AggregateError, 'Store close cannot claim this producer retired.');
		assert.deepEqual(new Set(leaves(closeError)), new Set(retirement));
		assert.deepEqual(new Set(leaves(await caught(store.close()))), new Set(retirement));
		assert.equal((await readdir(deriveLightscaperNativePhotoOriginalPathsCurrentV1(appDataPath).stagingRoot)).length, 1,
			'Product staging remains intact before the harness retires its own suspended fixture.');
		checked = true;
	} finally {
		if (store) await caught(store.close());
		// This known producer has one finally yield. Join it explicitly after
		// the product-retention assertions; never drain arbitrary user producers.
		let result = finallyEntered ? await producer.next() : await producer.return(undefined);
		if (!result.done) result = await producer.next();
		assert.equal(result.done, true, 'The test-owned producer must retire before private cleanup.');
		if (finallyEntered) assert.equal(finallyCompleted, true);
		if (checked) await rm(appDataPath, { recursive: true, force: true });
	}
});
