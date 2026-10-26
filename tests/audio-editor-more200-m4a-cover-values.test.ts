/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import { BlobSource, EncodedPacketSink, Input, MP4 } from 'mediabunny';
import { inspectImportedMediaMetadata } from '../src/common/editor/imported-media-metadata.ts';
import { multiValueM4aArtworkFixture } from './helpers/ordinary-tail-m4a-fixture.ts';

for (const grouped of [false, true]) test(`M4A import retains all cover values; grouped=${grouped}`, async () => {
	const { file, images } = await multiValueM4aArtworkFixture(grouped);
	const inspected = await inspectImportedMediaMetadata(file);
	assert.deepEqual(inspected.warnings, []);
	assert.equal(inspected.metadata.normalized?.title, 'Two retained covers');
	assert.equal(inspected.metadata.normalized?.comment, 'After covers');
	const covers = inspected.attachments.filter(attachment => /^images\[\d+\]$/u.test(attachment.path));
	assert.deepEqual(covers.map(cover => cover.sha256), images.map(image => createHash('sha256').update(image).digest('hex')));
	assert.deepEqual(covers.map(cover => cover.mimeType), ['image/png', 'image/png']);
	for (const bundle of ['mediabunny.cjs', 'mediabunny.node.cjs', 'mediabunny.mjs']) {
		const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
			const module=await import('./node_modules/mediabunny/dist/bundles/'+process.argv[1]);
			const {Input,BlobSource,MP4}=module.default??module;
			const input=new Input({source:new BlobSource(new Blob([Buffer.from(process.argv[2],'base64')])),formats:[MP4]});
			try{console.log(JSON.stringify((await input.getMetadataTags()).images.map(image=>Buffer.from(image.data).toString('base64'))));}finally{input.dispose();}
		`, bundle, Buffer.from(await file.arrayBuffer()).toString('base64')], { timeout: 10_000 });
		assert.deepEqual(JSON.parse(stdout) as unknown, images.map(image => Buffer.from(image).toString('base64')), bundle);
	}
	const input = new Input({ source: new BlobSource(file), formats: [MP4] });
	try {
		const track = await input.getPrimaryAudioTrack(); assert.ok(track);
		let packets = 0;
		for await (const packet of new EncodedPacketSink(track).packets()) { assert.ok(packet.data.length); packets++; }
		assert.equal(packets, 4);
	} finally { input.dispose(); }
});
