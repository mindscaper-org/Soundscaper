/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { AttachedFile, BlobSource, BufferTarget, EncodedAudioPacketSource, EncodedPacketSink, Input, Output, WEBM, WebMOutputFormat } from 'mediabunny';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inspectImportedMediaMetadata } from '../src/common/editor/imported-media-metadata.ts';
import { attachmentCollisionWebmOpusFixture } from './helpers/ordinary-ogg-opus-fixture.ts';

for (const tagsFirst of [false, true]) for (const collision of [false, true]) test(`Matroska preserves numeric custom credit and attachment evidence (collision=${String(collision)}, tagsFirst=${String(tagsFirst)})`, async () => {
	const file = await attachmentCollisionWebmOpusFixture(collision, tagsFirst);
	const bytes = Buffer.from(await file.arrayBuffer());
	for (const value of ['Reviewed archive credit', 'Reviewed licence attachment']) assert.ok(bytes.includes(Buffer.from(value)));
	const inspection = await inspectImportedMediaMetadata(file);
	assert.deepEqual(inspection.warnings, []);
	assert.equal(inspection.metadata.normalized?.title, 'Collision programme');
	assert.equal(inspection.metadata.raw?.[collision ? '123' : '_23'], 'Reviewed archive credit');
	assert.equal(inspection.metadata.raw?.['attachment:123'], 'Existing private escape-name control');
	assert.ok(inspection.attachments.some(attachment => attachment.name === 'licence.txt' && attachment.byteLength === 27));
});

test('remux retains the original FileUID and exact custom tags after attachment-key escaping', async () => {
	const file = await attachmentCollisionWebmOpusFixture();
	const input = new Input({ source: new BlobSource(file), formats: [WEBM] });
	try {
		const metadata = await input.getMetadataTags();
		const attachment = metadata.raw?.['attachment:123[1]']; assert.ok(attachment instanceof AttachedFile);
		assert.equal(metadata.raw?.['123'], 'Reviewed archive credit');
		const track = await input.getPrimaryAudioTrack(); assert.ok(track);
		const decoderConfig = await track.getDecoderConfig(); assert.ok(decoderConfig);
		const target = new BufferTarget(); const output = new Output({ target, format: new WebMOutputFormat() });
		const source = new EncodedAudioPacketSource('opus'); output.addAudioTrack(source); output.setMetadataTags(metadata);
		await output.start();
		for await (const packet of new EncodedPacketSink(track).packets()) await source.add(packet, { decoderConfig });
		await output.finalize(); assert.ok(target.buffer);
		const bytes = Buffer.from(target.buffer); assert.ok(bytes.includes(Buffer.from([0x46, 0xae, 0x81, 123])));
		const inspected = await inspectImportedMediaMetadata(new Blob([target.buffer]));
		assert.equal(inspected.metadata.raw?.['123'], 'Reviewed archive credit');
		assert.equal(inspected.metadata.raw?.['attachment:123'], 'Existing private escape-name control');
		assert.ok(inspected.attachments.some(value => value.name === 'licence.txt' && value.byteLength === 27));
	} finally { input.dispose(); }
});

for (const bundle of ['mediabunny.cjs', 'mediabunny.node.cjs', 'mediabunny.mjs']) test(`shipped ${bundle} preserves both Matroska namespaces`, async () => {
	const file = await attachmentCollisionWebmOpusFixture();
	const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
		const imported=await import('./node_modules/mediabunny/dist/bundles/'+process.argv[1]);
		const {Input,BlobSource,WEBM,AttachedFile}=imported.default??imported;
		const input=new Input({source:new BlobSource(new Blob([Buffer.from(process.argv[2],'base64')])),formats:[WEBM]});
		try{const raw=(await input.getMetadataTags()).raw; console.log(JSON.stringify({credit:raw['123'],escape:raw['attachment:123'],attachment:raw['attachment:123[1]'] instanceof AttachedFile}));}finally{input.dispose();}
	`, bundle, Buffer.from(await file.arrayBuffer()).toString('base64')], { timeout: 10_000 });
	assert.deepEqual(JSON.parse(stdout), { credit: 'Reviewed archive credit', escape: 'Existing private escape-name control', attachment: true });
});
