/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { LightscaperNativeOriginalStreamCurrentV1 as Stream } from '../desktop/lightscaper-native-original-stream-current-v1.ts';
import { LightscaperNativeOriginalStoreCurrentV1 as Originals, consumeLightscaperNativeOriginalPublicationCurrentV1 as consume } from '../desktop/lightscaper-native-original-store-current-v1.ts';
import { lightscaperNativePhotoOriginalBodyPathCurrentV1 } from '../desktop/lightscaper-native-original-index-current-v1.ts';
import { deferred, remainsPending, waitFor } from './helpers/async-test-control.ts';
import { nativeStreamFixtureCurrentV1 as fixture, streamBindingCurrentV1 as binding, MiB,
	probeNativeStreamFilesCurrentV1 as probeFiles, opaqueStreamFailureCurrentV1 as opaque,
	exactStreamFailureCurrentV1 as exactFailure } from './helpers/lightscaper-native-original-stream-fixture-current.ts';

function absent(db: Parameters<typeof consume>[1]): void { assert.equal(db.prepare('SELECT storage_key FROM native_photo_original_bindings').get(), undefined); }

test('Lightscaper native stream publishes actual four-MiB emissions as one-MiB physical writes and a genuine one-use proof', async () => {
	await fixture(async f => {
		const bytes = Uint8Array.from({ length: 4 * MiB + 17 }, (_, index) => index % 251), expected = binding(bytes);
		const lengths: number[] = [];
		await probeFiles(f.appDataPath, { write: async (actual, _bytes, length) => { lengths.push(length); return await actual(); } }, async () => {
			const stream = f.own(new Stream(f.originals, expected, new AbortController().signal));
			assert.equal(stream.maximumChunkBytes, 4 * MiB); assert.equal(stream.bytesWritten, 0);
			await stream.write(bytes.subarray(0, 4 * MiB)); await stream.write(bytes.subarray(4 * MiB));
			assert.equal(stream.bytesWritten, bytes.length); const proof = await stream.finish();
			f.db.exec('BEGIN IMMEDIATE'); assert.deepEqual(consume(proof, f.db), expected); f.db.exec('COMMIT');
			f.db.exec('BEGIN IMMEDIATE'); assert.throws(() => consume(proof, f.db)); f.db.exec('ROLLBACK');
			assert.deepEqual(new Uint8Array(await readFile(lightscaperNativePhotoOriginalBodyPathCurrentV1(f.paths, expected.contentSha256))), bytes);
			assert.ok(lengths.length >= 5); assert.ok(lengths.every(length => length > 0 && length <= MiB));
			assert.deepEqual(await readdir(f.paths.stagingRoot), []);
		});
	});
});

test('Lightscaper native stream acknowledges only actual consumed writes and snapshots Buffer input before waiting', { timeout: 10_000 }, async () => {
	await fixture(async f => {
		const payload = Buffer.alloc(MiB + 7, 73), expectedBytes = new Uint8Array(payload), entered = deferred<void>(), release = deferred<void>();
		const stream = f.own(new Stream(f.originals, binding(payload), new AbortController().signal)); let held = false;
		await probeFiles(f.appDataPath, { write: async actual => { if (!held) { held = true; entered.resolve(); await release.promise; } return await actual(); } }, async () => {
			const write = stream.write(payload); payload.fill(9);
			try {
				await entered.promise; assert.equal(await remainsPending(write), true); assert.equal(stream.bytesWritten, 0);
				const untouched = new Proxy(new Uint8Array(1), { get() { throw new Error('Busy write touched borrowed input.'); } });
				await assert.rejects(stream.write(untouched), /progress|busy/i); assert.equal(await remainsPending(write), true);
				release.resolve(); await write; assert.equal(stream.bytesWritten, expectedBytes.length); await stream.finish();
				assert.deepEqual(await f.originals.readBinding(binding(expectedBytes), 0, MiB), expectedBytes.subarray(0, MiB));
				assert.ok(payload.every(value => value === 9), 'The borrowed Buffer must not be wiped or retained.');
			} finally { release.resolve(); await Promise.allSettled([write]); }
		});
	});
});

test('Lightscaper native stream finish joins an accepted held write and retains actual proof ACK after late abort', { timeout: 10_000 }, async () => {
	await fixture(async f => {
		const bytes = Uint8Array.of(4, 8, 15, 16, 23, 42), controller = new AbortController(), entered = deferred<void>(), release = deferred<void>();
		await probeFiles(f.appDataPath, { write: async actual => { entered.resolve(); await release.promise; return await actual(); } }, async () => {
			const stream = f.own(new Stream(f.originals, binding(bytes), controller.signal)), write = stream.write(bytes);
			const finishing = stream.finish(); assert.equal(stream.finish(), finishing);
			try {
				await entered.promise; assert.equal(await remainsPending(finishing), true); release.resolve(); await write;
				const proof = await finishing; controller.abort(opaque()); await stream.abort(); assert.equal(await stream.finish(), proof);
				await f.originals.verifyBinding(binding(bytes));
			} finally { release.resolve(); await Promise.allSettled([write, finishing]); }
		});
	});
});

for (const mode of ['short', 'digest'] as const) {
	test(`Lightscaper native stream ${mode} mismatch refuses actual physical authority and retires its stage`, async () => {
		await fixture(async f => {
			const bytes = Uint8Array.of(3, 5, 8, 13), expected = mode === 'digest' ? { ...binding(bytes), contentSha256: '0'.repeat(64) } : binding(bytes);
			const stream = f.own(new Stream(f.originals, expected, new AbortController().signal));
			await stream.write(mode === 'short' ? bytes.subarray(0, 3) : bytes);
			await assert.rejects(stream.finish(), /length|SHA-256|binding/i); absent(f.db); assert.deepEqual(await readdir(f.paths.stagingRoot), []);
			await assert.rejects(stream.write(bytes));
		});
	});
}

for (const mode of ['too-large', 'overrun', 'foreign', 'detached'] as const) {
	test(`Lightscaper native stream ${mode} emission fails without retaining queued bytes or publishing a binding`, async () => {
		await fixture(async f => {
			const bytes = Uint8Array.of(1, 2, 3), stream = f.own(new Stream(f.originals, binding(bytes), new AbortController().signal));
			let input: Uint8Array = mode === 'too-large' ? new Uint8Array(4 * MiB + 1) : mode === 'overrun' ? new Uint8Array(4) : new Uint8Array(3);
			if (mode === 'foreign') input = new DataView(new ArrayBuffer(3)) as unknown as Uint8Array;
			if (mode === 'detached') { const backing = new ArrayBuffer(3); input = new Uint8Array(backing); structuredClone(backing, { transfer: [backing] }); }
			await assert.rejects(stream.write(input)); await assert.rejects(stream.finish()); absent(f.db); assert.deepEqual(await readdir(f.paths.stagingRoot), []);
		});
	});
}

test('Lightscaper native stream uses native byte access rather than borrowed Uint8Array shadows', async () => {
	await fixture(async f => {
		const bytes = Uint8Array.of(11, 29, 71), input = new Uint8Array(bytes);
		for (const name of ['buffer', 'byteLength', 'byteOffset', 'length', Symbol.iterator]) Object.defineProperty(input, name, { get() { throw new Error('Borrowed typed-array shadow was read.'); } });
		const stream = f.own(new Stream(f.originals, binding(bytes), new AbortController().signal));
		await stream.write(new Uint8Array(0)); await stream.write(input); await stream.finish(); assert.equal(stream.bytesWritten, bytes.length);
		assert.deepEqual(await f.originals.readBinding(binding(bytes), 0, bytes.length), bytes);
	});
});

test('Lightscaper native idle stream abort settles its pending producer and joins actual OriginalStore retirement', { timeout: 10_000 }, async () => {
	await fixture(async f => {
		const stream = f.own(new Stream(f.originals, binding(Uint8Array.of(1)), new AbortController().signal));
		await waitFor(async () => (await readdir(f.paths.stagingRoot)).length === 1, 'native stream idle stage');
		const stopping = stream.abort(); assert.equal(stream.abort(), stopping);
		await Promise.all([stopping, f.originals.close()]);
		await assert.rejects(stream.finish()); absent(f.db); assert.deepEqual(await readdir(f.paths.stagingRoot), []);
	});
});

test('Lightscaper native caller abort joins a held physical write and OriginalStore close without inspecting its reason', { timeout: 10_000 }, async () => {
	await fixture(async f => {
		const bytes = Uint8Array.of(7, 9, 13), controller = new AbortController(), reason = opaque(), entered = deferred<void>(), release = deferred<void>();
		await probeFiles(f.appDataPath, { write: async actual => { entered.resolve(); await release.promise; return await actual(); } }, async () => {
			const stream = f.own(new Stream(f.originals, binding(bytes), controller.signal)), writing = stream.write(bytes);
			const observed = exactFailure(writing, reason);
			try {
				await entered.promise; controller.abort(reason); const stopping = stream.abort(), closing = f.originals.close();
				assert.equal(await remainsPending(writing), true); assert.equal(await remainsPending(stopping), true); assert.equal(await remainsPending(closing), true);
				release.resolve(); await observed; await stopping; await closing; absent(f.db); assert.deepEqual(await readdir(f.paths.stagingRoot), []);
				await exactFailure(stream.finish(), reason);
			} finally { release.resolve(); await observed; }
		});
	});
});

test('Lightscaper native stream preserves an opaque real file failure as the first error through write, finish and abort', async () => {
	await fixture(async f => {
		const bytes = Uint8Array.of(2, 3, 5), reason = opaque();
		await probeFiles(f.appDataPath, { write: async () => { throw reason; } }, async () => {
			const stream = f.own(new Stream(f.originals, binding(bytes), new AbortController().signal));
			await exactFailure(stream.write(bytes), reason); await exactFailure(stream.finish(), reason); await exactFailure(stream.abort(), reason);
			absent(f.db); assert.deepEqual(await readdir(f.paths.stagingRoot), []);
		});
	});
});

test('Lightscaper native stream captures immutable binding before queue wait and rejects a forged OriginalStore receiver', async () => {
	await fixture(async f => {
		const bytes = Uint8Array.of(19, 23), value = { ...binding(bytes) }, stream = f.own(new Stream(f.originals, value, new AbortController().signal));
		value.storageKey = 'retargeted'; value.byteLength = 1; value.contentSha256 = '0'.repeat(64);
		await stream.write(bytes); await stream.finish(); await f.originals.verifyBinding(binding(bytes));
		assert.equal(f.db.prepare('SELECT storage_key FROM native_photo_original_bindings WHERE storage_key=?').get('retargeted'), undefined);
		assert.throws(() => new Stream(Object.create(Originals.prototype) as Originals, binding(bytes, 'forged'), new AbortController().signal));
		assert.throws(() => new Stream(new Proxy(f.originals, {}), binding(bytes, 'proxied'), new AbortController().signal));
	});
});
