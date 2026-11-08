/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { nativeTicketTestCurrentV1 as test, holdTicketFileReadCurrentV1 as holdRead } from './helpers/lightscaper-native-photo-original-ticket-fixture-current.ts';
import { nativeSessionLeaseFixtureCurrentV1 as fixture, sessionLeaseShaCurrentV1 as sha, remainsPending, Scopes } from './helpers/lightscaper-native-session-lease-integration-fixture-current.ts';

for (const grouped of [false, true]) void test(`Native selected ${grouped ? 'group' : 'single'} File consumer retires before Main ticket and physical generation`, { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		const entered = f.gate(), release = f.gate(); let closing: Promise<void> | undefined;
		const work = f.withOriginal(async body => {
			assert.ok(body instanceof Blob); const bytes = new Uint8Array(await body.arrayBuffer());
			try { assert.equal(sha(bytes), sha(f.bytes)); entered.release(); await release.promise; assert.equal(sha(bytes), sha(f.bytes)); }
			finally { bytes.fill(0); }
		}, grouped); void work.catch(() => undefined);
		try {
			await f.reached(entered.promise, work); closing = f.scopes.close(); assert.equal(f.scopes.close(), closing);
			assert.equal(f.lease.signal.aborted, true, 'Local stop is synchronous.');
			assert.equal(await remainsPending(closing), true); assert.equal(f.events.includes('local-retired'), false);
			await f.provePinned();
			release.release(); await assert.rejects(work); await closing;
			assert.equal(f.events.includes('local-retired'), true); assert.equal(f.storage.counts().stages, 0);
			const reopened = await Scopes.open({ appDataPath: f.directory }); try { await reopened.openSelected({ name: 'Existing selected storage' }); } finally { await reopened.close(); }
		} finally { release.release(); await Promise.allSettled([work, ...(closing ? [closing] : [])]); }
	});
});

for (const family of ['lut', 'brush'] as const) void test(`Native selected ${family} callback joins before its private bytes and Resources retire`, { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		const entered = f.gate(), release = f.gate(); let borrowed: Uint8Array | undefined, closing: Promise<void> | undefined;
		const lut = await f.components.resources.cubeLutResources(), brush = await f.components.resources.maskRasterResources();
		const consume = async (bytes: Uint8Array): Promise<void> => {
			borrowed = bytes; const expected = family === 'lut' ? f.resource.lut.bytes : f.resource.brushes[0]!.bytes;
			assert.equal(sha(bytes), sha(expected)); entered.release(); await release.promise; assert.equal(sha(bytes), sha(expected));
		};
		const work = f.operation(signal => family === 'lut'
			? lut.source.withBytes(f.resource.lut.reference, consume, { signal })
			: brush.source.withBytes(f.resource.brushes[0]!.reference, consume, { signal })); void work.catch(() => undefined);
		try {
			await f.reached(entered.promise, work); closing = f.scopes.close(); assert.equal(await remainsPending(closing), true);
			assert.equal(f.events.includes('local-retired'), false); assert.ok(borrowed); assert.equal(borrowed.some(value => value !== 0), true);
			release.release(); await assert.rejects(work); await closing;
			assert.equal(borrowed.every(value => value === 0), true, 'Real resource private bytes wipe only after the held callback settles.');
		} finally { release.release(); await Promise.allSettled([work, ...(closing ? [closing] : [])]); }
	});
});

void test('Native selected local retirement joins a held actual FileHandle pull before physical owner close', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		await holdRead(f.directory, async control => {
			let closing: Promise<void> | undefined;
			const work = f.withOriginal(async body => { const bytes = new Uint8Array(await body.arrayBuffer()); try { assert.equal(sha(bytes), sha(f.bytes)); } finally { bytes.fill(0); } });
			void work.catch(() => undefined);
			try {
				await f.reached(control.entered, work); closing = f.scopes.close(); assert.equal(await remainsPending(closing), true);
				control.release(); await assert.rejects(work); await closing; assert.equal(f.events.includes('local-retired'), true);
			} finally { control.release(); await Promise.allSettled([work, ...(closing ? [closing] : [])]); }
		});
	});
});

void test('Native selected user close and manager close converge without Session closeResources awaiting native close', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		const entered = f.gate(), release = f.gate(); let closing: Promise<void> | undefined, manager: Promise<void> | undefined;
		const work = f.withOriginal(async () => { entered.release(); await release.promise; }); void work.catch(() => undefined);
		try {
			await f.reached(entered.promise, work); closing = f.lease.close(); assert.equal(f.lease.close(), closing);
			assert.equal(f.components.close(), closing); manager = f.scopes.close();
			assert.equal(await remainsPending(closing), true); assert.equal(await remainsPending(manager), true);
			release.release(); await assert.rejects(work); await Promise.all([closing, manager]); assert.equal(f.counts().localCloses, 1);
		} finally { release.release(); await Promise.allSettled([work, ...(closing ? [closing] : []), ...(manager ? [manager] : [])]); }
	});
});

void test('Native selected stop quiesces its idle escaped writer before joining a normal write queued behind its real producer', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		const writer = await f.components.media.beginAssetWrite('lease-idle-producer', {}, { expectedBytes: 1, expectedSha256: sha(Uint8Array.of(9)) });
		const work = f.operation(signal => f.components.media.writeAsset('lease-queued-asset', new Blob([Uint8Array.of(7)]), {}, { signal }));
		void work.catch(() => undefined); let closing: Promise<void> | undefined;
		const cancel = (): void => { void writer.abort().catch(() => undefined); };
		context.signal.addEventListener('abort', cancel, { once: true }); if (context.signal.aborted) cancel();
		try {
			assert.equal(await remainsPending(work), true); closing = f.scopes.close(); await closing; context.signal.throwIfAborted();
			await assert.rejects(work); await assert.rejects(writer.write(Uint8Array.of(9))); assert.equal(f.events.includes('local-retired'), true);
		} finally { cancel(); await Promise.allSettled([writer.abort(), work, ...(closing ? [closing] : [])]); context.signal.removeEventListener('abort', cancel); }
	});
});
