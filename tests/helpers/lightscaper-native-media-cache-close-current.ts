/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { deferred, remainsPending } from './async-test-control.ts';

/** A separate isolate installs the real Blob receipt barrier before importing
 * Media, so its captured intrinsics remain the ones used by production. */
export async function verifyNativeMediaCacheCloseCurrentV1(context: TestContext): Promise<void> {
	const appDataPath = await mkdtemp(join(tmpdir(), 'lightscaper-media-cache-close-'));
	const worker = new Worker(new URL(import.meta.url), { workerData: { appDataPath }, execArgv: ['--import', import.meta.resolve('tsx')] });
	let result: unknown, error: unknown, expired = false;
	worker.on('message', (value: unknown) => { result = value; });
	worker.on('error', (value: unknown) => { error = value; });
	const abort = (): void => { worker.postMessage('release'); void worker.terminate().catch(() => undefined); };
	const deadline = setTimeout(() => { expired = true; abort(); }, 15_000);
	context.signal.addEventListener('abort', abort, { once: true });
	if (context.signal.aborted) abort();
	const code = await new Promise<number>(accept => { worker.once('exit', accept); });
	clearTimeout(deadline); context.signal.removeEventListener('abort', abort);
	try {
		assert.equal(expired, false, 'Cache close worker exceeded its owned deadline.');
		assert.equal(error, undefined); assert.equal(code, 0);
		assert.ok(result && typeof result === 'object');
		const report = result as Record<string, unknown>;
		assert.equal(report.okay, true, typeof report.message === 'string' ? report.message : 'Worker did not prove native cache retirement.');
		context.signal.throwIfAborted();
	} finally { await rm(appDataPath, { recursive: true, force: true }); }
}

async function run(): Promise<void> {
	const data: unknown = workerData;
	assert.ok(data && typeof data === 'object' && 'appDataPath' in data && typeof data.appDataPath === 'string');
	const native = Blob.prototype.arrayBuffer, entered = deferred<void>(), released = deferred<void>();
	let armed = false, held = false;
	const release = (): void => { released.resolve(); entered.resolve(); };
	parentPort?.on('message', release);
	Blob.prototype.arrayBuffer = function (): Promise<ArrayBuffer> {
		const actual = native.call(this);
		return actual.then(async buffer => { if (armed && !held) { held = true; entered.resolve(); await released.promise; } return buffer; });
	};
	let media: Awaited<ReturnType<typeof import('../../desktop/lightscaper-native-photo-media-current-v1.ts').LightscaperNativePhotoMediaCurrentV1.open>> | undefined;
	let work: Promise<unknown> | undefined, closing: Promise<void> | undefined;
	try {
		const { LightscaperNativePhotoMediaCurrentV1: Media } = await import('../../desktop/lightscaper-native-photo-media-current-v1.ts');
		const { PHOTO_PREVIEW_CACHE_PROFILE_V1: profile } = await import('../../src/lightscaper/preview/photo-preview-cache-v1.ts');
		media = await Media.open({ appDataPath: data.appDataPath });
		const original = Uint8Array.of(7, 8, 9), bytes = Uint8Array.of(2, 4, 6), body = new Blob([bytes]);
		const sha = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
		await media.writeAsset('lifetime-original', new Blob([original]));
		const cache = media.createBinaryDerivativeCache(profile), identity = { schemaVersion: 1, kind: profile.kind, key: `${profile.keyPrefix}lifetime`,
			sourceId: 'lifetime-original', originalSha256: sha(original), originalByteLength: original.length,
			recipeId: 'lightscaper.test.preview-lifetime', recipeVersion: 1, byteLength: bytes.length, metadata: '{}' };
		armed = true; work = cache.store(identity, body, sha(bytes)); void work.catch(() => undefined);
		await Promise.race([entered.promise, work.then(() => { throw new Error('The cache skipped its actual Blob read.'); })]);
		assert.equal(held, true);
		closing = media.close(); assert.equal(closing, media.close());
		assert.equal(await remainsPending(closing), true, 'Media close must join the actual cache producer.');
		let reflections = 0;
		const hostile = new Proxy(identity, { ownKeys() { reflections++; throw new Error('Closed cache inspected input.'); } });
		await assert.rejects(cache.load(hostile)); assert.equal(reflections, 0);
		release(); await assert.rejects(work); await closing;
	} finally {
		release(); await Promise.allSettled([...(work ? [work] : []), ...(closing ? [closing] : [])]);
		await media?.close(); Blob.prototype.arrayBuffer = native; parentPort?.off('message', release);
	}
}

if (!isMainThread) {
	try { await run(); parentPort?.postMessage({ okay: true }); }
	catch (error) { parentPort?.postMessage({ okay: false, message: error instanceof Error ? error.message.slice(0, 2048) : 'Native cache close failed.' }); }
	finally { parentPort?.close(); }
}
