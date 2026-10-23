/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inspectImportedMediaMetadata } from '../src/common/editor/imported-media-metadata.ts';
import { quickTimeMetadataPrecedenceFixture } from './helpers/ordinary-tail-m4a-fixture.ts';

for (const legacyFirst of [true, false]) test(`QuickTime modern metadata has priority with legacy first=${legacyFirst}`, async () => {
	const inspected = await inspectImportedMediaMetadata(await quickTimeMetadataPrecedenceFixture(legacyFirst));
	assert.deepEqual(inspected.warnings, []);
	assert.equal(inspected.metadata.normalized?.title, 'Two retained covers');
	assert.equal(inspected.metadata.normalized?.album, 'Legacy album fallback');
	assert.equal(inspected.metadata.normalized?.comment, 'After covers');
	assert.equal(inspected.metadata.raw?.['©nam'], 'Two retained covers');
	assert.equal(inspected.attachments.filter(attachment => /^images\[/u.test(attachment.path)).length, 2);
});

for (const bundle of ['mediabunny.cjs', 'mediabunny.node.cjs', 'mediabunny.mjs']) test(`shipped ${bundle} prefers modern metadata`, async () => {
	const file = await quickTimeMetadataPrecedenceFixture(true);
	const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
		const imported=await import('./node_modules/mediabunny/dist/bundles/'+process.argv[1]);
		const {Input,BlobSource,MP4}=imported.default??imported;
		const input=new Input({source:new BlobSource(new Blob([Buffer.from(process.argv[2],'base64')])),formats:[MP4]});
		try{console.log(JSON.stringify(await input.getMetadataTags()));}finally{input.dispose();}
	`, bundle, Buffer.from(await file.arrayBuffer()).toString('base64')], { timeout: 10_000 });
	const tags: unknown = JSON.parse(stdout);
	assert.ok(tags && typeof tags === 'object' && 'title' in tags && 'album' in tags);
	assert.equal(tags.title, 'Two retained covers');
	assert.equal(tags.album, 'Legacy album fallback');
});
