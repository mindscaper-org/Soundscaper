/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BlobSource, Input, WEBM } from 'mediabunny';
import { inspectImportedMediaMetadata } from '../src/common/editor/imported-media-metadata.ts';
import { customTaggedWebmOpusFixture, repeatedTaggedWebmOpusFixture } from './helpers/ordinary-ogg-opus-fixture.ts';

for (const repeated of [true, false]) test(`separate Matroska performer records retain their ordered values; repeated=${repeated}`, async () => {
	const inspection = await inspectImportedMediaMetadata(await repeatedTaggedWebmOpusFixture(repeated));
	assert.deepEqual(inspection.warnings, []);
	assert.equal(inspection.metadata.normalized?.artist, repeated ? 'Ada; Grace; Ada' : 'Ada');
	assert.deepEqual(inspection.metadata.raw?.ARTIST, repeated ? { 0: 'Ada', 1: 'Grace', 2: 'Ada' } : 'Ada');
	assert.equal(inspection.metadata.normalized?.trackNumber, 2);
	assert.equal(inspection.metadata.normalized?.tracksTotal, 12);
	assert.equal(inspection.metadata.normalized?.comment, 'After credits');
});

test('an opaque first binary tag retains its existing raw representation when a text variant follows', async () => {
	const original = await customTaggedWebmOpusFixture({ ARTIST: new Uint8Array(), _GUEST: 'Ada' });
	const bytes = Buffer.from(await original.arrayBuffer()); const offset = bytes.indexOf(Buffer.from('_GUEST')); assert.ok(offset > 0);
	bytes.set(Buffer.from('ARTIST'), offset);
	const input = new Input({ source: new BlobSource(new Blob([bytes])), formats: [WEBM] });
	try {
		const tags = await input.getMetadataTags();
		assert.deepEqual(tags.raw?.ARTIST, new Uint8Array());
		assert.equal(tags.artist, 'Ada');
	} finally { input.dispose(); }
});

for (const bundle of ['mediabunny.cjs', 'mediabunny.node.cjs', 'mediabunny.mjs']) test(`shipped ${bundle} retains separate repeated Matroska tags`, async () => {
	const file = await repeatedTaggedWebmOpusFixture();
	const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
		const imported=await import('./node_modules/mediabunny/dist/bundles/'+process.argv[1]);
		const {Input,BlobSource,WEBM}=imported.default??imported;
		const input=new Input({source:new BlobSource(new Blob([Buffer.from(process.argv[2],'base64')])),formats:[WEBM]});
		try{console.log(JSON.stringify(await input.getMetadataTags()));}finally{input.dispose();}
	`, bundle, Buffer.from(await file.arrayBuffer()).toString('base64')], { timeout: 10_000 });
	const tags: unknown = JSON.parse(stdout); assert.ok(tags && typeof tags === 'object' && 'artist' in tags && 'raw' in tags);
	assert.equal(tags.artist, 'Ada; Grace; Ada');
	assert.ok(tags.raw && typeof tags.raw === 'object' && 'ARTIST' in tags.raw);
	assert.deepEqual(tags.raw.ARTIST, { 0: 'Ada', 1: 'Grace', 2: 'Ada' });
});
