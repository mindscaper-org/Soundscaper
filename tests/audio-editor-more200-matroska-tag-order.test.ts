/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { importAndReopenAudio } from './helpers/audio-import-archive-custody.ts';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inspectImportedMediaMetadata } from '../src/common/editor/imported-media-metadata.ts';
import { reorderedTaggedWebmOpusFixture } from './helpers/ordinary-ogg-opus-fixture.ts';

for (const mode of ['name-first', 'value-first', 'targets-last'] as const) test(`valid Matroska tag child ordering preserves metadata scope: ${mode}`, async () => {
	const inspected = await inspectImportedMediaMetadata(await reorderedTaggedWebmOpusFixture(mode));
	assert.deepEqual(inspected.warnings, []);
	if (mode === 'targets-last') assert.deepEqual(inspected.metadata, {});
	else {
		assert.equal(inspected.metadata.normalized?.artist, 'Ada');
		assert.equal(inspected.metadata.raw?.ARTIST, 'Ada');
	}
});

for (const bundle of ['mediabunny.cjs', 'mediabunny.node.cjs', 'mediabunny.mjs']) test(`shipped ${bundle} does not require names before values`, async () => {
	const file = await reorderedTaggedWebmOpusFixture('value-first');
	const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
		const imported=await import('./node_modules/mediabunny/dist/bundles/'+process.argv[1]);
		const {Input,BlobSource,WEBM}=imported.default??imported;
		const input=new Input({source:new BlobSource(new Blob([Buffer.from(process.argv[2],'base64')])),formats:[WEBM]});
		try{console.log(JSON.stringify((await input.getMetadataTags()).artist??null));}finally{input.dispose();}
	`, bundle, Buffer.from(await file.arrayBuffer()).toString('base64')], { timeout: 10_000 });
	assert.equal(JSON.parse(stdout) as unknown, 'Ada');
});

for (const mode of ['name-first', 'value-first', 'targets-last'] as const) test(`${mode} metadata and decoded PCM survive controller import and archive reopen`, async context => {
	const expected = Float32Array.from({ length: 3840 }, (_, frame) => (frame % 23 - 11) / 64);
	const { source, contribution, channels } = await importAndReopenAudio(context, await reorderedTaggedWebmOpusFixture(mode),
		{ decoded: { sampleRate: 48_000, channels: [expected] } });
	assert.deepEqual([source.sampleRate, source.frameCount, source.channelCount], [48_000, 3840, 1]);
	assert.deepEqual(channels, [expected]); assert.deepEqual(contribution.warnings, []);
	if (mode === 'targets-last') {
		assert.deepEqual(contribution.metadata.normalized, {}); assert.deepEqual(contribution.metadata.raw, {});
	} else {
		assert.equal(contribution.metadata.normalized.artist, 'Ada'); assert.equal(contribution.metadata.raw.ARTIST, 'Ada');
	}
});
