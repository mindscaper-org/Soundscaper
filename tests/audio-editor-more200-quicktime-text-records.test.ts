/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inspectImportedMediaMetadata } from '../src/common/editor/imported-media-metadata.ts';
import { quickTimeTextM4aFixture } from './helpers/ordinary-tail-m4a-fixture.ts';

for (const encoding of ['macintosh', 'utf16', 'utf8', 'ffmpeg', 'ffmpeg-unlabelled'] as const) for (const multiple of [false, true]) {
	test(`QuickTime international text retains its declared ${encoding} encoding and record boundary; multiple=${multiple}`, async () => {
		const inspected = await inspectImportedMediaMetadata(await quickTimeTextM4aFixture(encoding, multiple));
		assert.deepEqual(inspected.warnings, []);
		assert.equal(inspected.metadata.normalized?.title, 'Café');
		assert.equal(inspected.metadata.normalized?.comment, 'After title');
		assert.deepEqual(inspected.metadata.raw?.['©nam'], multiple ? { '0.language': encoding === 'macintosh' ? '1' : encoding === 'ffmpeg-unlabelled' ? '0' : '5575', '0.text': 'Café', '1.language': '5575', '1.text': 'Second title' } : 'Café');
	});
}

for (const bundle of ['mediabunny.cjs', 'mediabunny.node.cjs', 'mediabunny.mjs']) test(`shipped ${bundle} retains QuickTime localized records`, async () => {
	const file = await quickTimeTextM4aFixture('macintosh');
	const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
		const imported=await import('./node_modules/mediabunny/dist/bundles/'+process.argv[1]);
		const {Input,BlobSource,MP4}=imported.default??imported;
		const input=new Input({source:new BlobSource(new Blob([Buffer.from(process.argv[2],'base64')])),formats:[MP4]});
		try{console.log(JSON.stringify(await input.getMetadataTags()));}finally{input.dispose();}
	`, bundle, Buffer.from(await file.arrayBuffer()).toString('base64')], { timeout: 10_000 });
	const tags: unknown = JSON.parse(stdout);
	assert.ok(tags && typeof tags === 'object' && 'title' in tags && 'raw' in tags);
	assert.equal(tags.title, 'Café');
	assert.ok(tags.raw && typeof tags.raw === 'object' && '©nam' in tags.raw);
	assert.deepEqual(tags.raw['©nam'], { '0.language': '1', '0.text': 'Café', '1.language': '5575', '1.text': 'Second title' });
});
