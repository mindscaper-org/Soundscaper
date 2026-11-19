/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { BlobReader, BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js/index-native.js';
import { openSoundcraftBundle } from '../src/common/editor/soundcraft-bundle.ts';
import { soundcraftSession } from './helpers/native-daw-import-fixtures.ts';

async function bundle(entries: readonly [string, string | Blob][]): Promise<Blob> {
	const writer = new ZipWriter(new BlobWriter(), { useWebWorkers: false, level: 0 });
	for (const [name, value] of entries) await writer.add(name, typeof value === 'string' ? new TextReader(value) : new BlobReader(value));
	return writer.close();
}

test('SoundCraft bundles read one root session and only requested media', async () => {
	const archive = await openSoundcraftBundle(await bundle([
		['Session.scraft', JSON.stringify(soundcraftSession())], ['Audio Files/voice.wav', new Blob(['audio'])],
	]));
	try {
		assert.equal(archive.document.title, 'Native session');
		assert.equal(await (await archive.readMedia('Audio Files/voice.wav'))?.text(), 'audio');
		assert.equal(await archive.readMedia('/outside.wav'), null);
		assert.equal(await archive.readMedia('../outside.wav'), null);
	} finally { await archive.close(); }
	await assert.rejects(archive.readMedia('Audio Files/voice.wav'), /closed/iu);
});

test('SoundCraft bundles reject missing or multiple root sessions and traversal', async () => {
	await assert.rejects(openSoundcraftBundle(await bundle([['readme.txt', 'missing']])), /session/iu);
	await assert.rejects(openSoundcraftBundle(await bundle([['a.scraft', '{}'], ['b.scraft', '{}']])), /session/iu);
	await assert.rejects(openSoundcraftBundle(await bundle([['../a.scraft', '{}']])), /path|traversal|filename/iu);
});

test('SoundCraft bundles verify media checksums before returning audio', async () => {
	const original = await bundle([['Session.scraft', JSON.stringify(soundcraftSession())], ['Audio Files/voice.wav', new Blob(['audio'])]]);
	const bytes = Buffer.from(await original.arrayBuffer());
	const offset = bytes.indexOf(Buffer.from('audio'));
	assert.ok(offset >= 0);
	bytes[offset] = 0;
	const archive = await openSoundcraftBundle(new Blob([bytes]));
	try { await assert.rejects(archive.readMedia('Audio Files/voice.wav'), /signature|crc|corrupt/iu); }
	finally { await archive.close(); }
});
