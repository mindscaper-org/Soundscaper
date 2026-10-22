/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { remainsPending } from './helpers/async-test-control.ts';
import { nativeWriterFixtureCurrentV1 as fixture, beginNativeWriterCurrentV1 as begin, nativeWriterInputCurrentV1 as input,
	writeNativeWriterInputCurrentV1 as writeAll, readNativeWriterOriginalCurrentV1 as read,
	holdNativeWriterFileWriteCurrentV1 as hold, observeNativeWriterCommitCurrentV1 as observe,
	exactNativeWriterFailureCurrentV1 as exactFailure } from './helpers/lightscaper-native-media-writer-integration-fixture-current.ts';

test('Lightscaper concurrent write refusal preserves the first held real native write and snapshots caller bytes', async () => {
	await fixture(async f => {
		const value = input(611, 1024 * 1024 + 257), writer = await begin(f.media, value.original.storageKey, value.metadata, value.options);
		await hold(f.appDataPath, async control => {
			const chunk = value.bytes.slice(0, 1024 * 1024), writing = writer.write(chunk); void writing.catch(() => undefined); chunk.fill(0);
			try {
				await Promise.race([control.entered, writing.then(() => { assert.fail('The real physical write was not held.'); })]);
				await assert.rejects(async () => { await writer.write(Uint8Array.of(9)); });
				assert.equal(await remainsPending(writing), true); control.release(); await writing;
				assert.equal(writer.bytesWritten, 1024 * 1024); await writer.write(value.bytes.subarray(1024 * 1024)); await writer.commit();
			} finally { control.release(); await writing.catch(() => undefined); await writer.abort(); }
		});
		assert.deepEqual(await read(f.media, value.original), value.bytes);
	});
});

test('Lightscaper queued begin captures complete expected binding and detached metadata before native file work resumes', async () => {
	await fixture(async f => {
		const value = input(612, 4096);
		await hold(f.appDataPath, async control => {
			const prior = f.media.writeAsset('writer-queue-blocker', new Blob([Uint8Array.of(1, 2, 3)])); void prior.catch(() => undefined);
			let writer: Awaited<ReturnType<typeof begin>> | undefined;
			try {
				await Promise.race([control.entered, prior.then(() => { assert.fail('The earlier genuine body write was not held.'); })]);
				const metadata = { ...value.metadata, descriptive: { nested: 'captured' } }, options = { ...value.options };
				const starting = begin(f.media, value.original.storageKey, metadata, options);
				metadata.name = 'mutated'; metadata.descriptive.nested = 'changed'; options.expectedBytes = 1; options.expectedSha256 = '0'.repeat(64);
				control.release(); await prior; writer = await starting; await writeAll(writer, value.bytes); const receipt = await writer.commit();
				assert.equal(receipt.name, value.metadata.name); assert.deepEqual(receipt.descriptive, { nested: 'captured' });
				assert.equal(receipt.sha256, value.options.expectedSha256); assert.equal(receipt.size, value.bytes.length);
			} finally { control.release(); await prior.catch(() => undefined); await writer?.abort(); }
		});
	});
});

test('Lightscaper aborting an idle escaped writer releases the actual Original queue for a queued ordinary write', async () => {
	await fixture(async f => {
		const value = input(613, 4096), writer = await begin(f.media, value.original.storageKey, value.metadata, value.options);
		const queued = f.media.writeAsset('after-idle-abort', new Blob([Uint8Array.of(4, 5, 6)])); void queued.catch(() => undefined);
		assert.equal(await remainsPending(queued), true); await writer.abort(); await writer.abort();
		assert.equal((await queued).sourceId, 'after-idle-abort'); assert.equal(await f.media.getAssetMetadata(value.original.storageKey), null);
	});
});

test('Lightscaper Close cancels an idle escaped writer before joining a queued ordinary write instead of deadlocking', async () => {
	await fixture(async f => {
		const value = input(614, 4096), writer = await begin(f.media, value.original.storageKey, value.metadata, value.options);
		const queued = f.media.writeAsset('closed-behind-idle', new Blob([Uint8Array.of(7, 8, 9)]));
		const outcome = queued.then(() => true, () => false), closing = f.media.close(); assert.equal(f.media.close(), closing);
		await closing; assert.equal(await outcome, false); await writer.abort();
		const reopened = await f.reopen(); assert.equal(await reopened.media.getAssetMetadata(value.original.storageKey), null);
		assert.equal(await reopened.media.getAssetMetadata('closed-behind-idle'), null);
	});
});

test('Lightscaper public abort and Close both join an actual held native write before physical stage retirement', async () => {
	await fixture(async f => {
		const value = input(615, 1024 * 1024), writer = await begin(f.media, value.original.storageKey, value.metadata, value.options);
		await hold(f.appDataPath, async control => {
			const writing = writer.write(value.bytes), outcome = writing.then(() => true, () => false); let aborted: Promise<void> | undefined, closing: Promise<void> | undefined;
			try {
				await Promise.race([control.entered, writing.then(() => { assert.fail('No actual held native write.'); })]);
				aborted = writer.abort(); closing = f.media.close();
				assert.equal(await remainsPending(writing), true); assert.equal(await remainsPending(aborted), true); assert.equal(await remainsPending(closing), true);
				control.release(); assert.equal(await outcome, false); await aborted; await closing;
			} finally { control.release(); await writing.catch(() => undefined); await aborted; await closing; }
		});
		const reopened = await f.reopen(); assert.equal(await reopened.media.getAssetMetadata(value.original.storageKey), null);
	});
});

test('Lightscaper actual streamed metadata COMMIT owns cached ACK through late opaque cancel abort and media Close', async () => {
	await fixture(async f => {
		const value = input(616, 4096), cancel = new AbortController(), writer = await begin(f.media, value.original.storageKey, value.metadata, { ...value.options, signal: cancel.signal });
		await writeAll(writer, value.bytes); let committed = false, traps = 0, closing: Promise<void> | undefined, aborting: Promise<void> | undefined;
		const reason = new Proxy({}, { get() { traps++; throw Error('Opaque commit reason get'); }, getPrototypeOf() { traps++; throw Error('Opaque commit reason prototype'); } });
		let committing: ReturnType<typeof writer.commit> | undefined;
		const receipt = await observe(f.originalDatabasePath, db => {
			if (committed || !db.prepare('SELECT source_id FROM native_photo_media_assets WHERE source_id=?').get(value.original.storageKey)) return;
			committed = true; cancel.abort(reason); aborting = writer.abort(); closing = f.media.close();
		}, () => { committing = writer.commit(); assert.equal(writer.commit(), committing); return committing; });
		assert.equal(committed, true); assert.equal(traps, 0); assert.ok(closing); await aborting; await closing;
		assert.equal(writer.commit(), committing); assert.deepEqual(await writer.commit({ signal: cancel.signal }), receipt);
		const reopened = await f.reopen(); assert.deepEqual(await reopened.media.getAssetMetadata(value.original.storageKey), receipt);
		assert.deepEqual(await read(reopened.media, value.original), value.bytes);
	});
});

test('Lightscaper native clone metadata getter Close reentry drains the already registered begin before actual owner retirement', async () => {
	await fixture(async f => {
		const value = input(617, 4096); let closing: Promise<void> | undefined, finished = false, closedFirst = false, captures = 0;
		const metadata = { get name() { captures++; closing = f.media.close(); void closing.then(() => { if (!finished) closedFirst = true; }); return 'captured before shutdown'; } };
		const starting = begin(f.media, value.original.storageKey, metadata, value.options);
		const outcome = starting.then(async writer => { finished = true; await writer.abort(); return true; }, () => { finished = true; return false; });
		assert.ok(closing); assert.equal(await outcome, false); await closing; assert.equal(captures, 1); assert.equal(closedFirst, false);
		const reopened = await f.reopen(); assert.equal(await reopened.media.getAssetMetadata(value.original.storageKey), null);
	});
});

test('Lightscaper closed-options Proxy reentry cannot retire the native owner before its accepted begin capture settles', async () => {
	await fixture(async f => {
		const value = input(618, 4096); let closing: Promise<void> | undefined, finished = false, closedFirst = false;
		const options = new Proxy(value.options, { ownKeys() { closing = f.media.close(); void closing.then(() => { if (!finished) closedFirst = true; }); throw Object.freeze({ capture: 'refused' }); } });
		const starting = begin(f.media, value.original.storageKey, value.metadata, options);
		const outcome = starting.then(async writer => { finished = true; await writer.abort(); return true; }, () => { finished = true; return false; });
		assert.ok(closing); assert.equal(await outcome, false); await closing; assert.equal(closedFirst, false);
	});
});

test('Lightscaper preaborted opaque begin refuses before borrowed metadata and preserves the exact reason without inspection', async () => {
	await fixture(async f => {
		const value = input(619, 4096), cancel = new AbortController(); let reasonTraps = 0, metadataTraps = 0;
		const reason = new Proxy({}, { get() { reasonTraps++; throw Error('Opaque begin get'); }, getPrototypeOf() { reasonTraps++; throw Error('Opaque begin prototype'); } });
		const metadata = new Proxy({}, { ownKeys() { metadataTraps++; throw Error('Aborted metadata'); }, get() { metadataTraps++; throw Error('Aborted metadata get'); } });
		cancel.abort(reason); await exactFailure(begin(f.media, value.original.storageKey, metadata, { ...value.options, signal: cancel.signal }), reason);
		assert.equal(reasonTraps, 0); assert.equal(metadataTraps, 0);
	});
});

test('Lightscaper per-write opaque native cancellation wins before inspecting borrowed chunk data and retires the stream', async () => {
	await fixture(async f => {
		const value = input(620, 4096), writer = await begin(f.media, value.original.storageKey, value.metadata, value.options), cancel = new AbortController(); let traps = 0;
		const reason = new Proxy({}, { get() { traps++; throw Error('Opaque write get'); }, getPrototypeOf() { traps++; throw Error('Opaque write prototype'); } });
		const bytes = new Proxy({}, { get() { traps++; throw Error('Cancelled input get'); }, getPrototypeOf() { traps++; throw Error('Cancelled input prototype'); } });
		cancel.abort(reason);
		let failed = false; try { await Reflect.apply(writer.write, writer, [bytes, { signal: cancel.signal }]); } catch (error) { failed = true; assert.equal(error, reason); }
		assert.equal(failed, true); assert.equal(traps, 0); await writer.abort(); assert.equal(await f.media.getAssetMetadata(value.original.storageKey), null);
	});
});

test('Lightscaper owner and aborted writer frontdoors refuse after close before inspecting borrowed inputs or options', async () => {
	await fixture(async f => {
		const value = input(621, 4096), writer = await begin(f.media, value.original.storageKey, value.metadata, value.options); await writer.abort(); await f.media.close(); let traps = 0;
		const borrowed = new Proxy({}, { get() { traps++; throw Error('Closed get'); }, ownKeys() { traps++; throw Error('Closed ownKeys'); }, getPrototypeOf() { traps++; throw Error('Closed prototype'); } });
		const method: unknown = Reflect.get(f.media, 'beginAssetWrite'); assert.equal(typeof method, 'function');
		await assert.rejects(Reflect.apply(method as (...args: unknown[]) => Promise<unknown>, f.media, [borrowed, borrowed, borrowed]));
		await assert.rejects(async () => { await Reflect.apply(writer.write, writer, [borrowed, borrowed]); });
		await assert.rejects(async () => { await Reflect.apply(writer.commit, writer, [borrowed]); });
		await writer.abort(); assert.equal(traps, 0);
	});
});

test('Lightscaper commit joins an accepted held real write before closing the producer and publishing metadata', async () => {
	await fixture(async f => {
		const value = input(622, 4096), writer = await begin(f.media, value.original.storageKey, value.metadata, value.options);
		await hold(f.appDataPath, async control => {
			const writing = writer.write(value.bytes); void writing.catch(() => undefined); let committing: ReturnType<typeof writer.commit> | undefined;
			try {
				await Promise.race([control.entered, writing.then(() => { assert.fail('No held physical write before commit.'); })]);
				committing = writer.commit(); void committing.catch(() => undefined); assert.equal(writer.commit(), committing);
				assert.equal(await remainsPending(committing), true); control.release(); await writing;
				assert.equal((await committing).sha256, value.options.expectedSha256);
			} finally { control.release(); await writing.catch(() => undefined); await committing?.catch(() => undefined); await writer.abort(); }
		});
		assert.deepEqual(await read(f.media, value.original), value.bytes);
	});
});

test('Lightscaper preaborted per-commit opaque reason prevents metadata publication while all accepted stream work retires', async () => {
	await fixture(async f => {
		const value = input(623, 4096), writer = await begin(f.media, value.original.storageKey, value.metadata, value.options), cancel = new AbortController(); let traps = 0;
		await writeAll(writer, value.bytes);
		const reason = new Proxy({}, { get() { traps++; throw Error('Opaque per-commit get'); }, getPrototypeOf() { traps++; throw Error('Opaque per-commit prototype'); } });
		cancel.abort(reason); await exactFailure(writer.commit({ signal: cancel.signal }), reason); await writer.abort();
		assert.equal(traps, 0); assert.equal(await f.media.getAssetMetadata(value.original.storageKey), null);
	});
});

test('Lightscaper caller cancellation remains linked after begin returns and releases an idle stream for queued ordinary work', async () => {
	await fixture(async f => {
		const value = input(624, 4096), cancel = new AbortController(), writer = await begin(f.media, value.original.storageKey, value.metadata, { ...value.options, signal: cancel.signal }); let traps = 0;
		const reason = new Proxy({}, { get() { traps++; throw Error('Idle caller reason get'); }, getPrototypeOf() { traps++; throw Error('Idle caller reason prototype'); } });
		const queued = f.media.writeAsset('after-idle-caller-cancel', new Blob([Uint8Array.of(10, 11, 12)])); void queued.catch(() => undefined);
		assert.equal(await remainsPending(queued), true); cancel.abort(reason); await writer.abort(); assert.equal(traps, 0);
		assert.equal((await queued).sourceId, 'after-idle-caller-cancel'); assert.equal(await f.media.getAssetMetadata(value.original.storageKey), null);
	});
});
