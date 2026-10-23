/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inspectImportedMediaMetadata } from '../src/common/editor/imported-media-metadata.ts';
import { metadataKeyOrderM4aFixture } from './helpers/ordinary-tail-m4a-fixture.ts';

for (const keysFirst of [true, false]) test(`MP4 metadata resolves its key table ${keysFirst ? 'before' : 'after'} the item list`, async () => {
	const file = await metadataKeyOrderM4aFixture(keysFirst);
	const result = await inspectImportedMediaMetadata(file);
	assert.deepEqual(result.warnings, []);
	assert.ok(result.metadata.normalized); assert.ok(result.metadata.raw);
	assert.equal(result.metadata.normalized.title, 'Keyed programme title');
	assert.equal(result.metadata.normalized.artist, 'Keyed performer');
	assert.equal(result.metadata.raw.engineer, 'Retained engineering credit');
});

for (const bundle of ['mediabunny.cjs', 'mediabunny.node.cjs', 'mediabunny.mjs']) test(`shipped ${bundle} resolves later MP4 keys`, async () => {
	const file = await metadataKeyOrderM4aFixture();
	const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
		const imported=await import('./node_modules/mediabunny/dist/bundles/'+process.argv[1]);
		const {Input,BlobSource,MP4}=imported.default??imported;
		const input=new Input({source:new BlobSource(new Blob([Buffer.from(process.argv[2],'base64')])),formats:[MP4]});
		try{const tags=await input.getMetadataTags();console.log(JSON.stringify([tags.title,tags.artist,tags.raw.engineer]));}finally{input.dispose();}
	`, bundle, Buffer.from(await file.arrayBuffer()).toString('base64')], { timeout: 10_000 });
	assert.deepEqual(JSON.parse(stdout), ['Keyed programme title', 'Keyed performer', 'Retained engineering credit']);
});
