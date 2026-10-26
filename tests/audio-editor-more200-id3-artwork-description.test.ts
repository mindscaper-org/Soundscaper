/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { encodeWav } from '../src/common/editor/wav.js';
import { parseId3Artwork } from '../src/common/editor/id3-artwork.ts';
import { inspectImportedMediaMetadata } from '../src/common/editor/imported-media-metadata.ts';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6hxoAAAAASUVORK5CYII=';
const descriptions = ['Reviewed cover', 'Reviewed cover '];

function artworkFile(): File {
	const id3Artwork = JSON.stringify(descriptions.map((description, index) => ({
		mimeType: 'image/png', pictureType: index ? 4 : 3, description, data: png,
	})));
	assert.deepEqual(parseId3Artwork(id3Artwork).map(image => image.description), descriptions);
	const bytes = Uint8Array.from(encodeWav([new Float32Array(4800).fill(.25)], {
		sampleRate: 48_000, bitDepth: 32, float: true, metadata: { id3Artwork },
	}));
	return new File([bytes], 'Reviewed art.wav', { type: 'audio/wav' });
}

test('File Import preserves distinct artwork descriptions including a trailing space', async () => {
	const file = artworkFile();
	const bytes = Buffer.from(await file.arrayBuffer());
	assert.ok(bytes.includes(Buffer.from('Reviewed cover \0')));
	const inspected = await inspectImportedMediaMetadata(file);
	assert.deepEqual(inspected.warnings, []);
	const images = inspected.attachments.filter(image => image.mimeType === 'image/png');
	assert.deepEqual(images.map(image => image.description), descriptions);
	assert.equal(images[0]?.sha256, images[1]?.sha256);
});

test('every shipped reader preserves terminated APIC description text verbatim', async () => {
	const runNode = promisify(execFile);
	const bytes = Buffer.from(await artworkFile().arrayBuffer()).toString('base64');
	for (const bundle of ['mediabunny.cjs', 'mediabunny.node.cjs', 'mediabunny.mjs']) {
		const { stdout } = await runNode(process.execPath, ['--input-type=module', '-e', `
			const module=await import('./node_modules/mediabunny/dist/bundles/'+process.argv[1]);
			const {Input,BlobSource,WAVE}=module.default??module;
			const input=new Input({source:new BlobSource(new Blob([Buffer.from(process.argv[2],'base64')])),formats:[WAVE]});
			try{console.log(JSON.stringify((await input.getMetadataTags()).images.map(image=>image.description)));}finally{input.dispose();}
		`, bundle, bytes], { timeout: 10_000 });
		assert.deepEqual(JSON.parse(stdout) as unknown, descriptions, bundle);
	}
});
