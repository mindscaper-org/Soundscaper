/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BlobSource, Input, MP3 } from 'mediabunny';
import { inspectImportedMediaMetadata } from '../src/common/editor/imported-media-metadata.ts';
import { footerTaggedMp3Fixture } from './helpers/ordinary-cover-mp3-fixture.ts';

for (const legacy of [false, true]) test(`File Import retains a standard appended ID3v2.4 tag (legacy=${legacy})`, async () => {
	const inspection = await inspectImportedMediaMetadata(await footerTaggedMp3Fixture(legacy));
	assert.deepEqual(inspection.warnings, []);
	assert.equal(inspection.metadata.normalized?.title, 'Footer title');
	assert.equal(inspection.metadata.normalized?.artist, 'Footer performer');
	assert.equal(inspection.metadata.raw?.TIT2, 'Footer title');
});

for (const update of [false, true]) test(`a footer tag applies the standard update policy (update=${update})`, async () => {
	const inspection = await inspectImportedMediaMetadata(await footerTaggedMp3Fixture(false, true, update));
	assert.equal(inspection.metadata.normalized?.title, 'Footer title');
	assert.equal(inspection.metadata.normalized?.album, update ? 'Earlier album' : undefined);
});

test('a mismatched footer cannot hide an ordinary leading tag', async () => {
	const file = await footerTaggedMp3Fixture(false, true);
	const bytes = new Uint8Array(await file.arrayBuffer()); bytes[bytes.length - 1] = bytes.at(-1)! ^ 1;
	const inspection = await inspectImportedMediaMetadata(new File([bytes], file.name, { type: file.type }));
	assert.deepEqual(inspection.warnings, []);
	assert.equal(inspection.metadata.normalized?.title, 'Earlier title');
});

test('every shipped MP3 reader discovers the same appended tag', async () => {
	const runNode = promisify(execFile);
	const bytes = Buffer.from(await (await footerTaggedMp3Fixture(true)).arrayBuffer()).toString('base64');
	for (const bundle of ['mediabunny.cjs', 'mediabunny.node.cjs', 'mediabunny.mjs']) {
		const { stdout } = await runNode(process.execPath, ['--input-type=module', '-e', `
			const module=await import('./node_modules/mediabunny/dist/bundles/'+process.argv[1]);
			const {Input,BlobSource,MP3}=module.default??module;
			const input=new Input({source:new BlobSource(new Blob([Buffer.from(process.argv[2],'base64')])),formats:[MP3]});
			try{console.log(JSON.stringify((await input.getMetadataTags()).title));}finally{input.dispose();}
		`, bundle, bytes], { timeout: 10_000 });
		assert.equal(JSON.parse(stdout) as unknown, 'Footer title', bundle);
	}
});

test('an update footer replaces matching artwork and retains differently described earlier pictures', async () => {
	const input = new Input({ source: new BlobSource(await footerTaggedMp3Fixture(false, true, true, true)), formats: [MP3] });
	try {
		const images = (await input.getMetadataTags()).images;
		assert.deepEqual(images?.map(image => image.description), ['Reviewed cover', 'Back retained']);
		assert.equal(Buffer.from(images![0]!.data).toString('base64'), 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMQkTsBAAFEAPtKtXAbAAAAAElFTkSuQmCC');
	} finally { input.dispose(); }
});
