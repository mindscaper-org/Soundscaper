/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeCloudMetadata, nativeCloudHash, tagNativeCloudBlock } from '../src/common/editor/audiocom-native-project.ts';

test('native cloud metadata frames binary XML instead of uploading a SQLite archive', () => {
	const bytes = nativeCloudMetadata(Uint8Array.of(1, 2), Uint8Array.of(3, 4, 5));
	assert.equal(new DataView(bytes.buffer).getBigUint64(0, true), 2n);
	assert.deepEqual([...bytes.subarray(8)], [1, 2, 3, 4, 5]);
});
test('native cloud hashes bind the block id to its exact uncompressed PCM', async () => {
	const pcm = new Uint8Array(new Float32Array([0, 0.5, -0.5]).buffer);
	const digest = Buffer.from(await crypto.subtle.digest('SHA-256', pcm)).toString('hex').toUpperCase();
	assert.equal(await nativeCloudHash(42, pcm), `0000002A${digest.slice(8)}`);
	assert.notEqual(await nativeCloudHash(43, pcm), await nativeCloudHash(42, pcm));
	const tagged = tagNativeCloudBlock(Uint8Array.of(119, 118, 112, 107), 42, digest);
	assert.ok(new TextDecoder().decode(tagged).includes('FORMAT\0' + '262159'));
	assert.ok(new TextDecoder().decode(tagged).includes('BLOCK_ID\0' + '42'));
	assert.ok(new TextDecoder().decode(tagged).includes('HASH\0'));
	assert.equal(new TextDecoder().decode(tagged.subarray(-32, -24)), 'APETAGEX');
});

test('cloud manifests copy binary XML and sample data and reject unsupported sample formats', async () => {
	const { nativeCloudManifest, nativeCloudPcm } = await import('../src/common/editor/audiocom-native-project-database.ts');
	const dictionary = Uint8Array.of(1, 2), document = Uint8Array.of(3), pcm = new Uint8Array(new Float32Array([0.25]).buffer);
	const database = { rows: (sql: string) => sql.includes('dict, doc') ? [[dictionary, document]] : sql.includes('length(samples)') ? [[42, 262159, 4]] : [[pcm]] };
	const manifest = nativeCloudManifest(database);
	assert.deepEqual(manifest.blocks, [{ id: 42, size: 4 }]);
	assert.deepEqual([...manifest.metadata], [2, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3]);
	const extracted = nativeCloudPcm(database, 42); extracted[0] = 255;
	assert.notEqual(extracted[0], pcm[0], 'worker transfers must not detach SQLite-owned data');
	assert.throws(() => nativeCloudManifest({ rows: sql => sql.includes('dict, doc') ? [[dictionary, document]] : [[42, 131073, 4]] }), /Unsupported/u);
	assert.throws(() => nativeCloudPcm(database, -1), /Invalid/u);
});
