/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deferred } from './helpers/async-test-control.ts';
import { createLightscaperAssociationProfileCurrentV1, readLightscaperAssociationReadyCurrentV1,
	waitLightscaperAssociationReadyCurrentV1 } from '../scripts/lib/lightscaper-desktop-association-profile-current-v1.ts';
import { validateLightscaperManagedSmokePlanCurrentV1 } from '../desktop/lightscaper-managed-smoke-main-current-v1.ts';

const NONCE = '0123456789abcdef0123456789abcdef', REVISION = 'd'.repeat(40), SHA = 'a'.repeat(64);
const OPTIONS = { concurrency: false, timeout: 10_000 } as const;

async function fixture(run: (root: string, profile: string) => Promise<void>) {
	const root = await mkdtemp(join(tmpdir(), 'lightscaper-association-contract-'));
	try { const parent = join(root, 'default-appdata'); await mkdir(parent); await run(root, join(parent, 'Lightscaper')); }
	finally { await rm(root, { recursive: true, force: true }); }
}

void test('registered profile owner creates only a fresh real directory and refuses deletion before actual reader retirement', OPTIONS, async () => fixture(async (root, profilePath) => {
	const owner = await createLightscaperAssociationProfileCurrentV1({ ownerRoot: root, profilePath, nonce: NONCE, sourceRevision: REVISION });
	await writeFile(join(profilePath, 'actual-profile-state'), 'owned state', { flag: 'wx' });
	await assert.rejects(owner.close(false)); assert.equal(await readFile(join(profilePath, 'actual-profile-state'), 'utf8'), 'owned state');
	await owner.close(true); await owner.close(true); await assert.rejects(readFile(join(profilePath, 'actual-profile-state')));
}));

void test('registered profile owner never adopts a preexisting directory, symlink or changed ownership marker', OPTIONS, async () => fixture(async (root, profilePath) => {
	await mkdir(profilePath); await writeFile(join(profilePath, 'foreign'), 'sentinel');
	await assert.rejects(createLightscaperAssociationProfileCurrentV1({ ownerRoot: root, profilePath, nonce: NONCE, sourceRevision: REVISION }));
	assert.equal(await readFile(join(profilePath, 'foreign'), 'utf8'), 'sentinel'); await rm(profilePath, { recursive: true });
	const foreign = join(root, 'foreign-profile'); await mkdir(foreign); await writeFile(join(foreign, 'foreign'), 'sentinel');
	await symlink(foreign, profilePath, process.platform === 'win32' ? 'junction' : 'dir');
	await assert.rejects(createLightscaperAssociationProfileCurrentV1({ ownerRoot: root, profilePath, nonce: NONCE, sourceRevision: REVISION }));
	assert.equal(await readFile(join(foreign, 'foreign'), 'utf8'), 'sentinel'); await rm(profilePath);
	const owner = await createLightscaperAssociationProfileCurrentV1({ ownerRoot: root, profilePath, nonce: NONCE, sourceRevision: REVISION });
	await writeFile(owner.markerPath, '{}'); await assert.rejects(owner.close(true));
	assert.equal(await readFile(owner.markerPath, 'utf8'), '{}');
}));

void test('warm-primary readiness is an exact bounded envelope and never inferred from file presence or process success', OPTIONS, async () => fixture(async (root, profilePath) => {
	const expected = { nonce: NONCE, sourceRevision: REVISION, profilePath, archiveName: 'Actual backup.liscape', archiveSha256: SHA };
	const ready = { schemaVersion: 1, kind: 'lightscaper-registered-association-ready-current-v1', ...expected, stage: 2, processId: 1234 };
	assert.deepEqual(readLightscaperAssociationReadyCurrentV1(ready, expected), ready);
	for (const changed of [{ ...ready, stage: 1 }, { ...ready, processId: 0 }, { ...ready, archiveSha256: 'b'.repeat(64) },
		{ ...ready, profilePath: join(root, 'foreign') }, { ...ready, nonce: 'f'.repeat(32) }, { ...ready, arbitraryPath: '/escape' }]) {
		assert.throws(() => readLightscaperAssociationReadyCurrentV1(changed, expected));
	}
	const file = join(root, 'ready.json'), running = deferred<void>();
	const waiting = waitLightscaperAssociationReadyCurrentV1(file, expected, running.promise, { deadlineMs: 1000 });
	await writeFile(file, JSON.stringify(ready), { flag: 'wx', mode: 0o600 });
	assert.deepEqual(await waiting, ready); running.resolve();
	await assert.rejects(waitLightscaperAssociationReadyCurrentV1(join(root, 'absent.json'), expected, Promise.resolve(), { deadlineMs: 1000 }));
}));

void test('association smoke plan admits only its marked native default profile while ordinary private-profile admission stays exact', OPTIONS, async () => fixture(async (root, profilePath) => {
	const association = { schemaVersion: 1, ownerNonce: NONCE, sourceRevision: REVISION }, plan = {
		schemaVersion: 1, nonce: NONCE, stage: 2, profilePath, registeredAssociation: association,
		renderer: { nonce: NONCE, stage: 2, locale: 'en', backend: 'web', scenario: 'managed', fixtures: [
			{ name: 'Owned raster.png', mimeType: 'image/png', base64: 'AQID', byteLength: 3, sha256: 'a'.repeat(64) },
			{ name: 'Owned Bayer.dng', mimeType: 'image/x-adobe-dng', base64: 'BAUG', byteLength: 3, sha256: 'b'.repeat(64) }],
			archive: { name: 'Actual backup.liscape', mimeType: 'application/vnd.soundscaper.scape+zip', base64: 'BwgJ', byteLength: 3, sha256: SHA },
			expectedFingerprint: 'c'.repeat(64), expectedNamespace: null,
			expectedPhotoIds: ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'], backupSuggestedName: 'Actual backup.liscape' } };
	const authority = { nonce: NONCE, planPath: join(root, `${NONCE}.stage-2.json`), profilePath };
	assert.deepEqual(validateLightscaperManagedSmokePlanCurrentV1(plan, authority), plan);
	const { registeredAssociation: _association, ...ordinary } = plan;
	assert.throws(() => validateLightscaperManagedSmokePlanCurrentV1(ordinary, authority));
	for (const changed of [{ ...plan, registeredAssociation: { ...association, ownerNonce: 'invalid' } },
		{ ...plan, registeredAssociation: { ...association, foreign: true } }, { ...plan, profilePath: join(root, 'another-profile') },
		{ ...plan, renderer: { ...plan.renderer, scenario: 'linked', backend: 'native' } }]) {
		assert.throws(() => validateLightscaperManagedSmokePlanCurrentV1(changed, authority));
	}
}));
