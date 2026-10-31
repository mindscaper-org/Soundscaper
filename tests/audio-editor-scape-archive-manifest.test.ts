/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	BlobWriter,
	Uint8ArrayReader,
	ZipWriter,
} from '@zip.js/zip.js';

import { createScapeArchiveManifest } from '../src/common/editor/scape-archive-manifest.ts';
import { digestBytes as digestScapeBytes } from '../src/common/media/bytes.ts';

const PROJECT = new TextEncoder().encode('{"schemaVersion":9}');
const MEDIA = Uint8Array.from({ length: 5_000 }, (_value, index) => index % 253);

test('a manifest is built by the real archive reader from the finished ZIP bytes', async () => {
	const manifest = await createScapeArchiveManifest(await archive(), {
		projectTitle: 'Cafe Film', signal: new AbortController().signal,
	});

	assert.equal(manifest.kind, 'archive-manifest');
	assert.equal(manifest.projectTitle, 'Cafe Film');
	assert.deepEqual(manifest.members.map(({ id }) => id), ['media/a.wav', 'project.json']);
	assert.equal(manifest.totalByteLength, PROJECT.byteLength + MEDIA.byteLength);
	// Digested from the archive, never copied from the writer's own account.
	assert.equal(
		manifest.members.find(({ id }) => id === 'media/a.wav')?.sha256,
		digestScapeBytes(MEDIA),
	);
});

test('directory entries are not checksum members', async () => {
	const manifest = await createScapeArchiveManifest(await archive(true), {
		signal: new AbortController().signal,
	});

	assert.deepEqual(manifest.members.map(({ id }) => id), ['media/a.wav', 'project.json']);
});

test('manifest creation obeys cancellation before opening an archive', async () => {
	const controller = new AbortController();
	controller.abort(new DOMException('Stop reading', 'AbortError'));
	await assert.rejects(createScapeArchiveManifest(await archive(), {
		signal: controller.signal,
	}), { name: 'AbortError' });
});

async function archive(withDirectory = false): Promise<Blob> {
	const writer = new ZipWriter(new BlobWriter('application/vnd.soundscaper.scape+zip'), {
		level: 0,
		useWebWorkers: false,
	});
	if (withDirectory) await writer.add('media/', undefined, { directory: true });
	await writer.add('media/a.wav', new Uint8ArrayReader(MEDIA), { level: 0 });
	await writer.add('project.json', new Uint8ArrayReader(PROJECT), { level: 0 });
	return writer.close();
}
