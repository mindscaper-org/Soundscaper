/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { removePkgCodeSignatureSidecars } from '../scripts/lib/desktop-pkg-appledouble.ts';
import { pkgCodeSignatureSidecar } from './helpers/desktop-pkg-appledouble-fixture.ts';

test('PKG normalization removes only signing metadata and retains its regular sibling bytes', async context => {
	const root = await mkdtemp(join(tmpdir(), 'desktop-pkg-signing-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	await writeFile(join(root, 'application'), 'application bytes');
	await writeFile(join(root, '._application'), pkgCodeSignatureSidecar());
	await removePkgCodeSignatureSidecars(root, ['._application']);
	assert.equal(await readFile(join(root, 'application'), 'utf8'), 'application bytes');
	await assert.rejects(lstat(join(root, '._application')), { code: 'ENOENT' });
});

test('PKG normalization refuses malformed AppleDouble, resource forks and unrelated extended attributes', async context => {
	const root = await mkdtemp(join(tmpdir(), 'desktop-pkg-signing-invalid-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const mutations: ReadonlyArray<(bytes: Buffer) => void> = [
		bytes => { bytes.writeUInt32BE(0, 0); },
		bytes => { bytes.writeUInt32BE(1, 4); },
		bytes => { bytes.writeUInt16BE(3, 24); },
		bytes => { bytes.writeUInt32BE(1, 46); },
		bytes => { bytes[50] = 1; },
		bytes => { bytes.writeUInt32BE(0, 84); },
		bytes => { bytes.writeUInt32BE(bytes.length + 1, 92); },
		bytes => { bytes.writeUInt32BE(0xffffffff, 96); },
		bytes => { bytes.writeUInt32BE(0, 100); },
		bytes => { bytes.writeUInt16BE(1, 116); },
		bytes => { bytes.writeUInt16BE(0, 118); },
		bytes => { bytes.writeUInt16BE(5, 118); },
		bytes => { bytes.writeUInt32BE(0, 120); },
		bytes => { bytes.writeUInt32BE(bytes.length, 124); },
		bytes => { bytes.writeUInt16BE(1, 128); },
		bytes => { bytes[130] = 255; },
		bytes => { bytes.write('com.apple.xx', 131); },
	];
	const malformed = mutations.map(mutate => {
		const bytes = pkgCodeSignatureSidecar();
		mutate(bytes);
		return bytes;
	});
	malformed.push(Buffer.from('ordinary file'), pkgCodeSignatureSidecar().subarray(0, 119),
		Buffer.concat([pkgCodeSignatureSidecar(), Buffer.from('extra application data')]),
		Buffer.alloc(1024 * 1024 + 1));
	for (const [index, bytes] of malformed.entries()) {
		const directory = join(root, String(index));
		await mkdir(directory);
		await writeFile(join(directory, 'application'), 'application bytes');
		await writeFile(join(directory, '._application'), bytes);
		await assert.rejects(removePkgCodeSignatureSidecars(directory, ['._application']), /PKG AppleDouble/u);
		assert.deepEqual(await readFile(join(directory, '._application')), bytes);
	}
});

test('PKG normalization refuses orphaned metadata, symlinks and paths outside the payload', async context => {
	const root = await mkdtemp(join(tmpdir(), 'desktop-pkg-signing-paths-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	await writeFile(join(root, '._application'), pkgCodeSignatureSidecar());
	await assert.rejects(removePkgCodeSignatureSidecars(root, ['._application']), /PKG AppleDouble/u);
	await symlink('._application', join(root, 'application'));
	await assert.rejects(removePkgCodeSignatureSidecars(root, ['._application']), /PKG AppleDouble/u);
	await rm(join(root, 'application'));
	await writeFile(join(root, 'application'), 'application bytes');
	await rm(join(root, '._application'));
	await symlink('application', join(root, '._application'));
	await assert.rejects(removePkgCodeSignatureSidecars(root, ['._application']), /PKG AppleDouble/u);
	for (const path of ['../._application', join(root, '._application'), '.\\._application', './._application']) {
		await assert.rejects(removePkgCodeSignatureSidecars(root, [path]), /PKG AppleDouble/u);
	}
});
