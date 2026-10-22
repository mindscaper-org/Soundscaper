/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nativeRestoreTransportFixtureCurrentV1 as fixture, archiveTransportShaCurrentV1 as sha, loadRestoreRuntimeCurrentV1 as runtime } from './helpers/lightscaper-native-library-restore-transport-fixture-current.ts';
void test('Native restore stale commit cannot retire a newer actual upload and bytes are captured before waiting', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
	 const old = await f.service.begin(f.owner, { name: 'Library', byteLength: 3 }); await f.service.abort(f.owner, { id: old.id });
	 const current = await f.service.begin(f.owner, { name: 'Library', byteLength: 3 });
	 await assert.rejects(f.service.commit(f.owner, { id: old.id, contentSha256: sha(Uint8Array.of(1,2,3)) }));
	 const bytes = Uint8Array.of(1,2,3), expected = sha(bytes), work = f.track(f.service.write(f.owner, { id: current.id, offset: 0, bytes })); bytes.fill(0); await work;
	 const files = await f.files(); assert.equal(files.length, 1); assert.equal(sha(await readFile(join(f.directory, files[0]!))), expected);
	 await f.service.abort(f.owner, { id: current.id }); assert.equal((await f.files()).length, 0);
	});
});
void test('Native restore runtime synchronous close refuses new borrowed inputs before reflection', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
	 const { createDesktopPhotoLibraryRestoreRuntimeCurrentV1: create } = await runtime(), owner = create({ name: 'Library', transport: f.transport });
	 const closing = owner.close(); let reflected = 0;
	 const options = new Proxy({}, { ownKeys() { reflected++; throw new Error('Closed capture reflected.'); }, getOwnPropertyDescriptor() { reflected++; throw new Error('Closed capture reflected.'); } });
	 await assert.rejects(owner.restoreArchive(new Blob([Uint8Array.of(1)]), options)); assert.equal(reflected, 0); await closing;
	});
});
