/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import { inspectImportedMediaMetadata } from '../src/common/editor/imported-media-metadata.ts';
import { taggedWebmOpusFixture } from './helpers/ordinary-ogg-opus-fixture.ts';

const runNode = promisify(execFile);

for (const target of ['global', 'all-tracks', 'track'] as const) test(`Matroska ${target} metadata keeps its declared target scope`, async () => {
	const inspected = await inspectImportedMediaMetadata(await taggedWebmOpusFixture(target));
	assert.deepEqual(inspected.warnings, []);
	if (target === 'track') {
		assert.equal(inspected.metadata.normalized?.title, undefined);
		assert.equal(inspected.metadata.normalized?.artist, undefined);
	} else {
		assert.equal(inspected.metadata.normalized?.title, 'Authored global title');
		assert.equal(inspected.metadata.normalized?.artist, 'Ada — reviewed credit');
		assert.equal(inspected.metadata.raw?.TITLE, 'Authored global title');
	}
});

test('every shipped Matroska reader retains explicit all-track tags', async () => {
	const file = await taggedWebmOpusFixture('all-tracks');
	for (const bundle of ['mediabunny.cjs', 'mediabunny.node.cjs', 'mediabunny.mjs']) {
		const { stdout } = await runNode(process.execPath, ['--input-type=module', '-e', `
			const module=await import('./node_modules/mediabunny/dist/bundles/'+process.argv[1]);
			const {Input,BlobSource,WEBM}=module.default??module;
			const input=new Input({source:new BlobSource(new Blob([Buffer.from(process.argv[2],'base64')])),formats:[WEBM]});
			try{console.log(JSON.stringify((await input.getMetadataTags()).title));}finally{input.dispose();}
		`, bundle, Buffer.from(await file.arrayBuffer()).toString('base64')], { timeout: 10_000 });
		assert.equal(JSON.parse(stdout) as unknown, 'Authored global title', bundle);
	}
});
