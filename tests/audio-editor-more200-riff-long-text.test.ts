/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import { inspectImportedMediaMetadata } from '../src/common/editor/imported-media-metadata.ts';
import { riffInfoLengthFixture } from './helpers/riff-info-length-fixtures.ts';

for (const long of [false, true]) test(`external WAV INFO retains small credits beside a long comment (${String(long)})`, async () => {
	const bytes = riffInfoLengthFixture(long);
	const inspected = await inspectImportedMediaMetadata(new Blob([bytes]));
	assert.equal(inspected.metadata.normalized?.artist, 'Small independent credit');
	assert.equal(inspected.metadata.normalized?.title, 'Harbour voices');
	assert.equal(inspected.metadata.raw?.IART, 'Small independent credit');
	assert.equal(inspected.metadata.normalized?.comment, 'x'.repeat(long ? 65_536 : 100));
	if (long) assert.ok(inspected.warnings.some(warning => warning.includes('truncated')));
	else assert.deepEqual(inspected.warnings, []);
	assert.equal(createHash('sha256').update(bytes).digest('hex'), long
		? '658e00b8c6544ed70bf3924b445573fd78f70fcc27889d0993b1520953bb7e18'
		: '17e5080a90ca99b66dd5c8acf12c8fa04096195405bf10ae9fa6b1fd9c7db214');
});

for (const bundle of ['mediabunny.cjs', 'mediabunny.node.cjs', 'mediabunny.mjs']) test(`shipped ${bundle} reads long RIFF fields without an argument-count overflow`, async () => {
	const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
		import {readFileSync} from 'node:fs'; import {gunzipSync} from 'node:zlib';
		const imported=await import('./node_modules/mediabunny/dist/bundles/'+process.argv[1]);
		const {Input,BlobSource,WAVE}=imported.default??imported;
		const bytes=gunzipSync(Buffer.from(readFileSync('tests/fixtures/ffmpeg-long-info.wav.gz.base64','utf8').trim(),'base64'));
		const input=new Input({source:new BlobSource(new Blob([bytes])),formats:[WAVE]});
		try{const tags=await input.getMetadataTags();console.log(JSON.stringify({artist:tags.artist,commentLength:tags.comment.length}));}finally{input.dispose();}
	`, bundle], { timeout: 10_000 });
	assert.deepEqual(JSON.parse(stdout) as unknown, { artist: 'Small independent credit', commentLength: 200_000 });
});
