/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LightscaperNativeOriginalStoreCurrentV1 } from '../desktop/lightscaper-native-original-store-current-v1.ts';
import { deriveLightscaperNativePhotoOriginalPathsCurrentV1 } from '../desktop/lightscaper-native-original-index-current-v1.ts';
import { readLightscaperNativeOriginalCurrentV1 } from '../desktop/lightscaper-native-original-contract-current-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const bytes = Uint8Array.of(1, 2, 3);
function original() {
	return readLightscaperNativeOriginalCurrentV1({ schemaVersion: 1, kind: 'still', id: 'source-1', name: 'Original.png',
		mimeType: 'image/png', storageKey: 'original-1', contentSha256: createHash('sha256').update(bytes).digest('hex'),
		width: 1, height: 1, hasAlpha: false, byteLength: bytes.length, retention: 'managed' });
}
async function caught(operation: Promise<unknown>): Promise<unknown> {
	try { await operation; return undefined; } catch (error) { return error; }
}
function leaves(error: unknown): unknown[] {
	return error instanceof AggregateError ? (error.errors as unknown[]).flatMap(leaves) : [error];
}

// These controlled producers own no external handles. The assertions first
// prove product-owned staging retention; only then does the test harness join
// every injected callback/store close and remove its private diagnostic root.
test('Lightscaper native Original overlong body preserves both primary and rejected producer retirement', async () => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'lightscaper return failure '));
	const store = await LightscaperNativeOriginalStoreCurrentV1.open({ appDataPath });
	const retirement = new Error('owned return failed'); let returns = 0;
	const source: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]() { return {
		next() { return Promise.resolve({ done: false as const, value: Uint8Array.of(1, 2, 3, 4) }); },
		return() { returns++; return Promise.reject(retirement); },
	}; } };
	let checked = false;
	try {
		const error = await caught(store.store(original(), source));
		assert.ok(error instanceof AggregateError, 'The primary body error must not mask failed producer retirement.');
		const failures = leaves(error); assert.ok(failures.includes(retirement));
		assert.ok(failures.some(value => value instanceof RangeError), 'The overlong-body primary error remains observable.');
		assert.equal(returns, 1);
		const closeError = await caught(store.close()); assert.deepEqual(new Set(leaves(closeError)), new Set([retirement]));
		assert.equal((await readdir(deriveLightscaperNativePhotoOriginalPathsCurrentV1(appDataPath).stagingRoot)).length, 1,
			'Failed producer retirement must retain the exact staging scope.');
		checked = true;
	} finally {
		await caught(store.close());
		if (checked) await rm(appDataPath, { recursive: true, force: true });
	}
});

test('Lightscaper native Original rejected next joins a held return before write failure and close settle', { timeout: 10_000 }, async () => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'lightscaper held return '));
	const store = await LightscaperNativeOriginalStoreCurrentV1.open({ appDataPath });
	const primary = new Error('owned next failed'), entered = deferred<void>(), release = deferred<IteratorResult<Uint8Array>>();
	let returns = 0;
	const source: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]() { return {
		next() { return Promise.reject(primary); },
		return() { returns++; entered.resolve(); return release.promise; },
	}; } };
	const work = caught(store.store(original(), source)); let closing: Promise<unknown> | undefined;
	let checked = false;
	try {
		await Promise.race([entered.promise, work.then(() => { throw new Error('Rejected next bypassed producer return.'); })]);
		closing = caught(store.close());
		assert.equal(await remainsPending(work), true); assert.equal(await remainsPending(closing), true);
		await assert.rejects(store.verify(original()));
		release.resolve({ done: true, value: undefined });
		assert.equal(await work, primary); assert.equal(await closing, undefined); assert.equal(returns, 1);
		assert.deepEqual(await readdir(deriveLightscaperNativePhotoOriginalPathsCurrentV1(appDataPath).stagingRoot), []);
		checked = true;
	} finally {
		release.resolve({ done: true, value: undefined }); await work; await closing; await caught(store.close());
		if (checked) await rm(appDataPath, { recursive: true, force: true });
	}
});

test('Lightscaper native Original rejected return remains latched into close after rejected next', { timeout: 10_000 }, async () => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'lightscaper latched retirement '));
	const store = await LightscaperNativeOriginalStoreCurrentV1.open({ appDataPath });
	const primary = new Error('owned next failed'), retirement = new Error('owned return failed');
	const entered = deferred<void>(), release = deferred<IteratorResult<Uint8Array>>();
	void release.promise.catch(() => undefined); // RED must not create an unhandled test-owned rejection.
	let returns = 0;
	const source: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]() { return {
		next() { return Promise.reject(primary); },
		return() { returns++; entered.resolve(); return release.promise; },
	}; } };
	const work = caught(store.store(original(), source)); let closing: Promise<unknown> | undefined;
	let checked = false;
	try {
		await Promise.race([entered.promise, work.then(() => { throw new Error('Rejected next bypassed producer return.'); })]);
		closing = caught(store.close()); assert.equal(await remainsPending(closing), true);
		release.reject(retirement);
		const error = await work; assert.ok(error instanceof AggregateError);
		assert.deepEqual(new Set(leaves(error)), new Set([primary, retirement]));
		assert.deepEqual(new Set(leaves(await closing)), new Set([retirement]));
		assert.deepEqual(new Set(leaves(await caught(store.close()))), new Set([retirement]));
		assert.equal(returns, 1);
		assert.equal((await readdir(deriveLightscaperNativePhotoOriginalPathsCurrentV1(appDataPath).stagingRoot)).length, 1);
		checked = true;
	} finally {
		release.reject(retirement); await work; await closing; await caught(store.close());
		if (checked) await rm(appDataPath, { recursive: true, force: true });
	}
});
