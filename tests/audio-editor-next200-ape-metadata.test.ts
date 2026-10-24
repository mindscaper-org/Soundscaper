/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readImportedMetadataTags } from '../src/common/editor/imported-metadata-reader.ts';
import { readApeMetadataTags } from '../src/common/editor/ape-metadata-reader.ts';
import { nativeApeMetadataFixture, APE_METADATA_CREDITS } from './helpers/native-ape-metadata-fixture.ts';

test('native Monkey audio import retains SDK-authored APEv2 credits', async () => {
	const file = nativeApeMetadataFixture();
	const reference = await readApeMetadataTags(file);
	for (const [key, value] of Object.entries(APE_METADATA_CREDITS)) assert.equal(reference[key], value);
	assert.deepEqual(await readImportedMetadataTags(file), reference);
});

test('Monkey audio without an APEv2 trailer has no invented metadata', async () => {
	const file = nativeApeMetadataFixture().slice(0, 4996);
	assert.deepEqual(await readImportedMetadataTags(file), {});
});

test('an already aborted Monkey metadata read performs no file I/O', async () => {
	const abort = new AbortController(); abort.abort();
	const file = new Blob(); file.slice = () => { throw new Error('retired read'); };
	await assert.rejects(readImportedMetadataTags(file, abort.signal), { name: 'AbortError' });
});

test('Monkey metadata retains the existing APEv2 inspection budget', async () => {
	const bytes = new Uint8Array(await nativeApeMetadataFixture().arrayBuffer());
	new DataView(bytes.buffer).setUint32(bytes.length - 20, 16 * 1024 ** 2 + 32, true);
	await assert.rejects(readImportedMetadataTags(new Blob([bytes])), /bounded inspection limit/u);
});
