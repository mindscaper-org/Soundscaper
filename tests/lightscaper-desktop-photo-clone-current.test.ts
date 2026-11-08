/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { captureDesktopPhotoCloneCurrentV1 as capture, readDesktopPhotoCloneCurrentV1 as read, retireDesktopPhotoCloneCurrentV1 as retire } from '../src/lightscaper/desktop-photo-clone-current-v1.ts';
import { captureLightscaperNativePhotoSettingCurrentV1 as encodeNative, decodeLightscaperNativePhotoSettingCurrentV1 as decodeNative } from '../desktop/lightscaper-native-photo-settings-codec-current-v1.ts';

const options = { timeout: 15_000 }, sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const object = (value: unknown): Record<string, unknown> => { assert.ok(value && typeof value === 'object'); return value as Record<string, unknown>; };
const exchange = async (value: unknown): Promise<unknown> => {
	const wire = await capture(value);
	try { return await read(structuredClone(wire)); } finally { retire(wire); }
};

void test('Desktop metadata clone preserves own order, undefined, UTF16, cycles and actual Map/Set aliases', options, async () => {
	const source: Record<string, unknown> = { z: undefined, a: 'unpaired\ud800', negative: -0, nan: NaN, infinity: Infinity, huge: 12345678901234567890n };
	const array = new Array<unknown>(4); array[2] = source; source.array = array; source.self = source;
	source.map = new Map<unknown, unknown>([[source, array]]); source.set = new Set([source, array]);
	Object.defineProperty(source, '__proto__', { value: 'ordinary key', enumerable: true, writable: true });
	const result = object(await exchange(source));
	assert.deepEqual(Object.keys(result), Object.keys(source)); assert.equal(Object.hasOwn(result, 'z'), true); assert.equal(result.z, undefined);
	assert.equal(result.a, source.a); assert.equal(Object.is(result.negative, -0), true); assert.ok(Number.isNaN(result.nan)); assert.equal(result.huge, source.huge);
	assert.equal(result.self, result); assert.ok(Array.isArray(result.array)); assert.equal(result.array.length, 4); assert.equal(Object.hasOwn(result.array, 0), false);
	assert.equal(result.array[2], result); assert.ok(result.map instanceof Map); assert.equal(result.map.get(result), result.array);
	assert.ok(result.set instanceof Set); assert.ok(result.set.has(result)); assert.equal(Object.getPrototypeOf(result), Object.prototype);
	assert.equal(result.__proto__, 'ordinary key');
});

void test('Desktop metadata snapshot precedes async Blob IO and portable host aliases survive native storage codecs', options, async () => {
	const bytes = Uint8Array.from([7, 3, 255, 0]), blob = new Blob([bytes], { type: 'application/octet-stream' });
	const source = { label: 'before', body: blob, aliases: [blob, blob], bytes, nested: { value: 7 } };
	const work = capture(source); source.label = 'after'; source.nested.value = 9; bytes.fill(0);
	const wire = await work;
	try {
		const result = object(await read(structuredClone(wire))); assert.equal(result.label, 'before'); assert.equal(object(result.nested).value, 7);
		assert.ok(result.body instanceof Blob); assert.ok(Array.isArray(result.aliases)); assert.equal(result.aliases[0], result.body); assert.equal(result.aliases[1], result.body);
		const actual = new Uint8Array(await result.body.arrayBuffer());
		try { assert.equal(sha(actual), sha(Uint8Array.from([7, 3, 255, 0]))); } finally { actual.fill(0); }
		const native = await encodeNative(result);
		try {
			const restored = object(decodeNative(native)); assert.ok(restored.body instanceof Blob); assert.equal(restored.label, 'before');
			const roundtrip = object(await exchange(restored)); assert.ok(roundtrip.body instanceof Blob); assert.equal(roundtrip.body.size, 4);
		} finally { native.fill(0); }
	} finally { retire(wire); }
});

void test('Desktop metadata retains detached buffers, typed view sharing, dates, RegExp and Error cause', options, async () => {
	const buffer = new ArrayBuffer(32), left = new Uint16Array(buffer, 4, 4), right = new DataView(buffer, 8, 8);
	left[2] = 4386; const source = { buffer, left, right, date: new Date(123456), expression: /hello/giu, boxed: Object(23n) as object,
		error: new TypeError('metadata cause', { cause: { descriptive: 'retained' } }) };
	const result = object(await exchange(source)); assert.ok(result.buffer instanceof ArrayBuffer); assert.notEqual(result.buffer, buffer);
	assert.ok(result.left instanceof Uint16Array); assert.ok(result.right instanceof DataView);
	assert.equal(result.left.buffer, result.buffer); assert.equal(result.right.buffer, result.buffer); assert.equal(result.left.byteOffset, 4); assert.equal(result.left[2], 4386);
	assert.ok(result.date instanceof Date); assert.equal(result.date.getTime(), 123456); assert.ok(result.expression instanceof RegExp); assert.equal(result.expression.flags, 'giu');
	assert.equal(BigInt.prototype.valueOf.call(result.boxed), 23n); assert.ok(result.error instanceof TypeError); assert.equal(object(result.error.cause).descriptive, 'retained');
});

void test('Desktop metadata host envelopes reject duplicate, unused, wrong-length and raw hosts without authority', options, async () => {
	for (const change of ['duplicate', 'unused', 'length', 'raw'] as const) {
		const wire = object(await capture({ body: new Blob(['owned']) }));
		try {
			const changed = object(structuredClone(wire)); assert.ok(Array.isArray(changed.hosts));
			const entry = changed.hosts[0] as unknown[];
			if (change === 'duplicate') changed.hosts.push(entry);
			if (change === 'unused') changed.value = {};
			if (change === 'length') entry[3] = 1;
			if (change === 'raw') changed.value = { body: new Blob(['raw']) };
			await assert.rejects(read(changed));
		} finally { retire(wire); }
	}
});

void test('Desktop metadata clone refuses shared memory and bounded object overflow', options, async () => {
	await assert.rejects(capture({ shared: new SharedArrayBuffer(16) }));
	await assert.rejects(capture({ shared: new Uint8Array(new SharedArrayBuffer(16)) }));
	await assert.rejects(capture(Array.from({ length: 65_537 }, () => ({}))), /object capacity/u);
	await assert.rejects(capture({ callback() { return 1; } }));
});

void test('Desktop clone sender retirement wipes only its genuine owned host wire after copied delivery', options, async () => {
	const wire = object(await capture(new Blob(['private']))), copy = structuredClone(wire); assert.ok(Array.isArray(wire.hosts));
	const tuple = wire.hosts[0] as unknown[], bytes = tuple[6]; assert.ok(bytes instanceof Uint8Array);
	retire({ ...wire }); assert.equal(bytes.some(byte => byte !== 0), true);
	retire(wire); retire(wire); assert.equal(bytes.every(byte => byte === 0), true);
	const restored = await read(copy); assert.ok(restored instanceof Blob); assert.equal(await restored.text(), 'private');
});
