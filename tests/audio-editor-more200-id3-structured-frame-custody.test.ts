/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inspectImportedMediaMetadata } from '../src/common/editor/imported-media-metadata.ts';
import { multilingualMp3Fixture } from './helpers/ordinary-cover-mp3-fixture.ts';

test('File Import retains every language, description and owner of legally repeated ID3 frames', async () => {
	const { file, payloads, records } = await multilingualMp3Fixture();
	const inspection = await inspectImportedMediaMetadata(file);
	assert.deepEqual(inspection.warnings, []);
	assert.equal(inspection.metadata.normalized?.lyrics, 'First verse');
	assert.equal(inspection.metadata.normalized?.comment, 'First comment');
	for (const [key, payload] of Object.entries(payloads)) {
		const pathKey = records[key] ? `${key}.bytes` : key;
		assert.deepEqual(inspection.metadata.raw?.[key], records[key] ?? { attachmentPath: `raw.${key}` }, key);
		const attachment = inspection.attachments.find(({ path }) => path === `raw.${pathKey}`);
		assert.equal(attachment?.sha256, createHash('sha256').update(payload).digest('hex'), key);
		assert.equal(attachment?.byteLength, payload.length, key);
	}
});

test('all distributed readers expose additional frame payloads without changing scalar raw values', async () => {
	const runNode = promisify(execFile);
	const { file, payloads, records } = await multilingualMp3Fixture();
	for (const bundle of ['mediabunny.cjs', 'mediabunny.node.cjs', 'mediabunny.mjs']) {
		const { stdout } = await runNode(process.execPath, ['--input-type=module', '-e', `
			const module=await import('./node_modules/mediabunny/dist/bundles/'+process.argv[1]);
			const {Input,BlobSource,MP3}=module.default??module;
			const input=new Input({source:new BlobSource(new Blob([Buffer.from(process.argv[2],'base64')])),formats:[MP3]});
			try{const tags=await input.getMetadataTags();console.log(JSON.stringify(Object.fromEntries(Object.entries(tags.raw).map(([key,value])=>[key,value instanceof Uint8Array?Buffer.from(value).toString('base64'):value]))));}finally{input.dispose();}
		`, bundle, Buffer.from(await file.arrayBuffer()).toString('base64')], { timeout: 10_000 });
		assert.deepEqual(JSON.parse(stdout) as unknown, Object.fromEntries(Object.entries(payloads).flatMap(([key, bytes]) => [
			...(records[key] ? [[key, records[key]]] : []), [records[key] ? `${key}.bytes` : key, Buffer.from(bytes).toString('base64')],
		])), bundle);
	}
});
