/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import { inspectImportedMediaMetadata } from '../src/common/editor/imported-media-metadata.ts';
import { repeatedVorbisCommentsFixture } from './helpers/repeated-vorbis-comments-fixture.ts';

for (const format of ['flac', 'ogg-vorbis', 'opus'] as const) {
	test(`File Import preserves separate repeated ${format} comment credits in their authored order`, async () => {
		const file = await repeatedVorbisCommentsFixture(format);
		const inspection = await inspectImportedMediaMetadata(file);
		assert.deepEqual(inspection.warnings, []);
		assert.equal(inspection.metadata.normalized?.artist, 'Ada; Grace; Ada');
		assert.deepEqual(inspection.metadata.raw?.ARTIST, { 0: 'Ada', 1: 'Grace', 2: 'Ada' });
		assert.deepEqual(inspection.metadata.raw?.PERFORMER, { 0: 'First chair', 1: 'Second chair' });
		assert.equal(inspection.metadata.normalized?.trackNumber, 2);
		assert.equal(inspection.metadata.normalized?.comment, 'After credits');
		const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
		try { assert.equal((await input.getPrimaryAudioTrack())?.sampleRate, 48_000); }
		finally { input.dispose(); }
	});
	test(`a single ${format} credit retains its existing scalar representation`, async () => {
		const inspection = await inspectImportedMediaMetadata(await repeatedVorbisCommentsFixture(format, false));
		assert.equal(inspection.metadata.normalized?.artist, 'Ada');
		assert.equal(inspection.metadata.raw?.ARTIST, 'Ada');
	});
}

test('each distributed reader retains the repeated comment values', async () => {
	const runNode = promisify(execFile);
	const bytes = Buffer.from(await (await repeatedVorbisCommentsFixture('flac')).arrayBuffer()).toString('base64');
	for (const bundle of ['mediabunny.cjs', 'mediabunny.node.cjs', 'mediabunny.mjs']) {
		const { stdout } = await runNode(process.execPath, ['--input-type=module', '-e', `
			const module=await import('./node_modules/mediabunny/dist/bundles/'+process.argv[1]);
			const {Input,BlobSource,FLAC}=module.default??module;
			const input=new Input({source:new BlobSource(new Blob([Buffer.from(process.argv[2],'base64')])),formats:[FLAC]});
			try{console.log(JSON.stringify((await input.getMetadataTags()).artist));}finally{input.dispose();}
		`, bundle, bytes], { timeout: 10_000 });
		assert.equal(JSON.parse(stdout) as unknown, 'Ada; Grace; Ada', bundle);
	}
});
