/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeWriterFixtureCurrentV1 as fixture, beginNativeWriterCurrentV1 as begin,
	nativeWriterInputCurrentV1 as input } from './helpers/lightscaper-native-media-writer-integration-fixture-current.ts';

test('Lightscaper genuine native media owner exposes the exact five-member streamed writer after actual SQLite and body publication', async () => {
	await fixture(async f => {
		await f.media.writeAsset('entrypoint-seed', new Blob([Uint8Array.of(1, 2, 3)]), { name: 'Actual body seed' });
		assert.equal((await f.media.getAssetMetadata('entrypoint-seed'))?.size, 3);
		const value = input(601, 4096), writer = await begin(f.media, value.original.storageKey, value.metadata, value.options);
		try {
			assert.equal(Object.hasOwn(f.media, 'beginAssetWrite'), true);
			assert.deepEqual(Reflect.ownKeys(writer).sort(), ['abort', 'bytesWritten', 'commit', 'maximumChunkBytes', 'write']);
			assert.equal(writer.maximumChunkBytes, 4 * 1024 * 1024); assert.equal(writer.bytesWritten, 0);
			assert.equal(typeof writer.write, 'function'); assert.equal(typeof writer.commit, 'function'); assert.equal(typeof writer.abort, 'function');
			assert.equal('commitOwned' in writer, false); assert.equal('commitVideoProxyClaim' in writer, false);
		} finally { await writer.abort(); }
		assert.equal(await f.media.getAssetMetadata(value.original.storageKey), null);
	});
});
