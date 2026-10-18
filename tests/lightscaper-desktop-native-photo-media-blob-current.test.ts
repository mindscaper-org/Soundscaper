/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { captureLightscaperNativePhotoMediaWriteCurrentV1 as capture,
	digestLightscaperNativePhotoMediaWriteCurrentV1 as digest,
	lightscaperNativePhotoMediaWriteChunksCurrentV1 as chunks } from '../desktop/lightscaper-native-photo-media-blob-current-v1.ts';

test('Lightscaper native media captures a genuine Blob without reading bytes before digest demand', async () => {
	const body = new Blob(['exact bytes'], { type: 'application/unusual' });
	Object.defineProperties(body, { size: { get: () => { throw new Error('borrowed size'); } },
		slice: { value: () => { throw new Error('borrowed slice'); } }, arrayBuffer: { value: () => { throw new Error('borrowed read'); } } });
	const captured = await capture('body', body, { name: 'exact', mimeType: 'application/unusual' });
	assert.ok(Object.isFrozen(captured)); assert.deepEqual(Reflect.ownKeys(captured), []);
	assert.deepEqual(await digest(captured), { storageKey: 'body', byteLength: 11,
		contentSha256: createHash('sha256').update('exact bytes').digest('hex') });
});

test('Lightscaper native media digests and emits independent bounded native Blob slices', async () => {
	const bytes = new Uint8Array(2 * 1024 * 1024 + 17); bytes.forEach((_, index) => { bytes[index] = index % 251; });
	const captured = await capture('body', new Blob([bytes]), {}), expected = createHash('sha256').update(bytes).digest('hex');
	assert.equal((await digest(captured)).contentSha256, expected);
	const emitted: Uint8Array[] = []; for await (const chunk of chunks(captured)) { assert.ok(chunk.length > 0 && chunk.length <= 1024 * 1024); emitted.push(chunk); }
	assert.deepEqual(Buffer.concat(emitted), Buffer.from(bytes));
	emitted[0]?.fill(0); const hash = createHash('sha256'); for await (const chunk of chunks(captured)) hash.update(chunk);
	assert.equal(hash.digest('hex'), expected);
});

test('Lightscaper native media retains native format-independent capacity beyond raster64MiB', async () => {
	const unit = new Blob([new Uint8Array(1024 * 1024)]), body = new Blob([...Array.from({ length: 64 }, () => unit), 'x']);
	const captured = await capture('hdr', body, { mimeType: 'image/x-lightscaper-hdr' });
	assert.equal((await digest(captured)).byteLength, 64 * 1024 * 1024 + 1);
});

test('Lightscaper native media refuses zero and over196MiB native bodies without manufacturing a descriptor', async () => {
	await assert.rejects(capture('empty', new Blob(), {}));
	const unit = new Blob([new Uint8Array(1024 * 1024)]), body = new Blob(Array.from({ length: 197 }, () => unit));
	await assert.rejects(capture('too-large', body, {}));
	await assert.rejects(capture('fake', { size: 1, slice() { return new Blob(['x']); } }, {}));
});

test('Lightscaper native media rejects forged capture tokens before reading them', async () => {
	const reason = new Proxy({}, { get: () => { throw new Error('token reflected'); }, getPrototypeOf: () => { throw new Error('token reflected'); } });
	await assert.rejects(digest(reason)); assert.throws(() => chunks(reason));
});

test('Lightscaper native media preserves opaque cancellation before digest or stream reads', async () => {
	const captured = await capture('body', new Blob(['x']), {}), stop = new AbortController();
	const reason = Proxy.revocable({}, {}); reason.revoke(); stop.abort(reason.proxy);
	let caught = false; await digest(captured, stop.signal).then(() => assert.fail('Expected cancellation.'), (error: unknown) => { caught = true; assert.equal(error, reason.proxy); });
	assert.equal(caught, true);
	try { for await (const _ of chunks(captured, stop.signal)) assert.fail('No chunk may escape.'); assert.fail('Expected cancellation.'); }
	catch (error) { assert.equal(error, reason.proxy); }
});
