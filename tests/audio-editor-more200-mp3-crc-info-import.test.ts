/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { prepareStreamedAudioImport } from '../src/common/editor/browser-streamed-audio-import.ts';
import { inspectMp3GaplessGeometry } from '../src/common/editor/mp3-gapless-import.ts';
import { crcOffsetMp3Fixture } from './helpers/ordinary-cover-mp3-fixture.ts';

for (const layout of ['unprotected', 'lame-crc', 'crc-offset'] as const) test(`MP3 import admits ${layout} information frames without decoding them as audio`, async () => {
	const file = await crcOffsetMp3Fixture(layout);
	const geometry = await inspectMp3GaplessGeometry(file); assert.ok(geometry);
	assert.equal(geometry.sourceFrames, 4800);
	const prepared = await prepareStreamedAudioImport(file);
	try { assert.equal(prepared.descriptor.frameCount, 4800); } finally { prepared.dispose(); }
});

for (const bundle of ['mediabunny.cjs', 'mediabunny.node.cjs', 'mediabunny.mjs']) test(`shipped ${bundle} excludes a CRC-shifted information frame from duration`, async () => {
	const file = await crcOffsetMp3Fixture('crc-offset'); const geometry = await inspectMp3GaplessGeometry(file); assert.ok(geometry);
	const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
		const imported=await import('./node_modules/mediabunny/dist/bundles/'+process.argv[1]);
		const {Input,BlobSource,MP3}=imported.default??imported;
		const input=new Input({source:new BlobSource(new Blob([Buffer.from(process.argv[2],'base64')])),formats:[MP3]});
		try{console.log(await input.computeDuration());}finally{input.dispose();}
	`, bundle, Buffer.from(await file.arrayBuffer()).toString('base64')], { timeout: 10_000 });
	assert.equal(Math.round(Number(stdout) * geometry.sampleRate), geometry.encodedFrames);
});
