/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { MediaAssetDisposalRepository } from '../src/common/editor/storage/media-asset-disposal-repository.ts';
import { MediaAssetChunkRecords } from '../src/common/editor/storage/media-asset-chunk-records.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';

test('media disposal stops at a protecting path without materializing unrelated records', async () => {
	const memory = getMemoryDatabase('runtime50-media-disposal');
	const map = memory.sources;
	map.clear(); map.set('first', { path: 'protected' });
	for (let index = 1; index < 10_000; index++) map.set(String(index), { path: `other-${index}` });
	let visits = 0;
	const original = map.values.bind(map);
	map.values = function* (): Generator<unknown, undefined, unknown> { for (const entry of original()) { visits++; yield entry; } return undefined; };
	try {
		const port = { memory, async database() { return null; } };
		const repository = new MediaAssetDisposalRepository(port, new MediaAssetChunkRecords(port), () => new Set(), async () => false);
		assert.equal(await repository.prepare({ storage: 'opfs', path: 'protected' }), null);
		assert.equal(visits, 1, 'a first protecting source must not enumerate the rest of the catalog');
		const orphan = { storage: 'opfs', path: 'orphan' };
		assert.strictEqual(await repository.prepare(orphan), orphan);
		memory.videoDerivatives.set('derivative', { path: 'video' });
		assert.equal(await repository.prepare({ storage: 'opfs', path: 'video' }), null);
	} finally { delete (map as Partial<Map<string, unknown>>).values; map.clear(); memory.videoDerivatives.clear(); }
});
