/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { BlobWriter, TextReader, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js/index-native.js';
import { readAdlPackage, writeAdlPackage } from '../src/common/editor/aes31-package.ts';
import { createAdlExport } from '../src/common/editor/aes31-export.ts';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { createFixture } from './helpers/native-project-service-fixture.ts';
import type { AudioClipLeaf } from '../src/common/editor/project-media-types.ts';
import { encodeWav } from '../src/common/editor/wav.js';

const text = readFileSync(new URL('./fixtures/aes31/voice.adl', import.meta.url), 'utf8');
async function archive(entries: readonly (readonly [string, string | Uint8Array])[]) {
	const writer = new ZipWriter(new BlobWriter('application/zip'));
	for (const [name, value] of entries) await writer.add(name, typeof value === 'string' ? new TextReader(value) : new Uint8ArrayReader(value), { level: 0 });
	return writer.close();
}

test('ADL ZIP import restores edits and selected PCM without external path authority', async () => {
	const wav = new Uint8Array(encodeWav([new Float32Array(96_000).fill(.125), new Float32Array(96_000).fill(.5)], { sampleRate: 48_000, float: true }));
	const blob = await archive([['edit.adl', text], ['Audio/voice.wav', wav]]);
	let counter = 0;
	const fixture = createFixture({ createStableId: prefix => `${prefix}-${++counter}` });
	const result = await createNativeProjectService(fixture.runtime).openInterchange(new File([blob], 'session.adl.zip'));
	assert.ok(result); const source = result.project.sources[0]!;
	assert.ok(source.kind === 'audio'); assert.equal(source.channelCount, 1);
	assert.equal((result.project.clips[0] as AudioClipLeaf).timelineStartFrame, 7);
	assert.equal(result.report.items.some(item => item.disposition === 'missing'), false);
});

test('ADL packages reject traversal and ambiguous decision lists, and preserve missing media', async () => {
	await assert.rejects(readAdlPackage(await archive([['../edit.adl', text]])), /unsafe/iu);
	await assert.rejects(readAdlPackage(await archive([['a.adl', text], ['b.adl', text]])), /exactly one/iu);
	await assert.rejects(readAdlPackage(await archive([['readme.txt', 'not an ADL']])), /exactly one/iu);
	const document = await readAdlPackage(await archive([['edit.adl', text]]));
	assert.equal(document.media[0]!.blob, undefined);
	const duplicates = await archive([['edit.adl', text], ['one/voice.wav', new Uint8Array([1])], ['two/voice.wav', new Uint8Array([2])]]);
	assert.equal((await readAdlPackage(duplicates)).media[0]!.blob, undefined);
});

test('ADL package CRC verification rejects corrupted companion audio', async () => {
	const blob = await archive([['edit.adl', text], ['voice.wav', new Uint8Array([1, 2, 3, 4, 5, 6])]]);
	const bytes = new Uint8Array(await blob.arrayBuffer());
	const offset = bytes.findIndex((_, index) => bytes[index] === 1 && bytes[index + 1] === 2 && bytes[index + 2] === 3 && bytes[index + 3] === 4);
	assert.ok(offset > 0); bytes[offset] = 9;
	await assert.rejects(readAdlPackage(new Blob([bytes])), /signature|crc/iu);
});

test('ADL package writer refuses missing media and honors cancellation', async () => {
	const result = createAdlExport({ project: { title: 'Empty', sampleRate: 48_000, sources: [], tracks: [], clips: [] } });
	const incomplete = { ...result, media: [{ sourceId: 's', path: 'a.wav', originatorReference: 'uid', frameCount: 1, channelCount: 1, sampleRate: 48_000 }] };
	async function* empty() { yield* []; }
	await assert.rejects(writeAdlPackage(incomplete, empty()), /incomplete/iu);
	const signal = AbortSignal.abort();
	await assert.rejects(writeAdlPackage(result, empty(), undefined, signal), { name: 'AbortError' });
	await assert.rejects(readAdlPackage(await archive([['edit.adl', text]]), signal), { name: 'AbortError' });
});
