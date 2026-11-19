/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { access, mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { linkedGrantsFixtureCurrentV1 as fixture, LINKED_GRANT_TEST_OPTIONS_CURRENT_V1 as options,
	grantAuthorizeCurrentV1 as authorize, grantProjectionCurrentV1 as projection,
	Grants, GRANTED_FS_OP, grantedFsPathCurrentV1, invokeGrantUnknownCurrentV1 as invoke } from './helpers/lightscaper-native-linked-grants-integration-fixture-current.ts';
import { nativeGrantedFilesystemFixtureCurrentV1 as nativeFixture } from './helpers/lightscaper-native-granted-filesystem-fixture-current.ts';

void test('Lightscaper genuine folder authorize stores only actual native identity and returns a pathless immutable projection', options, async context => {
	await fixture(context, async f => {
		const owner = await f.open(), opened = f.count(GRANTED_FS_OP.rootOpen), closed = f.count(GRANTED_FS_OP.rootClose);
		const grant = await authorize(owner); assert.equal(grant.revoked, false); assert.equal(grant.revision, 0);
		assert.equal(f.count(GRANTED_FS_OP.rootOpen), opened + 1); assert.equal(f.count(GRANTED_FS_OP.rootClose), closed + 1);
		const peer = f.peer();
		try {
			assert.equal(peer.prepare('PRAGMA application_id').get()?.application_id, 0x4c534c47);
			assert.equal(peer.prepare('PRAGMA user_version').get()?.user_version, 1);
			const row = peer.prepare('SELECT path_encoding,native_path,volume_identity,object_identity FROM native_photo_linked_root_grants WHERE grant_id=?').get(grant.grantId);
			assert.ok(row && row.native_path instanceof Uint8Array); assert.equal(row.path_encoding, f.selected.path.encoding);
			assert.equal(Buffer.from(row.native_path).toString('hex'), Buffer.from(f.selected.path.bytes).toString('hex'));
			assert.equal(typeof row.volume_identity, 'string'); assert.equal(typeof row.object_identity, 'string');
		} finally { peer.close(); }
		const reopened = await owner.revalidate(grant.grantId); assert.deepEqual(reopened, grant);
		const page = await owner.readPage(); assert.deepEqual(page.grants, [grant]); assert.equal(page.afterGrantId, null);
		assert.equal(f.notifications(), 0);
	});
});

void test('Lightscaper chooser cancellation creates no grant and performs no native root IO', options, async context => {
	await fixture(context, async f => {
		let calls = 0; const owner = await f.open(async () => { calls++; return null; }), opened = f.count(GRANTED_FS_OP.rootOpen);
		assert.equal(await owner.authorize(), null); assert.equal(calls, 1); assert.equal(f.count(GRANTED_FS_OP.rootOpen), opened);
		assert.deepEqual(await owner.readPage(), { grants: [], afterGrantId: null });
	});
});

void test('Lightscaper durable grant reopens the same physical folder through the actual native role after grant-owner close', options, async context => {
	await fixture(context, async f => {
		const first = await f.open(), grant = await authorize(first); await first.close(); const second = await f.open();
		assert.deepEqual(await second.revalidate(grant.grantId), grant); assert.deepEqual((await second.readPage()).grants, [grant]);
	});
});

void test('Lightscaper native expected identity rejects replacement and accepts the original actual directory restored', options, async context => {
	await fixture(context, async f => {
		const owner = await f.open(), grant = await authorize(owner), moved = join(f.directory, 'retained-original-root');
		await rename(f.rootPath, moved); await mkdir(f.rootPath);
		try { await assert.rejects(owner.revalidate(grant.grantId)); }
		finally { await rm(f.rootPath, { recursive: true }); await rename(moved, f.rootPath); }
		assert.deepEqual(await owner.revalidate(grant.grantId), grant);
	});
});

void test('Lightscaper revoked grants stay revoked across reopen and cannot be revived by revalidate or identical chooser path', options, async context => {
	await fixture(context, async f => {
		const first = await f.open(), grant = await authorize(first); assert.equal(await first.revoke(grant.grantId), true);
		assert.equal(await first.revoke(grant.grantId), false); await first.close();
		const second = await f.open(), opened = f.count(GRANTED_FS_OP.rootOpen), revoked = await second.revalidate(grant.grantId);
		assert.ok(revoked); projection(revoked); assert.equal(revoked.revoked, true); assert.equal(revoked.revision, 1);
		assert.equal(f.count(GRANTED_FS_OP.rootOpen), opened); const fresh = await authorize(second);
		assert.notEqual(fresh.grantId, grant.grantId); assert.equal(fresh.revoked, false);
		assert.equal((await second.revalidate(grant.grantId))?.revoked, true);
		assert.equal(await second.revoke('f'.repeat(64)), false); assert.equal(await second.revalidate('f'.repeat(64)), null);
	});
});

void test('Lightscaper 65 real authorizations page pathlessly in canonical order without native root IO during listing', options, async context => {
	await fixture(context, async f => {
		const owner = await f.open(), ids: string[] = [];
		for (let i = 0; i < 65; i++) ids.push((await authorize(owner)).grantId);
		const opened = f.count(GRANTED_FS_OP.rootOpen), first = await owner.readPage();
		assert.equal(first.grants.length, 64); assert.ok(first.afterGrantId); first.grants.forEach(projection);
		const second = await owner.readPage(first.afterGrantId); assert.equal(second.grants.length, 1); assert.equal(second.afterGrantId, null);
		assert.deepEqual([...first.grants, ...second.grants].map(grant => grant.grantId), ids.sort()); assert.equal(f.count(GRANTED_FS_OP.rootOpen), opened);
	});
});

void test('Lightscaper forged filesystem role refuses before chooser reflection or grants-file creation', options, async context => {
	await fixture(context, async f => {
		let touched = 0; const poison = new Proxy({}, { get() { touched++; throw new Error('must not reflect forged role'); }, ownKeys() { touched++; return []; } });
		await assert.rejects(invoke(Grants, 'open', [{ appDataPath: f.appDataPath, filesystem: poison, chooser: poison, scope: poison, unretired: () => undefined }]));
		assert.equal(touched, 0); await assert.rejects(access(f.databasePath));
	});
});

void test('Lightscaper foreign genuine role refuses before trusted chooser capture in another actual media namespace', options, async context => {
	await fixture(context, async f => {
		await nativeFixture(context, async other => {
			let touched = 0; const chooser = new Proxy({}, { get() { touched++; throw new Error('foreign role must refuse first'); }, ownKeys() { touched++; return []; } });
			await assert.rejects(invoke(Grants, 'open', [{ appDataPath: f.appDataPath, filesystem: other.role, chooser, scope: f.scope, unretired: () => undefined }]));
			assert.equal(touched, 0); await assert.rejects(access(f.databasePath));
		});
	});
});

void test('Lightscaper captured chooser receiver and actual native root capability cannot be retargeted after open', options, async context => {
	await fixture(context, async f => {
		let calls = 0; const chooser = { async chooseRoot() { assert.equal(this, chooser); calls++; return f.selected; } };
		const owner = f.own(await Grants.open({ appDataPath: f.appDataPath, filesystem: f.role, chooser, scope: f.scope, unretired: () => undefined }));
		chooser.chooseRoot = async () => { throw new Error('replacement chooser'); }; await authorize(owner); assert.equal(calls, 1);
	});
});

void test('Lightscaper actual POSIX non-UTF8 root bytes and lone-UTF16 display name round-trip without text path coercion', { ...options, skip: process.platform === 'win32' }, async context => {
	await fixture(context, async f => {
		const path = Buffer.concat([Buffer.from(f.directory), Buffer.from('/native-'), Buffer.from([255])]); await mkdir(path);
		const owner = await f.open(async () => ({ path: grantedFsPathCurrentV1(path), displayName: 'Folder \ud800' }));
		const grant = await authorize(owner); assert.equal(grant.displayName, 'Folder \ud800'); assert.deepEqual(await owner.revalidate(grant.grantId), grant);
		const peer = f.peer(); try {
			const row = peer.prepare('SELECT native_path FROM native_photo_linked_root_grants WHERE grant_id=?').get(grant.grantId);
			assert.ok(row?.native_path instanceof Uint8Array); assert.equal(Buffer.from(row.native_path).toString('hex'), path.toString('hex'));
		} finally { peer.close(); }
	});
});
