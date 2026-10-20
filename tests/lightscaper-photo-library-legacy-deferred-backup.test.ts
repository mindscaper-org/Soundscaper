/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { LEGACY_BACKUP_VARIANTS, LEGACY_BACKUP_TEST_OPTIONS, legacyBackupFixture, legacyBackupDestination,
	includesLegacyBackupFailure } from './helpers/lightscaper-legacy-backup-deferred-fixture.ts';
import { waitFor, remainsPending } from './helpers/async-test-control.ts';

for (const variant of LEGACY_BACKUP_VARIANTS) {
	test(`${variant} deferred native target streams an authenticated complete ZIP without a Blob fallback`, LEGACY_BACKUP_TEST_OPTIONS, async context => {
		await legacyBackupFixture(context, async f => {
			const target = legacyBackupDestination(), before = await f.catalog.readSnapshot(f.root.id);
			const custody = await f.media.mediaRepository.catalogOriginals.readPage({ catalogId: f.root.id }); let opened = 0;
			const options = { signal: f.signal, maximumBlobBytes: 1, async createWritable() {
				assert.equal(this, options); opened++; assert.equal(f.calls.originals, 0); assert.ok(f.calls.snapshots > 0); return target.writable;
			} };
			const result = await f.run(variant, options);
			assert.equal(opened, 1); assert.equal(result.blob, null); assert.equal(target.events.at(-1), 'close');
			assert.equal(target.events.includes('abort'), false); assert.equal(target.writable.locked, false); assert.equal(f.calls.originals, 2);
			const blob = new Blob(target.parts); assert.equal(blob.size, result.byteLength); await f.roundTrip(blob, variant);
			assert.deepEqual(await f.catalog.readSnapshot(f.root.id), before);
			assert.deepEqual(await f.media.mediaRepository.catalogOriginals.readPage({ catalogId: f.root.id }), custody);
		});
	});

	test(`${variant} joins a held deferred factory before preserving cancellation and leaves its unacquired stream unlocked`, LEGACY_BACKUP_TEST_OPTIONS, async context => {
		await legacyBackupFixture(context, async f => {
			const release = f.gate(), target = legacyBackupDestination(), stop = new AbortController(), reason = Object.freeze({ cancelled: variant });
			let entered = false, settled = false;
			const work = f.run(variant, { signal: AbortSignal.any([f.signal, stop.signal]), async createWritable() {
				entered = true; await release.promise; return target.writable;
			} });
			const joined = work.then(() => { settled = true; }, () => { settled = true; });
			try {
				await waitFor(() => entered || settled, 'actual deferred backup target admission'); assert.equal(entered, true);
				stop.abort(reason); assert.equal(await remainsPending(joined), true);
				assert.equal(f.calls.originals, 0); assert.deepEqual(target.events, []); release.resolve();
				await assert.rejects(work, error => includesLegacyBackupFailure(error, reason));
				assert.equal(target.writable.locked, false); assert.deepEqual(target.events, []);
			} finally { release.resolve(); await joined; }
		});
	});

	test(`${variant} refuses catalog changes made while its deferred target opens before reading Originals`, LEGACY_BACKUP_TEST_OPTIONS, async context => {
		await legacyBackupFixture(context, async f => {
			const target = legacyBackupDestination(); let opened = 0;
			await assert.rejects(f.run(variant, { signal: f.signal, async createWritable() {
				opened++; const root = await f.catalog.loadCatalog(f.root.id); assert.ok(root);
				await f.catalog.saveCatalog({ ...root, name: 'Changed during target creation' }, root.revision); return target.writable;
			} }));
			assert.equal(opened, 1); assert.equal(f.calls.originals, 0); assert.equal(target.writable.locked, false); assert.deepEqual(target.events, []);
		});
	});
}

test('public legacy Session V4 rechecks selected preset presence after its deferred target opens', LEGACY_BACKUP_TEST_OPTIONS, async context => {
	await legacyBackupFixture(context, async f => {
		const target = legacyBackupDestination(); let opened = 0;
		await assert.rejects(f.run('session-v4', { signal: f.signal, async createWritable() {
			opened++; await f.media.settingsRepository.delete(f.presetKey); return target.writable;
		} }));
		assert.equal(opened, 1); assert.equal(f.calls.originals, 0); assert.deepEqual(target.events, []); assert.equal(target.writable.locked, false);
	});
});

test('public legacy Session V4 preserves the actual destination close ACK after late cancellation', LEGACY_BACKUP_TEST_OPTIONS, async context => {
	await legacyBackupFixture(context, async f => {
		const stop = new AbortController(), target = legacyBackupDestination(() => { stop.abort(Object.freeze({ afterCloseAck: true })); }); let opened = 0;
		const result = await f.run('session-v4', { signal: AbortSignal.any([f.signal, stop.signal]), maximumBlobBytes: 1,
			async createWritable() { opened++; return target.writable; } });
		assert.equal(opened, 1); assert.equal(result.blob, null); assert.equal(target.events.at(-1), 'close');
		assert.equal(target.events.includes('abort'), false); await f.roundTrip(new Blob(target.parts), 'session-v4');
	});
});

test('public legacy Session V4 rejects a deferred nonnative writable without reading Originals', LEGACY_BACKUP_TEST_OPTIONS, async context => {
	await legacyBackupFixture(context, async f => {
		let opened = 0;
		await assert.rejects(f.run('session-v4', { signal: f.signal, createWritable: () => {
			opened++; const target = new WritableStream<Uint8Array>();
			Object.defineProperty(target, 'getWriter', { value: target.getWriter }); return Promise.resolve(target);
		} }));
		assert.equal(opened, 1); assert.equal(f.calls.originals, 0);
	});
});
