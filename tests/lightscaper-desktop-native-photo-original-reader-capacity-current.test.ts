/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { open, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { registerLightscaperNativePhotoOriginalPinsCurrentV1 as register } from '../desktop/lightscaper-native-photo-original-read-pins-current-v1.ts';
import { nativeOriginalReaderFixtureCurrentV1 as fixture, Originals, Media, deferred } from './helpers/lightscaper-native-photo-original-reader-fixture-current.ts';

test('Lightscaper native Original pull capacity is four across actual same-namespace Media peers', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		const peers: Media[] = [], peerReaders: Originals[] = [];
		const witness = await open(join(f.appDataPath, 'capacity-native-read-witness'), 'wx');
		const prototype = Object.getPrototypeOf(witness) as object, descriptor = Object.getOwnPropertyDescriptor(prototype, 'read');
		assert.ok(descriptor && typeof descriptor.value === 'function'); const native = descriptor.value as FileHandle['read']; await witness.close();
		const held = deferred<void>(), releaseReads = deferred<void>(), releaseConsumers = deferred<void>();
		let reads = 0;
		Object.defineProperty(prototype, 'read', { ...descriptor, value: function (this: FileHandle, ...args: unknown[]) {
			const result = Reflect.apply(native, this, args) as ReturnType<FileHandle['read']>;
			return result.then(async value => { reads++; if (reads === 4) held.resolve(); await releaseReads.promise; return value; });
		} });
		const views: Array<{ read(offset: number, length: number): Promise<Uint8Array> }> = [];
		const consumers: Promise<unknown>[] = [], pulls: Promise<Uint8Array>[] = [];
		try {
			// A single OriginalStore serializes its physical reads. Separate real
			// Media owners are required to hold four actual FS receipts together.
			for (let index = 0; index < 4; index++) {
				const peer = await Media.open({ appDataPath: f.appDataPath }), controller = new AbortController(); peers.push(peer);
				peerReaders.push(Originals.create({ catalog: f.catalog, media: peer, settings: f.settings,
					scope: { signal: controller.signal, assertCurrent: () => { controller.signal.throwIfAborted(); } } }));
			}
			for (const reader of [f.reader, ...peerReaders]) {
				const entered = deferred<void>();
				const work = reader.withOriginal(f.request, async view => { views.push(view); entered.resolve(); await releaseConsumers.promise; });
				void work.catch(() => undefined); consumers.push(work); await entered.promise;
			}
			for (const view of views.slice(0, 4)) { const work = view.read(0, 1); void work.catch(() => undefined); pulls.push(work); }
			await held.promise; await assert.rejects(views[4]!.read(0, 1)); assert.equal(reads, 4);
			releaseReads.resolve(); assert.equal((await Promise.all(pulls)).length, 4);
			assert.equal((await views[4]!.read(0, 1)).byteLength, 1);
			releaseConsumers.resolve(); await Promise.all(consumers);
		} finally {
			releaseReads.resolve(); releaseConsumers.resolve(); await Promise.allSettled([...pulls, ...consumers]);
			Object.defineProperty(prototype, 'read', descriptor);
			for (const reader of peerReaders) await reader.close(); for (const peer of peers) await peer.close();
		}
	});
});

test('Lightscaper native Original consumer pins refuse4095 without allocating Photo documents', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		const first = register(f.database), second = register(f.database), pins: Array<{ release(): void }> = [];
		const row = f.database.prepare('SELECT media_content_token FROM native_photo_media_assets WHERE source_id=?').get(f.entry.original.storageKey);
		assert.ok(row && typeof row.media_content_token === 'string');
		try {
			for (let index = 0; index < 4094; index++) pins.push(first.pin(f.entry.original.storageKey, row.media_content_token));
			assert.throws(() => second.pin(f.entry.original.storageKey, row.media_content_token as string));
			pins.pop()!.release(); const replacement = second.pin(f.entry.original.storageKey, row.media_content_token); replacement.release();
		} finally { for (const pin of pins) pin.release(); await first.close(); await second.close(); }
	});
});

test('Lightscaper native Media close retires unused escaped read reservations before reopening capacity', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		const peer = await Media.open({ appDataPath: f.appDataPath }), unused = Array.from({ length: 4 }, () => peer.reserveOriginalRead());
		await peer.close();
		const reopened = await Media.open({ appDataPath: f.appDataPath }), next: Array<{ release(): void }> = [];
		try { for (let index = 0; index < 4; index++) next.push(reopened.reserveOriginalRead()); }
		finally { for (const reservation of unused) reservation.release(); for (const reservation of next) reservation.release(); await reopened.close(); }
	});
});
