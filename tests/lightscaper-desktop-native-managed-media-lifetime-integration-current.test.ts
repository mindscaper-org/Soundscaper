/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { open, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { managedMediaIntegrationFixtureCurrentV1 as fixture, observeManagedMediaIntegrationCommitCurrentV1 as observe,
	managedMediaIntegrationExactFailureCurrentV1 as exactFailure, managedMediaIntegrationReadCurrentV1 as read } from './helpers/lightscaper-native-managed-media-integration-fixture-current.ts';
import { managedMediaIntegrationInputsCurrentV1 as inputs } from './helpers/lightscaper-native-managed-media-integration-fixture-inputs-current.ts';

test('Lightscaper actual native asset admission captures borrowed metadata before asynchronous Blob/hash/file work', async () => {
	await fixture(async f => {
		const entry = (await inputs()).entries[0], metadata = { name: 'Captured.png', mimeType: 'image/png', lastModified: 17 };
		const writing = f.media.writeAsset(entry.photo.original.storageKey, entry.original, metadata);
		metadata.name = 'Mutated.png'; metadata.mimeType = 'application/octet-stream'; metadata.lastModified = 99;
		const queued = f.media.getAssetMetadata(entry.photo.original.storageKey), receipt = await writing;
		assert.equal(receipt.name, 'Captured.png'); assert.equal(receipt.mimeType, 'image/png'); assert.equal(receipt.lastModified, 17);
		assert.deepEqual(await queued, receipt); Reflect.set(receipt, 'name', 'Borrowed mutation');
		assert.equal((await f.media.getAssetMetadata(entry.photo.original.storageKey))?.name, 'Captured.png');
	});
});

test('Lightscaper Close aborts prepublication work but joins a held genuine native FileHandle write before retirement', async () => {
	await fixture(async f => {
		const entry = (await inputs()).entries[0], entered = deferred<void>(), release = deferred<void>();
		const witness = await open(join(f.appDataPath, 'native-handle-observer'), 'wx');
		const prototype = Object.getPrototypeOf(witness) as object, descriptor = Object.getOwnPropertyDescriptor(prototype, 'write');
		assert.ok(descriptor && typeof descriptor.value === 'function'); const write = descriptor.value as FileHandle['write']; await witness.close();
		let held = false, writing: Promise<unknown> | undefined, closing: Promise<void> | undefined;
		Object.defineProperty(prototype, 'write', { ...descriptor, value: function (this: FileHandle, ...args: unknown[]) {
			const native = Reflect.apply(write, this, args) as ReturnType<FileHandle['write']>;
			return native.then(async result => { if (!held) { held = true; entered.resolve(); await release.promise; } return result; });
		} });
		try {
			writing = f.media.writeAsset(entry.photo.original.storageKey, entry.original, { name: entry.photo.original.name, mimeType: entry.photo.original.mimeType });
			const outcome = writing.then(() => ({ ok: true }), () => ({ ok: false }));
			await Promise.race([entered.promise, writing.then(() => { assert.fail('Actual body write was never observed.'); })]);
			closing = f.media.close(); assert.equal(f.media.close(), closing);
			assert.equal(await remainsPending(writing), true); assert.equal(await remainsPending(closing), true);
			release.resolve(); assert.equal((await outcome).ok, false); await closing;
		} finally {
			release.resolve(); await writing?.catch(() => undefined); Object.defineProperty(prototype, 'write', descriptor); await closing;
		}
		const reopened = await f.reopen(); assert.equal(await reopened.media.getAssetMetadata(entry.photo.original.storageKey), null);
		await assert.rejects(reopened.media.verifyOriginal(entry.photo.original));
	});
});

test('Lightscaper preaborted opaque media request refuses before borrowed metadata reflection and retains its native reason', async () => {
	await fixture(async f => {
		const entry = (await inputs()).entries[0], cancel = new AbortController(); let reasonTraps = 0, metadataTraps = 0;
		const reason = new Proxy({}, { get() { reasonTraps++; throw Error('Opaque get'); }, getPrototypeOf() { reasonTraps++; throw Error('Opaque prototype'); } });
		const metadata = new Proxy({}, { ownKeys() { metadataTraps++; throw Error('Aborted metadata'); }, get() { metadataTraps++; throw Error('Aborted metadata get'); } });
		cancel.abort(reason);
		await exactFailure(f.media.writeAsset(entry.photo.original.storageKey, entry.original, metadata, { signal: cancel.signal }), reason);
		assert.equal(reasonTraps, 0); assert.equal(metadataTraps, 0); assert.equal(await f.media.getAssetMetadata(entry.photo.original.storageKey), null);
	});
});

test('Lightscaper capture Proxy Close reentry joins the admitted request before closing the actual database', async () => {
	await fixture(async f => {
		const entry = (await inputs()).entries[0]; let closing: Promise<void> | undefined, finished = false, closedFirst = false, traps = 0;
		const options = new Proxy({}, { ownKeys() {
			traps++; closing = f.media.close(); void closing.then(() => { if (!finished) closedFirst = true; }); throw Object.freeze({ capture: 'refused' });
		} });
		const work = Reflect.apply(f.media.writeAsset, f.media, [entry.photo.original.storageKey, entry.original, {}, options]) as Promise<unknown>;
		const outcome = work.then(() => { finished = true; return true; }, () => { finished = true; return false; });
		assert.ok(closing); assert.equal(f.media.close(), closing); assert.equal(await outcome, false); await closing;
		assert.ok(traps > 0); assert.equal(closedFirst, false);
		const reopened = await f.reopen(); assert.equal(await reopened.media.getAssetMetadata(entry.photo.original.storageKey), null);
	});
});

test('Lightscaper real metadata COMMIT ACK survives opaque cancellation and joined Close after the physical binding commit', async () => {
	await fixture(async f => {
		const entry = (await inputs()).entries[0], cancel = new AbortController(); let closing: Promise<void> | undefined, committed = false, traps = 0;
		const reason = new Proxy({}, { get() { traps++; throw Error('Opaque ACK get'); }, getPrototypeOf() { traps++; throw Error('Opaque ACK prototype'); } });
		const receipt = await observe(f.originalDatabasePath, database => {
			if (committed || !database.prepare('SELECT source_id FROM native_photo_media_assets WHERE source_id=?').get(entry.photo.original.storageKey)) return;
			committed = true; cancel.abort(reason); closing = f.media.close(); assert.equal(f.media.close(), closing);
		}, () => f.media.writeAsset(entry.photo.original.storageKey, entry.original, { name: entry.photo.original.name, mimeType: entry.photo.original.mimeType }, { signal: cancel.signal }));
		assert.equal(committed, true); assert.equal(traps, 0); assert.ok(closing); await closing;
		assert.equal(receipt.sha256, entry.photo.original.contentSha256); assert.equal(receipt.size, entry.bytes.length);
		const reopened = await f.reopen(); assert.deepEqual(await reopened.media.getAssetMetadata(entry.photo.original.storageKey), receipt);
		assert.deepEqual(await read(reopened.media, entry.photo.original), entry.bytes);
	});
});

test('Lightscaper closed native media fences all publication/read/custody frontdoors before borrowed reflection', async () => {
	await fixture(async f => {
		await f.media.close(); let traps = 0;
		const value = new Proxy({}, { get() { traps++; throw Error('Closed get'); }, ownKeys() { traps++; throw Error('Closed ownKeys'); }, getPrototypeOf() { traps++; throw Error('Closed prototype'); } });
		const methods: ReadonlyArray<readonly [object, (...args: never[]) => unknown, readonly unknown[]]> = [
			[f.media, f.media.writeAsset, ['asset', value, value]], [f.media, f.media.getAssetMetadata, [value]], [f.media, f.media.deleteAsset, [value]],
			[f.media, f.media.verifyOriginal, [value]], [f.media, f.media.readOriginal, [value, 0, 1]],
			[f.media.catalogOriginals, f.media.catalogOriginals.retain, ['catalog', value]], [f.media.catalogOriginals, f.media.catalogOriginals.stage, ['catalog', 'import', value]],
			[f.media.catalogOriginals, f.media.catalogOriginals.release, ['catalog', value]], [f.media.catalogOriginals, f.media.catalogOriginals.releaseStaged, ['catalog', 'import', value]],
			[f.media.catalogOriginals, f.media.catalogOriginals.promote, ['catalog', 'import', value]], [f.media.catalogOriginals, f.media.catalogOriginals.readPage, [value]],
			[f.media.catalogOriginals, f.media.catalogOriginals.findDigestPage, [value]],
		];
		for (const [receiver, method, args] of methods) await assert.rejects(Reflect.apply(method, receiver, args) as Promise<unknown>);
		assert.equal(traps, 0);
	});
});
