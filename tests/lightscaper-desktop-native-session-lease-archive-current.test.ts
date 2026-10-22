/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeSessionLeaseFixtureCurrentV1 as fixture, remainsPending } from './helpers/lightscaper-native-session-lease-integration-fixture-current.ts';

void test('Native selected close joins actual Current ZIP File read and source iterator before Main ticket/storage retirement', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		const descriptor = Object.getOwnPropertyDescriptor(Blob.prototype, 'arrayBuffer'); assert.ok(descriptor && typeof descriptor.value === 'function');
		const native = descriptor.value as Blob['arrayBuffer'], size = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!;
		const entered = f.gate(), release = f.gate(); let armed = false, held = false, readRetired = false, written = 0;
		let actualRead: Promise<ArrayBuffer> | undefined, work: Promise<unknown> | undefined, closing: Promise<void> | undefined;
		const acquireDescriptor = Object.getOwnPropertyDescriptor(f.source, 'acquire'); assert.ok(acquireDescriptor);
		const acquire = f.source.acquire;
		// The wrapper forwards genuine acquisition unchanged; arm only AFTER the
		// production source's complete stage SHA check, excluding setup reads.
		Object.defineProperty(f.source, 'acquire', { ...acquireDescriptor, value: async (...args: Parameters<typeof acquire>) => {
			const lease = await Reflect.apply(acquire, f.source, args) as Awaited<ReturnType<typeof acquire>>; armed = true; return lease;
		} });
		Object.defineProperty(Blob.prototype, 'arrayBuffer', { ...descriptor, value: function (this: Blob) {
			const read = Reflect.apply(native, this, []) as Promise<ArrayBuffer>;
			if (!armed || held || Reflect.apply(size, this, []) !== f.bytes.byteLength) return read;
			held = true; actualRead = read.then(async bytes => { entered.release(); await release.promise; readRetired = true; return bytes; }); return actualRead;
		} });
		try {
			const session = f.createSession(), writable = new WritableStream<Uint8Array>({ write(bytes) { written += bytes.byteLength; } });
			work = session.backupCatalog({ writable }); void work.catch(() => undefined); await f.reached(entered.promise, work);
			closing = f.scopes.close(); assert.equal(f.lease.signal.aborted, true); assert.equal(await remainsPending(closing), true);
			assert.equal(readRetired, false); assert.equal(f.events.includes('local-retired'), false); await f.provePinned();
			release.release(); await assert.rejects(work); await closing;
			assert.equal(readRetired, true); assert.equal(f.events.includes('local-retired'), true); assert.equal(f.storage.counts().stages, 0); assert.ok(written < 4 * 1024 * 1024);
		} finally {
			release.release(); await Promise.allSettled([...(work ? [work] : []), ...(actualRead ? [actualRead] : []), ...(closing ? [closing] : [])]);
			Object.defineProperty(Blob.prototype, 'arrayBuffer', descriptor); Object.defineProperty(f.source, 'acquire', acquireDescriptor);
		}
	});
});
