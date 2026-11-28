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
import { currentScapeArchiveManifest, recordScapeArchiveManifest, retireScapeArchiveManifests } from '../src/common/editor/controller/document/internal/scape/scape-archive-manifest-action.ts';
import { deferred } from './helpers/async-test-control.ts';

const PROJECT = new TextEncoder().encode('{"schemaVersion":9}');
const MEDIA = Uint8Array.from({ length: 5_000 }, (_value, index) => index % 253);

test('the unused standalone checksum verifiers are absent from the manifest module', async () => {
	const manifest = await import('../src/common/editor/archive-manifest.ts');
	assert.equal(Object.hasOwn(manifest, 'verifyArchiveManifest'), false);
	assert.equal(Object.hasOwn(manifest, 'compareArchiveManifests'), false);
});

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

test('overlapping readbacks keep the newest record for each open project', async context => {
	const slow = await archive();
	const second = await archive();
	const entered = deferred<void>(), resume = deferred<void>();
	const read = Blob.prototype.arrayBuffer;
	let held = false;
	context.mock.method(Blob.prototype, 'arrayBuffer', async function (this: Blob) {
		if (!held) { held = true; entered.resolve(); await resume.promise; }
		return read.call(this);
	});
	const state = {};
	const signal = new AbortController().signal;
	const first = recordScapeArchiveManifest({ state }, { projectId: 'first', archive: slow, fileName: 'First.sscape', signal });
	await entered.promise;
	try {
		await recordScapeArchiveManifest({ state }, { projectId: 'second', archive: second, fileName: 'Second.sscape', signal });
		assert.equal(currentScapeArchiveManifest(state, 'first'), null);
		await recordScapeArchiveManifest({ state }, { projectId: 'first', archive: null, fileName: 'New first.sscape', signal });
	} finally {
		resume.resolve();
		await first;
	}
	assert.equal(currentScapeArchiveManifest(state, 'first')?.fileName, 'New first.sscape');
	assert.equal(currentScapeArchiveManifest(state, 'second')?.fileName, 'Second.sscape');
	assert.ok(currentScapeArchiveManifest(state, 'second')?.manifest);
	retireScapeArchiveManifests(state, projectId => projectId === 'second');
	assert.equal(currentScapeArchiveManifest(state, 'first'), null);
	assert.ok(currentScapeArchiveManifest(state, 'second')?.manifest);
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
