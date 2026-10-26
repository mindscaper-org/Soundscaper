/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BlobSource, EncodedPacketSink, Input, MP4 } from 'mediabunny';
import { inspectImportedMediaMetadata } from '../src/common/editor/imported-media-metadata.ts';
import { LOCALIZED_M4A_ARTIST, localizedM4aMetadataFixture } from './helpers/localized-m4a-metadata-fixture.ts';

for (const style of ['mdta', 'ilst'] as const) for (const multiple of [false, true]) test(`MP4 ${style} import retains localized text data values; multiple=${String(multiple)}`, async () => {
	const file = await localizedM4aMetadataFixture(multiple, style);
	const inspected = await inspectImportedMediaMetadata(file);
	assert.deepEqual(inspected.warnings, []);
	assert.equal(inspected.metadata.normalized?.artist, 'Original performer');
	assert.equal(inspected.metadata.normalized?.title, style === 'mdta' ? 'Localized credit control' : 'Two retained covers');
	if (style === 'mdta') assert.equal(inspected.metadata.raw?.engineer, 'Unrelated engineer');
	else assert.equal(inspected.metadata.normalized?.comment, 'After covers');
	assert.deepEqual(inspected.metadata.raw?.[style === 'mdta' ? 'artist' : '©ART'], multiple ? LOCALIZED_M4A_ARTIST : 'Original performer');
});

test('localized metadata leaves the authenticated AAC packet stream unchanged', async () => {
	const hashes: string[] = [];
	for (const multiple of [false, true]) {
		const input = new Input({ source: new BlobSource(await localizedM4aMetadataFixture(multiple)), formats: [MP4] });
		try {
			const track = await input.getPrimaryAudioTrack(); assert.ok(track);
			const hash = createHash('sha256');
			for await (const packet of new EncodedPacketSink(track).packets()) hash.update(packet.data);
			hashes.push(hash.digest('hex'));
		} finally { input.dispose(); }
	}
	assert.equal(hashes[0], hashes[1]);
});

for (const bundle of ['mediabunny.cjs', 'mediabunny.node.cjs', 'mediabunny.mjs']) test(`shipped ${bundle} retains localized MP4 values`, async () => {
	const file = await localizedM4aMetadataFixture();
	const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
		const module=await import('./node_modules/mediabunny/dist/bundles/'+process.argv[1]);
		const {Input,BlobSource,MP4}=module.default??module;
		const input=new Input({source:new BlobSource(new Blob([Buffer.from(process.argv[2],'base64')])),formats:[MP4]});
		try{console.log(JSON.stringify((await input.getMetadataTags()).raw.artist));}finally{input.dispose();}
	`, bundle, Buffer.from(await file.arrayBuffer()).toString('base64')], { timeout: 10_000 });
	assert.deepEqual(JSON.parse(stdout) as unknown, LOCALIZED_M4A_ARTIST);
});
