/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BlobSource, Input, MP3 } from 'mediabunny';
import { prepareStreamedAudioImport } from '../src/common/editor/browser-streamed-audio-import.ts';
import { apePreviewMp3Fixture, crcOffsetMp3Fixture } from './helpers/ordinary-cover-mp3-fixture.ts';

async function duration(file: Blob): Promise<number> {
	const input = new Input({ source: new BlobSource(file), formats: [MP3] });
	try { return await input.computeDuration(); } finally { input.dispose(); }
}

for (const header of [false, true]) for (const legacy of [false, true]) test(`MP3 binary APE preview stays outside programme packets (header=${String(header)}, ID3v1=${String(legacy)})`, async () => {
	const file = await apePreviewMp3Fixture(header, legacy);
	assert.equal(Math.round(await duration(file) * 48_000), 6912);
	const prepared = await prepareStreamedAudioImport(file);
	try { assert.equal(prepared.descriptor.frameCount, 4800); } finally { prepared.dispose(); }
});

test('ordinary MP3 and text-only APE tags keep exactly their existing packet extent', async () => {
	assert.equal(await duration(await crcOffsetMp3Fixture('unprotected')), await duration(await apePreviewMp3Fixture(true, false, false)));
});

for (const field of [8, 12, 20, 24]) test(`a mismatching APE header field ${String(field)} cannot conceal subsequent MPEG packets`, async () => {
	const original = await crcOffsetMp3Fixture('unprotected'); const file = await apePreviewMp3Fixture();
	const bytes = new Uint8Array(await file.arrayBuffer()); bytes[original.size + field] = bytes[original.size + field]! ^ 1;
	assert.equal(Math.round(await duration(new Blob([bytes])) * 48_000), 13824);
});

test('a footer-looking sequence inside a complete audio frame cannot truncate that frame', async () => {
	const file = await crcOffsetMp3Fixture('unprotected'); const bytes = new Uint8Array(await file.arrayBuffer());
	const footer = bytes.subarray(bytes.length - 32); footer.fill(0); footer.set(new TextEncoder().encode('APETAGEX'));
	const view = new DataView(footer.buffer, footer.byteOffset, footer.byteLength); view.setUint32(8, 2000, true); view.setUint32(12, 32, true);
	assert.equal(Math.round(await duration(new Blob([bytes])) * 48_000), 6912);
});

for (const bundle of ['mediabunny.cjs', 'mediabunny.node.cjs', 'mediabunny.mjs']) test(`shipped ${bundle} excludes APE binary previews`, async () => {
	const file = await apePreviewMp3Fixture();
	const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
		const imported=await import('./node_modules/mediabunny/dist/bundles/'+process.argv[1]);
		const {Input,BlobSource,MP3}=imported.default??imported;
		const input=new Input({source:new BlobSource(new Blob([Buffer.from(process.argv[2],'base64')])),formats:[MP3]});
		try{console.log(await input.computeDuration());}finally{input.dispose();}
	`, bundle, Buffer.from(await file.arrayBuffer()).toString('base64')], { timeout: 10_000 });
	assert.equal(Math.round(Number(stdout) * 48_000), 6912);
});
