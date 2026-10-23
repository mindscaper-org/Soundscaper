/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import { inspectImportedMediaMetadata } from '../src/common/editor/imported-media-metadata.ts';
import { iTunesGenreM4aFixture } from './helpers/ordinary-tail-m4a-fixture.ts';

for (const [genre, expected] of [[18, 'Rock'], [5, 'Disco'], ['Ambient', 'Ambient'], [0, undefined]] as const) {
	test(`M4A import projects the authored iTunes genre ${genre}`, async () => {
		const file = await iTunesGenreM4aFixture(genre);
		const inspected = await inspectImportedMediaMetadata(file);
		assert.deepEqual(inspected.warnings, []);
		assert.equal(inspected.metadata.normalized?.genre, expected);
		assert.equal(inspected.metadata.normalized?.title, 'Two retained covers');
		assert.equal(inspected.metadata.normalized?.comment, 'After covers');
		assert.equal(inspected.attachments.filter(attachment => /^images\[\d+\]$/u.test(attachment.path)).length, 2);
		for (const bundle of ['mediabunny.cjs', 'mediabunny.node.cjs', 'mediabunny.mjs']) {
			const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
				const module=await import('./node_modules/mediabunny/dist/bundles/'+process.argv[1]);
				const {Input,BlobSource,MP4}=module.default??module;
				const input=new Input({source:new BlobSource(new Blob([Buffer.from(process.argv[2],'base64')])),formats:[MP4]});
				try{console.log(JSON.stringify({genre:(await input.getMetadataTags()).genre}));}finally{input.dispose();}
			`, bundle, Buffer.from(await file.arrayBuffer()).toString('base64')], { timeout: 10_000 });
			assert.deepEqual(JSON.parse(stdout) as unknown, expected === undefined ? {} : { genre: expected }, bundle);
		}

	});
}

test('a written genre string refines the coarser iTunes numeric category', async () => {
	const inspected = await inspectImportedMediaMetadata(await iTunesGenreM4aFixture(18, 'Alternative rock'));
	assert.deepEqual(inspected.warnings, []);
	assert.equal(inspected.metadata.normalized?.genre, 'Alternative rock');
});
