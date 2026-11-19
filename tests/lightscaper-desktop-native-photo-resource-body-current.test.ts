/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { captureLightscaperNativePhotoResourceBodyCurrentV1 as capture, authenticateLightscaperNativePhotoResourceBodyCurrentV1 as authenticate,
	assertAuthenticatedLightscaperNativePhotoResourceBodyCurrentV1 as assertAuthenticated, wipeLightscaperNativePhotoResourceBodyCurrentV1 as wipe } from '../desktop/lightscaper-native-photo-resource-body-current-v1.ts';
import { readLightscaperNativePhotoLutFileCurrentV1 as readFile } from '../desktop/lightscaper-native-photo-resource-lut-file-current-v1.ts';
import { parseCubeLutV1 } from '../src/common/imaging/cube-lut-v1.ts';
import { withPreparedBrushMaskResourceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';

const TEXT = 'TITLE "Größe"\r\nLUT_3D_SIZE 2\r\n0 0 0\r\n1 0 0\r\n0 1 0\r\n1 1 0\r\n0 0 1\r\n1 0 1\r\n0 1 1\r\n1 1 1';
function lut() {
	const parsed = parseCubeLutV1(TEXT);
	return { bytes: new TextEncoder().encode(TEXT), reference: { storageKey: `lut-sha256:${parsed.sha256}`, sha256: parsed.sha256,
		byteLength: parsed.byteLength, size: parsed.size, domainMin: [...parsed.domainMin], domainMax: [...parsed.domainMax] } };
}
async function brush() {
	return await withPreparedBrushMaskResourceV1({ width: 2, height: 2, alpha: Uint8Array.of(0, 63, 128, 255) },
		prepared => ({ reference: prepared.reference, bytes: prepared.bytes.slice() }));
}

test('Lightscaper native resource capture detaches full LUT reference and fixed bytes before parser settlement', async () => {
	const input = lut(), packet = capture('lut', input.reference, input.bytes), expected = lut();
	input.bytes.fill(0); input.reference.domainMin[0] = -1;
	await authenticate(packet); assertAuthenticated(packet); assert.deepEqual(packet.bytes, expected.bytes);
	assert.deepEqual(packet.reference, expected.reference); assert.ok(Object.isFrozen(packet.reference.domainMin));
	wipe(packet); assert.equal(packet.bytes.some(byte => byte !== 0), false);
	assert.throws(() => assertAuthenticated(packet), /body|digest|authentic/iu);
});

test('Lightscaper native resource publication proof refuses forged and post-authentication mutated packets', async () => {
	const input = lut(), packet = capture('lut', input.reference, input.bytes);
	assert.throws(() => assertAuthenticated(packet), /authentic/iu); await authenticate(packet);
	assert.throws(() => assertAuthenticated({ ...packet }), /authentic/iu);
	packet.bytes[packet.bytes.length - 1] = 0; assert.throws(() => assertAuthenticated(packet), /body|digest|authentic/iu); wipe(packet);
});

test('Lightscaper native resource authentication preserves LUT domain and lattice authority beyond matching digest', async () => {
	const input = lut();
	for (const reference of [{ ...input.reference, domainMin: [-1, 0, 0] }, { ...input.reference, size: 3 }]) {
		const packet = capture('lut', reference, input.bytes);
		try { await assert.rejects(authenticate(packet)); assert.throws(() => assertAuthenticated(packet)); } finally { wipe(packet); }
	}
});

test('Lightscaper native resource authentication retains the exact SCMASK01 header dimensions and complete digest', async () => {
	const input = await brush(), packet = capture('brush', input.reference, input.bytes);
	await authenticate(packet); assertAuthenticated(packet); assert.deepEqual(packet.bytes, input.bytes); wipe(packet);
	for (const index of [0, 8, 19]) {
		const corrupt = input.bytes.slice(); corrupt[index] = corrupt[index]! ^ 1;
		const bad = capture('brush', input.reference, corrupt);
		try { await assert.rejects(authenticate(bad)); } finally { wipe(bad); }
	}
	assert.throws(() => capture('brush', { ...input.reference, width: 1 }, input.bytes));
});

test('Lightscaper native resource byte admission rejects shared resizable shadowed detached and oversized backing', async () => {
	const input = lut(); let calls = 0;
	const ResizableBuffer = ArrayBuffer as unknown as new (size: number, options: { maxByteLength: number }) => ArrayBuffer;
	const shadow = input.bytes.slice(); Object.defineProperty(shadow, 'buffer', { get() { calls++; throw Error('borrowed buffer'); } });
	const detached = input.bytes.slice(); structuredClone(detached.buffer, { transfer: [detached.buffer] });
	for (const bytes of [shadow, detached, new Proxy(input.bytes, {}), new Uint8Array(new SharedArrayBuffer(input.bytes.length)),
		new Uint8Array(new ResizableBuffer(input.bytes.length, { maxByteLength: input.bytes.length + 1 })),
		new Uint8Array(new ArrayBuffer(16 * 1024 * 1024 + 1), 0, input.bytes.length)]) assert.throws(() => capture('lut', input.reference, bytes));
	assert.equal(calls, 0);
	const mask = await brush(), padded = new Uint8Array(mask.bytes.length + 2); padded.set(mask.bytes, 1);
	assert.throws(() => capture('brush', mask.reference, padded.subarray(1, -1)));
});

test('Lightscaper native resource reference accessors are refused without execution', () => {
	const input = lut(); let calls = 0;
	Object.defineProperty(input.reference, 'sha256', { get() { calls++; throw Error('borrowed digest'); } });
	assert.throws(() => capture('lut', input.reference, input.bytes)); assert.equal(calls, 0);
});

test('Lightscaper native LUT file import uses native Blob behavior and preserves exact UTF8 bytes', async () => {
	const file = new Blob([TEXT]); let calls = 0;
	for (const key of ['size', 'arrayBuffer']) Object.defineProperty(file, key, { get() { calls++; throw Error('borrowed Blob method'); } });
	const packet = await readFile(file);
	try { await authenticate(packet); assert.deepEqual(packet.reference, lut().reference); assert.deepEqual(packet.bytes, lut().bytes); }
	finally { wipe(packet); }
	assert.equal(calls, 0);
	for (const bad of [new Blob(['\ufeff' + TEXT]), new Blob([Uint8Array.of(0xff)]), new Blob([new Uint8Array(16 * 1024 * 1024 + 1)])]) await assert.rejects(readFile(bad));
});

test('Lightscaper native resource authentication forwards opaque native cancellation without inspecting it', async () => {
	let traps = 0; const reason = new Proxy({}, { get() { traps++; throw Error('reason get'); }, getPrototypeOf() { traps++; throw Error('reason prototype'); } });
	const stop = new AbortController(); stop.abort(reason); const input = lut(), packet = capture('lut', input.reference, input.bytes);
	let caught: unknown; try { await authenticate(packet, stop.signal); } catch (error) { caught = error; } finally { wipe(packet); }
	assert.equal(caught, reason); assert.equal(traps, 0);
});
