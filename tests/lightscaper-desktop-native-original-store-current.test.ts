/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { LightscaperNativeOriginalStoreCurrentV1 } from '../desktop/lightscaper-native-original-store-current-v1.ts';
import { deriveLightscaperNativePhotoOriginalPathsCurrentV1, lightscaperNativePhotoOriginalBodyPathCurrentV1 } from '../desktop/lightscaper-native-original-index-current-v1.ts';
import { LIGHTSCAPER_NATIVE_ORIGINAL_CHUNK_BYTES_CURRENT_V1, readLightscaperNativeOriginalCurrentV1 } from '../desktop/lightscaper-native-original-contract-current-v1.ts';
import type { PhotoOriginalV1 } from '../src/lightscaper/catalog/types.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

// These bytes exercise custody, not a codec. Persistence must never infer a
// decoded image or HDR provenance merely from descriptor metadata.
const PAYLOAD = Buffer.from('Exact managed Original byte fixture Ω: native filesystem custody.');
function original(bytes: Uint8Array = PAYLOAD, changed: Record<string, unknown> = {}): Readonly<PhotoOriginalV1> {
	return readLightscaperNativeOriginalCurrentV1({ schemaVersion: 1, kind: 'still', id: 'source-1', name: 'Original Ω.png',
		mimeType: 'image/png', storageKey: 'original-1', contentSha256: createHash('sha256').update(bytes).digest('hex'),
		width: 1, height: 1, hasAlpha: false, byteLength: bytes.byteLength, retention: 'managed', ...changed });
}
async function* chunks(bytes: Uint8Array, size = 7): AsyncGenerator<Uint8Array> {
	for (let offset = 0; offset < bytes.byteLength; offset += size) yield bytes.subarray(offset, Math.min(bytes.byteLength, offset + size));
}
async function owned(run: (store: LightscaperNativeOriginalStoreCurrentV1, appDataPath: string) => Promise<void>): Promise<void> {
	const appDataPath = await mkdtemp(join(tmpdir(), 'lightscaper native originals ü '));
	let store: LightscaperNativeOriginalStoreCurrentV1 | undefined;
	try { store = await LightscaperNativeOriginalStoreCurrentV1.open({ appDataPath }); await run(store, appDataPath); }
	finally { await store?.close(); await rm(appDataPath, { recursive: true, force: true }); }
}

test('Lightscaper native Original streamed bytes and SQLite binding survive close and reopen', async () => {
	await owned(async (store, appDataPath) => {
		const descriptor = original(), stored = await store.store(descriptor, chunks(PAYLOAD));
		assert.deepEqual(stored, descriptor); await store.verify(descriptor);
		assert.deepEqual(await store.read(descriptor, 2, 9), new Uint8Array(PAYLOAD.subarray(2, 11)));
		const path = lightscaperNativePhotoOriginalBodyPathCurrentV1(deriveLightscaperNativePhotoOriginalPathsCurrentV1(appDataPath), descriptor.contentSha256);
		assert.deepEqual(await readFile(path), PAYLOAD);
		await store.close();
		const reopened = await LightscaperNativeOriginalStoreCurrentV1.open({ appDataPath });
		try { await reopened.verify(descriptor); assert.deepEqual(await reopened.read(descriptor, 0, PAYLOAD.length), new Uint8Array(PAYLOAD)); }
		finally { await reopened.close(); }
	});
});

test('Lightscaper native Original deduplication preserves caller metadata aliases over one exact physical binding', async () => {
	await owned(async (store) => {
		const first = original(), alias = original(PAYLOAD, { id: 'source-2', name: 'Another exact name.png' });
		await store.store(first, chunks(PAYLOAD));
		assert.deepEqual(await store.store(alias, chunks(PAYLOAD)), alias);
		await store.verify(alias); assert.deepEqual(await store.read(alias, 0, PAYLOAD.length), new Uint8Array(PAYLOAD));
		const different = Buffer.from(PAYLOAD); different[0] = different[0]! ^ 1;
		await assert.rejects(store.store(original(different), chunks(different)));
		await assert.rejects(store.store(original(PAYLOAD.subarray(1)), chunks(PAYLOAD.subarray(1))));
		await store.verify(first);
	});
});

test('Lightscaper native Original same-key concurrent conflicting streams cannot overwrite their winner', async () => {
	await owned(async store => {
		const other = Buffer.from(PAYLOAD); other[0] = other[0]! ^ 1;
		const inputs = [original(), original(other)], bytes = [PAYLOAD, other];
		const results = await Promise.allSettled(inputs.map((descriptor, index) => store.store(descriptor, chunks(bytes[index]!))));
		assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
		assert.equal(results.filter(value => value.status === 'rejected').length, 1);
		const index = results.findIndex(value => value.status === 'fulfilled');
		await store.verify(inputs[index]!);
		assert.deepEqual(await store.read(inputs[index]!, 0, PAYLOAD.length), new Uint8Array(bytes[index]!));
	});
});

test('Lightscaper native Original queued writes retain their admitted descriptor before caller mutation', async () => {
	await owned(async store => {
		const entered = deferred<void>(), release = deferred<void>();
		async function* held(): AsyncGenerator<Uint8Array> { entered.resolve(); await release.promise; yield PAYLOAD; }
		const first = store.store(original(), held());
		let queued: Promise<Readonly<PhotoOriginalV1>> | undefined;
		try {
			await entered.promise;
			const expected = original(PAYLOAD, { id: 'source-queued', name: 'Admitted name.png', storageKey: 'original-queued' });
			const mutable = { ...expected };
			queued = store.store(mutable, chunks(PAYLOAD));
			mutable.id = 'source-changed'; mutable.name = 'Changed later.png'; mutable.storageKey = 'original-changed';
			release.resolve(); await first;
			assert.deepEqual(await queued, expected);
			await store.verify(expected);
			await assert.rejects(store.verify(mutable));
		} finally {
			release.resolve(); await Promise.allSettled([first, ...(queued ? [queued] : [])]);
		}
	});
});

test('Lightscaper native Original admission registers work before a descriptor triggers reentrant close', async () => {
	await owned(async store => {
		const entered = deferred<void>(), release = deferred<void>();
		async function* held(): AsyncGenerator<Uint8Array> { entered.resolve(); await release.promise; yield PAYLOAD; }
		let closing: Promise<void> | undefined;
		const value = new Proxy({ ...original() }, { ownKeys(target) { closing ??= store.close(); return Reflect.ownKeys(target); } });
		const work = store.store(value, held());
		try {
			await Promise.race([entered.promise, work.then(() => { throw new Error('Write completed before producer admission.'); })]);
			assert.ok(closing); assert.equal(await remainsPending(closing), true);
			release.resolve(); assert.deepEqual(await work, original()); await closing;
		} finally { release.resolve(); await Promise.allSettled([work, ...(closing ? [closing] : [])]); }
	});
});

test('Lightscaper native Original failed short, long and corrupt streams publish no physical binding', async () => {
	for (const variant of ['short', 'long', 'digest'] as const) {
		await owned(async (store, appDataPath) => {
			const descriptor = original();
			const bytes = variant === 'short' ? PAYLOAD.subarray(1) : variant === 'long' ? Buffer.concat([PAYLOAD, Buffer.of(1)]) : Buffer.alloc(PAYLOAD.length, 7);
			await assert.rejects(store.store(descriptor, chunks(bytes))); await assert.rejects(store.verify(descriptor));
			const paths = deriveLightscaperNativePhotoOriginalPathsCurrentV1(appDataPath);
			assert.deepEqual(await readdir(paths.stagingRoot), []);
			await assert.rejects(readFile(lightscaperNativePhotoOriginalBodyPathCurrentV1(paths, descriptor.contentSha256)), { code: 'ENOENT' });
		});
	}
});

test('Lightscaper native Original writer refuses oversized and non-byte chunks and retires the producer', async () => {
	for (const value of [new Uint8Array(LIGHTSCAPER_NATIVE_ORIGINAL_CHUNK_BYTES_CURRENT_V1 + 1), new DataView(new ArrayBuffer(8))]) {
		await owned(async (store, appDataPath) => {
			let returned = false;
			async function* bad(): AsyncGenerator<unknown> { try { yield value; } finally { returned = true; } }
			await assert.rejects(store.store(original(), bad() as unknown as AsyncIterable<Uint8Array>));
			assert.equal(returned, true);
			assert.deepEqual(await readdir(deriveLightscaperNativePhotoOriginalPathsCurrentV1(appDataPath).stagingRoot), []);
		});
	}
});

test('Lightscaper native Original writer accepts a reused producer buffer without retaining prior chunks', async () => {
	await owned(async store => {
		const bytes = Uint8Array.of(1, 2, 3, 4, 5, 6), reusable = new Uint8Array(3);
		async function* produce(): AsyncGenerator<Uint8Array> {
			reusable.set(bytes.subarray(0, 3)); yield reusable;
			reusable.set(bytes.subarray(3)); yield reusable;
			reusable.fill(0);
		}
		const descriptor = original(bytes); await store.store(descriptor, produce());
		assert.deepEqual(await store.read(descriptor, 0, bytes.length), bytes);
	});
});

test('Lightscaper native Original pre-abort refuses work before acquiring its producer', async () => {
	await owned(async store => {
		const controller = new AbortController(); controller.abort(); let opened = false;
		const source: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]() { opened = true; return chunks(PAYLOAD); } };
		await assert.rejects(store.store(original(), source, { signal: controller.signal })); assert.equal(opened, false);
	});
});

test('Lightscaper native Original abort and close join a held next result and fence all new admission', { timeout: 10_000 }, async () => {
	await owned(async store => {
		const entered = deferred<void>(), release = deferred<IteratorResult<Uint8Array>>();
		const controller = new AbortController(); let calls = 0, returned = false;
		const source: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]() { return {
			next() { if (calls++ === 0) { entered.resolve(); return release.promise; } return Promise.resolve({ done: true as const, value: undefined }); },
			return() { returned = true; return Promise.resolve({ done: true as const, value: undefined }); },
		}; } };
		const work = store.store(original(), source, { signal: controller.signal }), refused = assert.rejects(work);
		let closing: Promise<void> | undefined;
		try {
			await Promise.race([entered.promise, work.then(() => { throw new Error('Writer completed before producer admission.'); }, (error: unknown) => { throw error; })]);
			controller.abort(); closing = store.close();
			assert.equal(await remainsPending(work), true); assert.equal(await remainsPending(closing), true);
			await assert.rejects(store.verify(original())); await assert.rejects(store.read(original(), 0, 1));
			release.resolve({ done: false, value: new Uint8Array(PAYLOAD) });
			await refused; await closing; assert.equal(returned, true); await store.close();
		} finally { release.resolve({ done: false, value: new Uint8Array(PAYLOAD) }); await refused; await closing; }
	});
});

test('Lightscaper native Original read verifies actual file bytes and refuses same-length corruption and missing files', async () => {
	await owned(async (store, appDataPath) => {
		const descriptor = original(); await store.store(descriptor, chunks(PAYLOAD)); await store.verify(descriptor);
		const path = lightscaperNativePhotoOriginalBodyPathCurrentV1(deriveLightscaperNativePhotoOriginalPathsCurrentV1(appDataPath), descriptor.contentSha256);
		await chmod(path, 0o600); await writeFile(path, Buffer.alloc(PAYLOAD.length, 7));
		await assert.rejects(store.verify(descriptor)); await assert.rejects(store.read(descriptor, 0, 1));
		await rm(path); await assert.rejects(store.verify(descriptor));
	});
});

test('Lightscaper native Original range reader enforces scalar bounds and the one-MiB response ceiling', async () => {
	await owned(async store => {
		const bytes = Buffer.alloc(LIGHTSCAPER_NATIVE_ORIGINAL_CHUNK_BYTES_CURRENT_V1 + 1, 42), descriptor = original(bytes);
		await store.store(descriptor, chunks(bytes, LIGHTSCAPER_NATIVE_ORIGINAL_CHUNK_BYTES_CURRENT_V1));
		assert.equal((await store.read(descriptor, 1, LIGHTSCAPER_NATIVE_ORIGINAL_CHUNK_BYTES_CURRENT_V1)).length, LIGHTSCAPER_NATIVE_ORIGINAL_CHUNK_BYTES_CURRENT_V1);
		for (const [offset, length] of [[-1, 1], [0.5, 1], [0, 0], [0, 1.5], [0, bytes.length], [bytes.length, 1], [Number.MAX_SAFE_INTEGER, 1]]) {
			await assert.rejects(store.read(descriptor, offset!, length!));
		}
	});
});

test('Lightscaper native Original refuses a symlinked digest target without touching the foreign file', { skip: process.platform === 'win32' }, async () => {
	await owned(async (store, appDataPath) => {
		const descriptor = original(), paths = deriveLightscaperNativePhotoOriginalPathsCurrentV1(appDataPath);
		const path = lightscaperNativePhotoOriginalBodyPathCurrentV1(paths, descriptor.contentSha256), outside = join(appDataPath, 'foreign-original');
		await writeFile(outside, PAYLOAD); await mkdir(dirname(path), { recursive: true }); await symlink(outside, path);
		await assert.rejects(store.store(descriptor, chunks(PAYLOAD))); assert.deepEqual(await readFile(outside), PAYLOAD);
	});
});
