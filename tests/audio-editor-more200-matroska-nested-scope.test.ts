/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inspectImportedMediaMetadata } from '../src/common/editor/imported-media-metadata.ts';
import { originalWorkTaggedWebmOpusFixture } from './helpers/ordinary-ogg-opus-fixture.ts';

for (const originalFirst of [false, true]) test(`nested ORIGINAL artist does not become this recording's performer; originalFirst=${originalFirst}`, async () => {
	const inspection = await inspectImportedMediaMetadata(await originalWorkTaggedWebmOpusFixture(originalFirst));
	assert.deepEqual(inspection.warnings, []);
	assert.equal(inspection.metadata.normalized?.artist, 'Current performer');
	assert.equal(inspection.metadata.normalized?.title, 'Current title');
	// Preserve the existing raw text projection while keeping normalized subject ownership correct.
	assert.deepEqual(inspection.metadata.raw?.ARTIST, originalFirst
		? { 0: 'Original performer', 1: 'Current performer' } : { 0: 'Current performer', 1: 'Original performer' });
});

for (const bundle of ['mediabunny.cjs', 'mediabunny.node.cjs', 'mediabunny.mjs']) test(`shipped ${bundle} normalizes only programme-level tags`, async () => {
	const file = await originalWorkTaggedWebmOpusFixture();
	const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
		const imported=await import('./node_modules/mediabunny/dist/bundles/'+process.argv[1]);
		const {Input,BlobSource,WEBM}=imported.default??imported;
		const input=new Input({source:new BlobSource(new Blob([Buffer.from(process.argv[2],'base64')])),formats:[WEBM]});
		try{console.log(JSON.stringify((await input.getMetadataTags()).artist));}finally{input.dispose();}
	`, bundle, Buffer.from(await file.arrayBuffer()).toString('base64')], { timeout: 10_000 });
	assert.equal(JSON.parse(stdout) as unknown, 'Current performer');
});
