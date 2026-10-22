/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { PhotoLibrarySessionV1 } from '../src/lightscaper/controller/photo-library-session.ts';
import { PhotoLibrarySessionV2 } from '../src/lightscaper/controller/photo-library-session-v2.ts';
import { PhotoLibrarySessionCurrentV1 } from '../src/lightscaper/controller/photo-library-session-current-v1.ts';
import { importPhotoCatalogArchiveV5 } from '../src/lightscaper/archive/catalog-archive-import-v5.ts';
import { sessionBackupOriginalSourceFixtureCurrentV1 as fixture } from './helpers/lightscaper-session-backup-original-source-fixture-current.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

for (const Session of [PhotoLibrarySessionV1, PhotoLibrarySessionV2, PhotoLibrarySessionCurrentV1]) {
	test(`${Session.name} exports a complete scoped-source-only backup and retires every genuine File`, { timeout: 15_000 }, async context => {
		const f = await fixture(); let session: InstanceType<typeof Session> | undefined;
		const cancel = () => { void session?.close().catch(() => undefined); }; context.signal.addEventListener('abort', cancel, { once: true });
		try {
			session = new Session(f.ports); const before = await f.catalog.readSnapshot(f.root.id);
			const result = await session.backupCatalog({ signal: context.signal }); assert.ok(result.blob);
			assert.equal(f.calls.acquisitions, 2); assert.equal(f.calls.releases, 2); assert.equal(f.active.size, 0);
			let imported = 0, published = 0;
			await importPhotoCatalogArchiveV5(result.blob, async () => ({
				async writePhoto(photo, chunks) {
					const expected = f.sources.find(source => source.photo.id === photo.id); assert.ok(expected); assert.deepEqual(photo, expected.photo);
					const digest = createHash('sha256'); let length = 0;
					for await (const bytes of chunks) { length += bytes.byteLength; digest.update(bytes); }
					assert.equal(length, expected.photo.original.byteLength); assert.equal(digest.digest('hex'), expected.photo.original.contentSha256); imported++;
				}, writeLut: async () => { assert.fail('No LUT in this fixture.'); }, writeStack: async () => { assert.fail('No stacks in this fixture.'); },
				writeDevelopPresets: async () => { assert.fail('No presets in this fixture.'); }, writeSavedCollection: async () => { assert.fail('No saved collections in this fixture.'); },
				publish: async () => { published++; }, rollback: async () => { assert.fail('Valid scoped backup must import.'); },
			}), { signal: context.signal });
			assert.equal(imported, 2); assert.equal(published, 1); assert.deepEqual(await f.catalog.readSnapshot(f.root.id), before);
		} finally { try { await session?.close(); } finally { context.signal.removeEventListener('abort', cancel); await f.close(); } }
	});

	test(`${Session.name} backup Close joins late source acquisition and its held File retirement`, { timeout: 15_000 }, async context => {
		const f = await fixture(), entered = deferred<void>(), acquired = deferred<void>(), retiring = deferred<void>(), retired = deferred<void>(), stop = new AbortController();
		let session: InstanceType<typeof Session> | undefined, work: Promise<unknown> | undefined, closing: Promise<void> | undefined;
		const cancel = () => { acquired.resolve(); retired.resolve(); stop.abort(); void session?.close().catch(() => undefined); };
		context.signal.addEventListener('abort', cancel, { once: true });
		try {
			f.hooks.acquire = async () => { entered.resolve(); await acquired.promise; };
			f.hooks.closeLease = async () => { retiring.resolve(); await retired.promise; };
			session = new Session(f.ports); work = session.backupCatalog({ signal: stop.signal });
			const outcome = work.then(() => ({ failed: false, error: undefined as unknown }), (error: unknown) => ({ failed: true, error }));
			await Promise.race([entered.promise, work.then(() => { assert.fail('Backup ended before source acquisition.'); })]);
			assert.equal(f.active.size, 1); stop.abort(new DOMException('Cancel held scoped backup.', 'AbortError')); closing = session.close();
			assert.equal(await remainsPending(closing), true); assert.equal(f.calls.resourceCloses, 0); acquired.resolve();
			await Promise.race([retiring.promise, work.then(() => { assert.fail('Backup ended before File retirement.'); })]);
			assert.equal(await remainsPending(work), true); assert.equal(await remainsPending(closing), true); assert.equal(f.calls.resourceCloses, 0);
			retired.resolve(); const result = await outcome; await closing;
			assert.equal(result.failed, true); assert.equal(result.error, stop.signal.reason); assert.equal(f.active.size, 0); assert.equal(f.calls.releases, 1);
			assert.equal(f.calls.resourceCloses, 1);
		} finally {
			acquired.resolve(); retired.resolve(); await Promise.allSettled([work, closing]);
			try { await session?.close(); } finally { context.signal.removeEventListener('abort', cancel); await f.close(); }
		}
	});
}
