/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inspectImportedMediaMetadata } from '../src/common/editor/imported-media-metadata.ts';
import { customTaggedWebmOpusFixture } from './helpers/ordinary-ogg-opus-fixture.ts';

const custom = Object.freeze(Object.fromEntries([['constructor', 'Reviewed engineer'], ['toString', 'Reviewed producer'], ['__proto__', 'Reviewed source owner'], ['_ordinary', 'Control']]));

test('Matroska private tags retain actual own names through import metadata inspection', async () => {
	const file = await customTaggedWebmOpusFixture(custom);
	for (const value of Object.values(custom)) assert.ok(Buffer.from(await file.arrayBuffer()).includes(Buffer.from(value)));
	const inspected = await inspectImportedMediaMetadata(file);
	assert.deepEqual(inspected.warnings, []);
	assert.equal(Object.getPrototypeOf(inspected.metadata.raw), Object.prototype);
	for (const [key, value] of Object.entries(custom)) assert.equal(Object.getOwnPropertyDescriptor(inspected.metadata.raw, key)?.value, value);
});

for (const bundle of ['mediabunny.cjs', 'mediabunny.node.cjs', 'mediabunny.mjs']) test(`shipped ${bundle} retains private Matroska own keys`, async () => {
	const file = await customTaggedWebmOpusFixture(custom);
	const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
		const imported=await import('./node_modules/mediabunny/dist/bundles/'+process.argv[1]);
		const {Input,BlobSource,WEBM}=imported.default??imported;
		const input=new Input({source:new BlobSource(new Blob([Buffer.from(process.argv[2],'base64')])),formats:[WEBM]});
		try{console.log(JSON.stringify((await input.getMetadataTags()).raw));}finally{input.dispose();}
	`, bundle, Buffer.from(await file.arrayBuffer()).toString('base64')], { timeout: 10_000 });
	const raw: unknown = JSON.parse(stdout);
	assert.ok(raw && typeof raw === 'object');
	assert.equal(Object.getPrototypeOf(raw), Object.prototype);
	for (const [key, value] of Object.entries(custom)) assert.equal(Object.getOwnPropertyDescriptor(raw, key)?.value, value);
});
