/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, readlink, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import test from 'node:test';

import {
	materializeProjectLibraryNativeBody,
	ProjectLibraryVerifiedBodyReader,
	verifyProjectLibraryNativeBody,
} from '../desktop/project-library-native-body-materialization.ts';

test('native project bodies materialize through a bounded authenticated copy', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-native-body-'));
	context.after(async () => { await import('node:fs/promises').then(({ rm }) => rm(root, { recursive: true })); });
	const source = join(root, 'source.media');
	const destination = join(root, 'scratch.media');
	const bytes = new Uint8Array(2 * 1024 * 1024 + 17);
	for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251;
	await writeFile(source, bytes);
	const sha256 = digest(bytes);
	assert.deepEqual(await materializeProjectLibraryNativeBody(source, destination, {
		byteLength: bytes.byteLength, sha256,
	}), { byteLength: bytes.byteLength, sha256 });
	assert.deepEqual(new Uint8Array(await readFile(destination)), bytes);
});

test('native body materialization rejects links, digest changes, and cancelled copies without output', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-native-body-refusal-'));
	context.after(async () => { await import('node:fs/promises').then(({ rm }) => rm(root, { recursive: true })); });
	const source = join(root, 'source.media');
	const linked = join(root, 'linked.media');
	const destination = join(root, 'scratch.media');
	const bytes = new Uint8Array([1, 2, 3, 4]);
	await writeFile(source, bytes);
	await symlink(source, linked);
	await assert.rejects(() => materializeProjectLibraryNativeBody(linked, destination, {
		byteLength: bytes.byteLength, sha256: digest(bytes),
	}), /type or length/u);
	await assert.rejects(() => materializeProjectLibraryNativeBody(source, destination, {
		byteLength: bytes.byteLength, sha256: '0'.repeat(64),
	}), /digest/u);
	await assert.rejects(readFile(destination), /ENOENT/u);
	const abort = new AbortController(); abort.abort(new Error('cancelled by test'));
	await assert.rejects(() => materializeProjectLibraryNativeBody(source, destination, {
		byteLength: bytes.byteLength, sha256: digest(bytes),
	}, abort.signal), /cancelled by test/u);
	await assert.rejects(readFile(destination), /ENOENT/u);
});

test('verified range reads authenticate once and retain the opened body identity', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-native-body-ranges-'));
	context.after(async () => { await import('node:fs/promises').then(({ rm }) => rm(root, { recursive: true })); });
	const source = join(root, 'source.media');
	const displaced = join(root, 'displaced.media');
	const original = Uint8Array.of(1, 2, 3, 4, 5, 6);
	await writeFile(source, original);
	const identity = { byteLength: original.byteLength, sha256: digest(original) };
	const reader = new ProjectLibraryVerifiedBodyReader();
	assert.deepEqual(await reader.read(source, identity, 0, 3, 4), original.slice(0, 3));
	await rename(source, displaced);
	await writeFile(source, Uint8Array.of(6, 5, 4, 3, 2, 1));
	assert.deepEqual(await reader.read(source, identity, 3, 3, 4), original.slice(3));
	await reader.close();
	await assert.rejects(verifyProjectLibraryNativeBody(source, identity), /digest/iu);
});

test('completed project body transfers release file handles before the library session closes', {
	skip: process.platform !== 'linux',
}, async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-transferred-bodies-'));
	const reader = new ProjectLibraryVerifiedBodyReader();
	context.after(async () => { await reader.close(); await rm(root, { recursive: true, force: true }); });
	const bytes = Uint8Array.of(1, 2, 3, 4);
	const identity = { byteLength: bytes.byteLength, sha256: digest(bytes) };
	const paths = Array.from({ length: 96 }, (_, index) => join(root, `body-${index}`));
	for (const path of paths) await writeFile(path, bytes);
	for (const path of paths) {
		assert.deepEqual(await reader.read(path, identity, 0, 2, 2), bytes.slice(0, 2));
		assert.deepEqual(await reader.read(path, identity, 2, 2, 2), bytes.slice(2));
	}
	assert.equal(await openBodyHandles(root), 0);
});

test('concurrent first ranges share one authenticated file handle', {
	skip: process.platform !== 'linux',
}, async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-same-body-ranges-'));
	const reader = new ProjectLibraryVerifiedBodyReader();
	context.after(async () => { await reader.close(); await rm(root, { recursive: true, force: true }); });
	const path = join(root, 'source.media');
	const bytes = Uint8Array.of(1, 2, 3, 4);
	const identity = { byteLength: bytes.byteLength, sha256: digest(bytes) };
	await writeFile(path, bytes);
	const parts = await Promise.all(Array.from({ length: 24 }, () => reader.read(path, identity, 0, 2, 2)));
	for (const part of parts) assert.deepEqual(part, bytes.slice(0, 2));
	assert.equal(await openBodyHandles(root), 1);
	assert.deepEqual(await Promise.all([reader.read(path, identity, 2, 2, 2), reader.read(path, identity, 0, 2, 2)]),
		[bytes.slice(2), bytes.slice(0, 2)]);
	assert.equal(await openBodyHandles(root), 0);
});

async function openBodyHandles(root: string): Promise<number> {
	const fdDirectory = '/proc/self/fd';
	const fds = await readdir(fdDirectory);
	const paths = await Promise.all(fds.map(fd => readlink(join(fdDirectory, fd)).catch(() => '')));
	return paths.filter(path => path.startsWith(`${root}${sep}`)).length;
}

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}
