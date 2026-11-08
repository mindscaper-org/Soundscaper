/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { Blob, File } from 'node:buffer';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Serializer } from 'node:v8';
import {
	captureLightscaperNativePhotoSettingCurrentV1 as capture,
	decodeLightscaperNativePhotoSettingCurrentV1 as decode,
} from '../desktop/lightscaper-native-photo-settings-codec-current-v1.ts';
import { canonicalKeyValueComparison } from '../src/common/editor/storage/key-value-canonical-comparison.ts';

async function roundTrip<Value>(value: Value): Promise<Value> {
	return decode(await capture(value)) as Value;
}

function frame(value: unknown, trailing = false): Uint8Array {
	const serializer = new Serializer(); serializer.writeHeader(); serializer.writeValue(value);
	if (trailing) serializer.writeUint32(123);
	const payload = serializer.releaseBuffer();
	const result = new Uint8Array(48 + payload.byteLength);
	result.set(new TextEncoder().encode('LSSET001'));
	new DataView(result.buffer).setBigUint64(8, BigInt(payload.byteLength), true);
	result.set(createHash('sha256').update(payload).digest(), 16); result.set(payload, 48);
	return result;
}

function patchDigest(bytes: Uint8Array): void {
	bytes.set(createHash('sha256').update(bytes.subarray(48)).digest(), 16);
}

async function failed(work: Promise<unknown>): Promise<unknown> {
	try { await work; } catch (error) { return error; }
	assert.fail('Expected refusal.');
}

test('Lightscaper settings codec preserves scalar clone values rather than JSON projections', async () => {
	for (const value of [undefined, null, true, false, '', '\ud800', '\udfff', 'Ω😀', 0, -0, NaN, Infinity, -Infinity, 123n]) {
		const result = await roundTrip(value);
		assert.ok(Object.is(result, value));
	}
});

test('Lightscaper settings codec preserves property order, own undefined and holes', async () => {
	const value = { z: undefined, a: 1, '\ud800': '\udfff', array: new Array<unknown>(3) };
	value.array[1] = undefined; Object.defineProperty(value, '__proto__', { value: { literal: true }, enumerable: true });
	const result = await roundTrip(value);
	assert.deepEqual(Object.keys(result), Object.keys(structuredClone(value)));
	assert.ok(Object.hasOwn(result, 'z')); assert.equal(result.z, undefined);
	assert.equal(Object.hasOwn(result.array, 0), false); assert.equal(Object.hasOwn(result.array, 1), true);
	assert.deepEqual(Object.getOwnPropertyDescriptor(result, '__proto__')?.value, { literal: true });
	assert.equal(Object.getPrototypeOf(result), Object.prototype);
});

test('Lightscaper settings codec retains cycles, shared objects and Map Set identity', async () => {
	const shared = { number: 1 }; const value: { shared: typeof shared; alias: typeof shared; self?: unknown; map: Map<unknown, unknown>; set: Set<unknown> } = {
		shared, alias: shared, map: new Map(), set: new Set(),
	};
	value.self = value; value.map.set(shared, value); value.set.add(shared); value.set.add(value);
	const result = await roundTrip(value);
	assert.equal(result.self, result); assert.equal(result.alias, result.shared);
	assert.equal(result.map.get(result.shared), result); assert.ok(result.set.has(result.shared)); assert.ok(result.set.has(result));
});

test('Lightscaper settings codec preserves native Date RegExp boxed primitive and Error cause semantics', async () => {
	const cause = { code: 7 }; const value = {
		date: new Date('2026-10-18T00:00:00Z'), invalid: new Date(NaN), regexp: /Ω+/giu,
		boxed: Object(99n) as object, error: new TypeError('broken', { cause }), cause,
	};
	value.regexp.lastIndex = 9;
	const expected = structuredClone(value); const result = await roundTrip(value);
	assert.deepEqual(result, expected); assert.equal(result.error.cause, result.cause);
	assert.equal(result.regexp.lastIndex, expected.regexp.lastIndex);
});

test('Lightscaper settings codec preserves backing buffers offsets and aliases across binary views', async () => {
	const backing = new ArrayBuffer(48); new Uint8Array(backing).set(Array.from({ length: 48 }, (_, index) => index));
	const value = { backing, bytes: new Uint8Array(backing, 5, 9), words: new Uint16Array(backing, 8, 5), view: new DataView(backing, 4, 12) };
	const result = await roundTrip(value);
	assert.equal(result.bytes.buffer, result.backing); assert.equal(result.words.buffer, result.backing); assert.equal(result.view.buffer, result.backing);
	assert.equal(result.bytes.byteOffset, 5); assert.equal(result.words.byteOffset, 8); assert.equal(result.view.byteOffset, 4);
	assert.deepEqual(new Uint8Array(result.backing), new Uint8Array(backing));
	result.bytes[3] = 201; assert.equal(new Uint8Array(result.backing)[8], 201); assert.equal(new Uint8Array(backing)[8], 8);
});

test('Lightscaper settings codec retains every native typed view kind including bigint bytes', async () => {
	const value = [new Int8Array([-1]), new Uint8Array([255]), new Uint8ClampedArray([255]), new Int16Array([-2]),
		new Uint16Array([65000]), new Int32Array([-3]), new Uint32Array([4]), new Float32Array([NaN, -0]),
		new Float64Array([Infinity]), new BigInt64Array([-9n]), new BigUint64Array([9n]), new DataView(new Uint8Array([1, 2]).buffer)];
	assert.deepEqual(await roundTrip(value), structuredClone(value));
	assert.deepEqual(await roundTrip(Buffer.from([3, 4])), structuredClone(Buffer.from([3, 4])));
});

test('Lightscaper settings codec follows actual native resizable buffer clone semantics', async () => {
	type ResizableBuffer = ArrayBuffer & { readonly resizable: boolean; readonly maxByteLength: number; resize(size: number): void };
	const NativeArrayBuffer = ArrayBuffer as unknown as { new(size: number, options: { maxByteLength: number }): ResizableBuffer };
	const buffer = new NativeArrayBuffer(12, { maxByteLength: 32 });
	const value = { buffer, view: new Uint8Array(buffer, 4) }; const expected = structuredClone(value); const result = await roundTrip(value);
	assert.equal(result.buffer.resizable, expected.buffer.resizable); assert.equal(result.buffer.maxByteLength, expected.buffer.maxByteLength);
	assert.equal(result.view.buffer, result.buffer); assert.equal(result.view.byteOffset, expected.view.byteOffset);
	if (result.buffer.resizable) { result.buffer.resize(20); assert.equal(result.view.byteLength, 16); }
});

test('Lightscaper settings codec snapshots synchronously before encoding awaits', async () => {
	const bytes = new Uint8Array([1, 2]); const value = { name: 'before', bytes, nested: { revision: 1 }, blob: new Blob(['original']) };
	const pending = capture(value); value.name = 'after'; value.nested.revision = 2; bytes.fill(9);
	const result = decode(await pending) as typeof value;
	assert.equal(result.name, 'before'); assert.equal(result.nested.revision, 1); assert.deepEqual(result.bytes, new Uint8Array([1, 2]));
	assert.equal(await result.blob.text(), 'original');
});

test('Lightscaper settings codec returns detached decodes and does not retain payload backing', async () => {
	const payload = await capture({ bytes: new Uint8Array([1, 2, 3]) });
	const first = decode(payload) as { bytes: Uint8Array }; const second = decode(payload) as typeof first;
	first.bytes.fill(7); assert.deepEqual(second.bytes, new Uint8Array([1, 2, 3]));
	payload.fill(0); assert.deepEqual(second.bytes, new Uint8Array([1, 2, 3]));
});

test('Lightscaper settings codec preserves genuine repeated Blob hosts in cycles Maps and Error causes', async () => {
	const blob = new Blob([new Uint8Array([0, 255]), 'Ω'], { type: 'Application/Octet-Stream' });
	const value: { blob: Blob; alias: Blob; map: Map<unknown, unknown>; error: Error; self?: unknown } = {
		blob, alias: blob, map: new Map([[blob, blob]]), error: new Error('blob cause', { cause: blob }),
	};
	value.self = value; const result = await roundTrip(value);
	assert.ok(result.blob instanceof Blob); assert.equal(result.alias, result.blob); assert.equal(result.error.cause, result.blob);
	assert.equal(result.map.get(result.blob), result.blob); assert.equal(result.self, result);
	assert.equal(result.blob.type, blob.type); assert.deepEqual(new Uint8Array(await result.blob.arrayBuffer()), new Uint8Array(await blob.arrayBuffer()));
});

test('Lightscaper settings codec follows actual native File clone rather than inventing metadata', async () => {
	const file = new File(['file payload'], 'Ω-\ud800.liscape', { type: 'application/test', lastModified: 12345 });
	const expected = structuredClone(file); const result = await roundTrip(file);
	assert.equal(result instanceof File, expected instanceof File); assert.equal(result instanceof Blob, expected instanceof Blob);
	assert.equal(result.type, expected.type); assert.equal(result.size, expected.size);
	if (expected instanceof File) { assert.equal(result.name, expected.name); assert.equal(result.lastModified, expected.lastModified); }
	assert.deepEqual(new Uint8Array(await result.arrayBuffer()), new Uint8Array(await expected.arrayBuffer()));
});

test('Lightscaper settings codec ignores borrowed Blob byte-reader and metadata shadows', async () => {
	const blob = new Blob(['genuine'], { type: 'text/plain' });
	Object.defineProperties(blob, { arrayBuffer: { value: () => { throw new Error('borrowed reader'); } },
		size: { get: () => { throw new Error('borrowed size'); } }, type: { get: () => { throw new Error('borrowed type'); } } });
	const result = await roundTrip(blob);
	assert.equal(await result.text(), 'genuine'); assert.equal(result.size, 7); assert.equal(result.type, 'text/plain');
});

test('Lightscaper settings codec has no magic-property collision with ordinary application values', async () => {
	const value = { kind: 'blob', type: 'text/plain', size: 1, marker: 'LSSET001', hosts: [[{}, 'blob', '', 0, null, null, new Uint8Array()]],
		root: { placeholder: true }, version: 1 };
	assert.deepEqual(await roundTrip(value), structuredClone(value));
});

test('Lightscaper settings codec preserves opaque native clone getter failures without introspection', async () => {
	const reason = new Proxy({}, { get: () => { throw new Error('inspected opaque reason'); }, getPrototypeOf: () => { throw new Error('inspected opaque prototype'); } });
	const value = Object.defineProperty({}, 'value', { enumerable: true, get: () => { throw reason; } });
	await capture(value).then(() => { assert.fail('Expected native clone failure.'); }, (failure: unknown) => { assert.equal(failure, reason); });
});

test('Lightscaper settings codec refuses native noncloneable values and explicitly shared memory', async () => {
	for (const value of [() => 1, Symbol('setting'), new WeakMap(), new Proxy({}, {})]) {
		assert.notEqual(await failed(capture(value)), undefined);
	}
	const shared = new SharedArrayBuffer(8);
	for (const value of [shared, { shared }, new Uint8Array(shared), new Map([[1, new DataView(shared)]])]) {
		const error = await failed(capture(value)); assert.ok(error instanceof TypeError); assert.match(error.message, /shared/i);
	}
});

test('Lightscaper settings codec does not impose journal or resource limits on broad setting values', async () => {
	const value = { payload: 'x'.repeat(10 * 1024 * 1024 + 1) };
	assert.deepEqual(await roundTrip(value), value);
});

test('Lightscaper settings codec retains owning CAS insertion order and binary semantics', async () => {
	const value = { z: '\ud800', a: new Uint16Array([0, 65535]), nested: { b: undefined, a: 2 }, omitted: undefined };
	const result = await roundTrip(value); assert.equal(canonicalKeyValueComparison(result), canonicalKeyValueComparison(value));
	assert.notEqual(canonicalKeyValueComparison(result), canonicalKeyValueComparison({ a: value.a, z: value.z, nested: value.nested }));
	assert.notEqual(canonicalKeyValueComparison(result.a), canonicalKeyValueComparison(new Uint8Array(result.a.buffer)));
});

test('Lightscaper settings codec accepts non-CAS values without precomputing comparison digests', async () => {
	const cycle: { self?: unknown } = {}; cycle.self = cycle;
	for (const value of [undefined, 123n, cycle]) {
		const result = await roundTrip(value); assert.throws(() => canonicalKeyValueComparison(result), TypeError);
	}
});

test('Lightscaper settings codec rejects corrupt truncated wrong-version and trailing frame bytes', async () => {
	const valid = await capture({ valid: true });
	for (const bytes of [new Uint8Array(), valid.subarray(0, 47), valid.subarray(0, valid.length - 1),
		new Uint8Array([...valid, 0])]) assert.throws(() => decode(bytes));
	const wrongMagic = valid.slice(); wrongMagic[7] ^= 1; assert.throws(() => decode(wrongMagic));
	const wrongLength = valid.slice(); new DataView(wrongLength.buffer).setBigUint64(8, 0xffffffffffffffffn, true); assert.throws(() => decode(wrongLength));
	const wrongDigest = valid.slice(); wrongDigest[16] ^= 1; assert.throws(() => decode(wrongDigest));
	const changedPayload = valid.slice(); changedPayload[changedPayload.length - 1] ^= 1; assert.throws(() => decode(changedPayload));
});

test('Lightscaper settings codec refuses a second V8 value even when outer digest and length are valid', () => {
	assert.throws(() => decode(frame([1, { value: true }, []], true)));
});

test('Lightscaper settings codec requires the complete closed wire and native host metadata', () => {
	for (const wire of [null, [], [1, null], [2, null, []], [1, null, [], 'extra'], [1, null, {}]]) assert.throws(() => decode(frame(wire)));
	const placeholder = {}; const bytes = new Uint8Array([1]);
	for (const host of [[placeholder, 'other', '', 1, null, null, bytes], [placeholder, 'blob', '', 2, null, null, bytes],
		[placeholder, 'blob', '', 1, 'unexpected-name', null, bytes], [{ forged: true }, 'blob', '', 1, null, null, bytes]]) {
		assert.throws(() => decode(frame([1, placeholder, [host]])));
	}
	const duplicate = [placeholder, 'blob', '', 1, null, null, bytes];
	assert.throws(() => decode(frame([1, placeholder, [duplicate, duplicate]])));
});

test('Lightscaper settings codec rejects corrupt V8 data with a freshly valid outer digest', async () => {
	const bytes = await capture('value'); bytes[48] ^= 255; patchDigest(bytes);
	assert.throws(() => decode(bytes));
});
