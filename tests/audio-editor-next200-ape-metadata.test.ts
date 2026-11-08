/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readImportedMetadataTags } from '../src/common/editor/imported-metadata-reader.ts';
import { readApeMetadataTags } from '../src/common/editor/ape-metadata-reader.ts';
import { nativeApeMetadataFixture, nativeTtaMetadataFixture, APE_METADATA_CREDITS } from './helpers/native-ape-metadata-fixture.ts';
import { importAndReopenAudio } from './helpers/audio-import-archive-custody.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { readWavePcm } from './helpers/read-wave-pcm.ts';

for (const format of ['ape', 'tta'] as const) test(`native ${format} import retains SDK-authored APEv2 credits`, async () => {
	const file = format === 'ape' ? nativeApeMetadataFixture() : nativeTtaMetadataFixture();
	const reference = await readApeMetadataTags(file);
	for (const [key, value] of Object.entries(APE_METADATA_CREDITS)) assert.equal(reference[key], value);
	assert.deepEqual(await readImportedMetadataTags(file), reference);
});

test('Monkey audio without an APEv2 trailer has no invented metadata', async () => {
	const file = nativeApeMetadataFixture().slice(0, 4996);
	assert.deepEqual(await readImportedMetadataTags(file), {});
});

test('an already aborted Monkey metadata read performs no file I/O', async () => {
	const abort = new AbortController(); abort.abort();
	const file = new Blob(); file.slice = () => { throw new Error('retired read'); };
	await assert.rejects(readImportedMetadataTags(file, abort.signal), { name: 'AbortError' });
});

test('Monkey metadata retains the existing APEv2 inspection budget', async () => {
	const bytes = new Uint8Array(await nativeApeMetadataFixture().arrayBuffer());
	new DataView(bytes.buffer).setUint32(bytes.length - 20, 16 * 1024 ** 2 + 32, true);
	await assert.rejects(readImportedMetadataTags(new Blob([bytes])), /bounded inspection limit/u);
});

// Native codec availability stays in the browser. Inject only its PCM result here
// to exercise the real metadata, controller, storage and portable document owners.
for (const format of ['ape', 'tta', 'wav']) test(`${format} credits and owned PCM survive controller import and Scape reopen`, async context => {
	const sampleRate = format === 'tta' ? 96_000 : format === 'ape' ? 32_000 : 48_000;
	const expected = Float32Array.from({ length: 4800 }, (_, frame) => (frame % 17 - 8) / 64);
	const file = format === 'ape' ? nativeApeMetadataFixture() : format === 'tta' ? nativeTtaMetadataFixture()
		: new File([Uint8Array.from(encodeWav([expected], { sampleRate, float: true, metadata: APE_METADATA_CREDITS }))], 'Control.wav', { type: 'audio/wav' });
	const { source, contribution, channels } = await importAndReopenAudio(context, file,
		format === 'wav' ? {} : { decoded: { sampleRate, channels: [expected] } });
	assert.deepEqual([source.sampleRate, source.frameCount, source.channelCount], [sampleRate, 4800, 1]);
	for (const [key, value] of Object.entries(APE_METADATA_CREDITS)) assert.equal(contribution.metadata.normalized[key], value);
	assert.deepEqual(contribution.warnings, []);
	assert.deepEqual(channels[0], format === 'wav' ? readWavePcm(new Uint8Array(await file.arrayBuffer())).channels[0] : expected);
});
