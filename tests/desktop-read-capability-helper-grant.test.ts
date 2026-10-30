/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { resolveReadCapabilityHelperGrant, resolveReadCapabilityOriginalFileGrant } from '../desktop/read-capability-helper-grant.ts';

const NTFS_INODE = 915356624263228680n;

async function fixture(context: test.TestContext) {
	const root = await mkdtemp(join(tmpdir(), 'read-helper-grant-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const path = join(root, 'original.wav');
	await writeFile(path, 'original');
	const handle = await open(path, 'r');
	context.after(() => handle.close());
	const numeric = await handle.stat();
	const exact = await handle.stat({ bigint: true });
	const snapshot = { dev: numeric.dev, ino: Number(NTFS_INODE), size: numeric.size,
		mtimeMs: numeric.mtimeMs, ctimeMs: numeric.ctimeMs };
	context.mock.method(handle, 'stat', async (options?: { bigint?: boolean }) => options?.bigint
		? { ...exact, ino: NTFS_INODE } : { ...numeric, ino: Number(NTFS_INODE) });
	const entry = { id: 'read', path, owner: {}, handle, fileIdentity: snapshot };
	return { entry, numeric, exact };
}

test('original overwrite grants retain every bit of a Windows NTFS file ID', async (context) => {
	const { entry, exact } = await fixture(context);
	assert.equal(Number.isSafeInteger(entry.fileIdentity.ino), false);
	const grant = await resolveReadCapabilityOriginalFileGrant(entry, entry.owner, () => true);
	assert.deepEqual(grant, { path: entry.path, identity: { dev: exact.dev, ino: NTFS_INODE,
		size: exact.size, mtimeNs: exact.mtimeNs, ctimeNs: exact.ctimeNs } });
	assert.notEqual(grant.identity.ino, NTFS_INODE + 1n);
	assert.equal(Number(NTFS_INODE), Number(NTFS_INODE + 1n), 'number rounding would merge these distinct files');
});

test('legacy helper grants preserve their existing numeric snapshot and owner checks', async (context) => {
	const { entry } = await fixture(context);
	const grant = await resolveReadCapabilityHelperGrant(entry, entry.owner, true, () => true);
	assert.equal(grant?.identity, entry.fileIdentity);
	assert.equal(await resolveReadCapabilityHelperGrant(entry, {}, true, () => true), null);
	await assert.rejects(resolveReadCapabilityHelperGrant(entry, undefined, true, () => true), /owner/iu);
});

test('original overwrite refuses a changed read generation or retired owner', async (context) => {
	const { entry } = await fixture(context);
	assert.equal(await resolveReadCapabilityOriginalFileGrant(entry, {}, () => true), null);
	assert.equal(await resolveReadCapabilityOriginalFileGrant(entry, entry.owner, () => false), null);
	entry.fileIdentity.mtimeMs += 1;
	await assert.rejects(resolveReadCapabilityOriginalFileGrant(entry, entry.owner, () => true), /changed/iu);
});
