/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { importAndReopenAudio } from './helpers/audio-import-archive-custody.ts';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inspectImportedMediaMetadata } from '../src/common/editor/imported-media-metadata.ts';
import { translatedTaggedWebmOpusFixture } from './helpers/ordinary-ogg-opus-fixture.ts';

for (const nonDefault of [true, false]) for (const flagLast of [true, false]) {
	test(`Matroska programme credits respect the explicit original-language flag (${String(nonDefault)}, last=${String(flagLast)})`, async () => {
		const inspection = await inspectImportedMediaMetadata(await translatedTaggedWebmOpusFixture(nonDefault, flagLast));
		assert.deepEqual(inspection.warnings, []);
		assert.equal(inspection.metadata.normalized?.artist, nonDefault ? 'Default performer' : 'Translated performer; Default performer');
		assert.deepEqual(inspection.metadata.raw?.ARTIST, { 0: 'Translated performer', 1: 'Default performer' });
		assert.equal(inspection.metadata.normalized?.comment, 'After credits');
	});
}
for (const bundle of ['mediabunny.cjs', 'mediabunny.node.cjs', 'mediabunny.mjs']) test(`shipped ${bundle} selects original-language programme credits`, async () => {
	const file = await translatedTaggedWebmOpusFixture(true, true);
	const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
		const imported=await import('./node_modules/mediabunny/dist/bundles/'+process.argv[1]);
		const {Input,BlobSource,WEBM}=imported.default??imported;
		const input=new Input({source:new BlobSource(new Blob([Buffer.from(process.argv[2],'base64')])),formats:[WEBM]});
		try{console.log(JSON.stringify((await input.getMetadataTags()).artist));}finally{input.dispose();}
	`, bundle, Buffer.from(await file.arrayBuffer()).toString('base64')], { timeout: 10_000 });
	assert.equal(JSON.parse(stdout) as unknown, 'Default performer');
});

for (const nonDefault of [true, false]) for (const flagLast of [true, false]) test(`default credit ${nonDefault}, flag last ${flagLast} persists through archive reopen`, async context => {
	const expected = Float32Array.from({ length: 3840 }, (_, frame) => (frame % 13 - 6) / 64);
	const { source, contribution, channels } = await importAndReopenAudio(context, await translatedTaggedWebmOpusFixture(nonDefault, flagLast),
		{ decoded: { sampleRate: 48_000, channels: [expected] } });
	assert.deepEqual([source.sampleRate, source.frameCount, source.channelCount], [48_000, 3840, 1]);
	assert.deepEqual(channels, [expected]); assert.deepEqual(contribution.warnings, []);
	assert.equal(contribution.metadata.normalized.artist, nonDefault ? 'Default performer' : 'Translated performer; Default performer');
	assert.deepEqual(contribution.metadata.raw.ARTIST, { 0: 'Translated performer', 1: 'Default performer' });
	assert.equal(contribution.metadata.normalized.comment, 'After credits');
});
