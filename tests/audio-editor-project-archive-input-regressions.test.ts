/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { BlobReader, BlobWriter, ZipWriter } from '@zip.js/zip.js/index-native.js';

import { readDawprojectArchive, writeDawprojectArchive } from '../src/common/editor/dawproject-archive.ts';

async function zip(files: readonly (readonly [string, Blob])[]): Promise<Blob> {
	const writer = new ZipWriter(new BlobWriter());
	for (const [name, blob] of files) await writer.add(name, new BlobReader(blob), { level: 0 });
	return writer.close();
}

test('duplicate normalized DAWproject entry paths are rejected instead of selecting arbitrary media', async () => {
	const blob = await zip([
		['project.xml', new Blob(['<Project/>'])],
		['audio/take.wav', new Blob(['first'])],
		['./audio/take.wav', new Blob(['second'])],
	]);
	await assert.rejects(readDawprojectArchive(blob), /duplicate|ambiguous/iu);
});

test('case-insensitive media fallback refuses ambiguous entries while exact paths remain usable', async () => {
	const blob = await zip([
		['project.xml', new Blob(['<Project/>'])],
		['audio/Take.wav', new Blob(['first'])],
		['audio/take.wav', new Blob(['second'])],
	]);
	const archive = await readDawprojectArchive(blob);
	try {
		assert.equal(await (await archive.readEntry('audio/Take.wav'))?.text(), 'first');
		assert.equal(await (await archive.readEntry('audio/take.wav'))?.text(), 'second');
		await assert.rejects(archive.readEntry('AUDIO/TAKE.WAV'), /ambiguous/iu);
	} finally { await archive.close(); }
});

test('corrupted embedded audio is rejected by its ZIP CRC before decoding', async () => {
	const blob = await writeDawprojectArchive({ projectXml: '<Project/>', metadataXml: '',
		files: [{ path: 'audio/take.wav', blob: new Blob(['unique-media-payload']) }] });
	const bytes = new Uint8Array(await blob.arrayBuffer());
	const payload = new TextEncoder().encode('unique-media-payload');
	const offset = bytes.findIndex((_, index) => payload.every((byte, position) => bytes[index + position] === byte));
	assert.ok(offset >= 0);
	bytes[offset] = bytes[offset]! ^ 1;
	const archive = await readDawprojectArchive(new Blob([bytes]));
	try { await assert.rejects(archive.readEntry('audio/take.wav'), /signature|CRC/iu); }
	finally { await archive.close(); }
});

test('invalid UTF-8 metadata is rejected instead of silently changing project titles', async () => {
	const blob = await zip([
		['project.xml', new Blob(['<Project/>'])],
		['metadata.xml', new Blob([new Uint8Array([0xff])])],
	]);
	await assert.rejects(readDawprojectArchive(blob), /UTF-8|encoded data/iu);
});

test('releasing temporary media preserves a different entry that differs only by case', async () => {
	const files = new Map<string, ArrayBuffer[]>();
	const directory = {
		async getFileHandle(name: string) {
			files.set(name, []);
			return { createWritable: async () => new WritableStream<Uint8Array>({
				write(chunk) { files.get(name)!.push(chunk.slice().buffer as ArrayBuffer); },
			}), getFile: async () => new File(files.get(name)!, name) };
		},
		async removeEntry(name: string) { files.delete(name); },
	} as unknown as FileSystemDirectoryHandle;
	const blob = await zip([
		['project.xml', new Blob(['<Project/>'])],
		['audio/Take.wav', new Blob(['first'])],
		['audio/take.wav', new Blob(['second'])],
	]);
	const archive = await readDawprojectArchive(blob, { temporaryDirectory: directory });
	try {
		await archive.readEntry('audio/Take.wav');
		await archive.readEntry('audio/take.wav');
		assert.equal(files.size, 2);
		await archive.releaseEntry('audio/Take.wav');
		assert.equal(files.size, 1);
	} finally { await archive.close(); }
	assert.equal(files.size, 0);
});
