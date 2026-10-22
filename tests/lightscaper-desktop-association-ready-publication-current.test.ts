/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { publishAssociationReady as publish } from '../desktop/lightscaper-managed-smoke-main-current-v1.ts';
import type { LightscaperManagedSmokePlanCurrentV1 } from '../desktop/lightscaper-managed-smoke-contract-current-v1.ts';
import { waitLightscaperAssociationReadyCurrentV1 as waitReady } from '../scripts/lib/lightscaper-desktop-association-profile-current-v1.ts';
import { deferred } from './helpers/async-test-control.ts';

const NONCE = 'a'.repeat(32), REVISION = 'b'.repeat(40);
const OPTIONS = { concurrency: false, timeout: 10_000 } as const;
async function fixture(run: (root: string, plan: LightscaperManagedSmokePlanCurrentV1) => Promise<void>) {
	const root = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper-ready-publication-')));
	try {
		const profilePath = join(root, 'profile'); await mkdir(profilePath, { mode: 0o700 });
		const file = (name: string, mimeType: string, body: readonly number[]) => {
			const bytes = Buffer.from(body); return { name, mimeType, base64: bytes.toString('base64'), byteLength: bytes.length,
				sha256: createHash('sha256').update(bytes).digest('hex') };
		};
		await run(root, { schemaVersion: 1, nonce: NONCE, stage: 2, profilePath,
			registeredAssociation: { schemaVersion: 1, ownerNonce: NONCE, sourceRevision: REVISION },
			renderer: { nonce: NONCE, stage: 2, locale: 'en', backend: 'web', scenario: 'managed',
				fixtures: [file('Owned raster.png', 'image/png', [1, 2, 3]), file('Owned Bayer.dng', 'image/x-adobe-dng', [4, 5, 6])],
				archive: file('Actual backup.liscape', 'application/vnd.soundscaper.scape+zip', [7, 8, 9]),
				expectedFingerprint: 'c'.repeat(64), expectedNamespace: null,
				expectedPhotoIds: ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'],
				backupSuggestedName: 'Actual backup.liscape' } });
	} finally { await rm(root, { recursive: true }); }
	await assert.rejects(lstat(root), { code: 'ENOENT' });
}
function paths(root: string) {
	const ready = join(root, `${NONCE}.stage-2.ready.json`); return { ready, pending: `${ready}.pending` };
}

void test('actual readiness publisher keeps complete same-inode bytes stable until the evidence owner retires', OPTIONS, async () => fixture(async (root, plan) => {
	publish(plan, root);
	const { ready, pending } = paths(root), before = await lstat(ready), alias = await lstat(pending);
	assert.ok(before.isFile() && !before.isSymbolicLink() && alias.isFile() && !alias.isSymbolicLink());
	assert.equal(before.dev, alias.dev); assert.equal(before.ino, alias.ino); assert.equal(before.nlink, 2); assert.equal(alias.nlink, 2);
	assert.deepEqual(await readFile(ready), await readFile(pending));
	const running = deferred<void>(), handle = await open(ready, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	try {
		assert.ok(plan.renderer.archive);
		const expected = { nonce: NONCE, sourceRevision: REVISION, profilePath: plan.profilePath,
			archiveName: plan.renderer.archive.name, archiveSha256: plan.renderer.archive.sha256 };
		assert.deepEqual(await waitReady(ready, expected, running.promise, { deadlineMs: 1000 }), {
			schemaVersion: 1, kind: 'lightscaper-registered-association-ready-current-v1', ...expected, stage: 2, processId: process.pid });
		const after = await handle.stat(), named = await lstat(ready);
		for (const current of [after, named]) {
			assert.equal(current.dev, before.dev); assert.equal(current.ino, before.ino); assert.equal(current.size, before.size);
			assert.equal(current.mtimeMs, before.mtimeMs); assert.equal(current.ctimeMs, before.ctimeMs); assert.equal(current.nlink, 2);
		}
		assert.deepEqual(await readFile(handle), await readFile(pending));
	} finally { running.resolve(); await handle.close(); }
}));

void test('actual readiness collision preserves the foreign final file and removes only its owned pending file', OPTIONS, async () => fixture(async (root, plan) => {
	const { ready, pending } = paths(root), sentinel = 'preexisting final evidence\n';
	await writeFile(ready, sentinel, { flag: 'wx', mode: 0o600 }); const before = await lstat(ready);
	assert.throws(() => publish(plan, root), { code: 'EEXIST' });
	assert.equal(await readFile(ready, 'utf8'), sentinel); const after = await lstat(ready);
	assert.equal(after.dev, before.dev); assert.equal(after.ino, before.ino); assert.equal(after.size, before.size);
	await assert.rejects(lstat(pending), { code: 'ENOENT' });
}));

void test('actual readiness publisher retains its exact restore-stage and authority guards before any output', OPTIONS, async () => fixture(async (root, plan) => {
	const { registeredAssociation: _association, ...ordinary } = plan;
	const refused: LightscaperManagedSmokePlanCurrentV1[] = [{ ...plan, stage: 1 }, { ...plan, stage: 3 }, ordinary,
		{ ...plan, renderer: { ...plan.renderer, archive: null } }];
	for (const candidate of refused) {
		assert.throws(() => publish(candidate, root), /Only the genuine restore stage/u);
		assert.deepEqual(await readdir(root), ['profile']);
	}
}));
