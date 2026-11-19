/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	DESKTOP_PHOTO_LIBRARY_SESSION_CHANNELS_CURRENT_V1 as channels,
	DESKTOP_PHOTO_LIBRARY_SESSION_PROTOCOL_LIMITS_CURRENT_V1 as limits,
	readDesktopPhotoLibrarySessionDescriptorCurrentV1 as descriptor,
	readDesktopPhotoLibrarySessionRequestIdentityCurrentV1 as identity,
	readDesktopPhotoLibrarySessionHandleCurrentV1 as handle,
} from '../src/lightscaper/desktop-photo-library-session-protocol-current-v1.ts';

const sessionId = 'a'.repeat(64), selectionToken = 'b'.repeat(32), exclusiveId = 'c'.repeat(64);
const receipt = () => ({ schemaVersion: 1, kind: 'desktop-photo-session', profile: 'current3', sessionId, catalogId: 'catalog:1', selectionToken });
const request = () => ({ schemaVersion: 1, sessionId, requestId: 1, exclusiveId: null });
const options = { timeout: 15_000, concurrency: false };

void test('Lightscaper Session descriptor copies an inert exact Current identity', options, () => {
	const input = receipt(), value = descriptor(input);
	assert.deepEqual(value, input); assert.notEqual(value, input); assert.ok(Object.isFrozen(value));
	input.catalogId = 'changed'; assert.equal(value.catalogId, 'catalog:1');
});

void test('Lightscaper Session descriptor refuses other versions, kinds and profiles', options, () => {
	for (const schemaVersion of [0, 2, '1', null]) assert.throws(() => descriptor({ ...receipt(), schemaVersion }));
	for (const kind of ['native-photo-library-session', 'desktop-photo-session-v2', null]) assert.throws(() => descriptor({ ...receipt(), kind }));
	for (const profile of ['legacy2', 'current4', null]) assert.throws(() => descriptor({ ...receipt(), profile }));
});

void test('Lightscaper Session descriptor refuses missing fields and injected authority', options, () => {
	for (const key of Object.keys(receipt())) {
		const value: Record<string, unknown> = { ...receipt() }; delete value[key]; assert.throws(() => descriptor(value));
	}
	for (const key of ['appDataPath', 'namespaceToken', 'owner', 'signal', 'assertCurrent', 'close'])
		assert.throws(() => descriptor({ ...receipt(), [key]: undefined }));
});

void test('Lightscaper Session IDs refuse malformed lengths, uppercase, control text and coercion', options, () => {
	for (const value of ['', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), `${sessionId}\n`, `a\0${'a'.repeat(62)}`, 1, null])
		assert.throws(() => descriptor({ ...receipt(), sessionId: value }));
	for (const value of ['', 'b'.repeat(31), 'b'.repeat(33), 'B'.repeat(32), `${selectionToken}\n`])
		assert.throws(() => descriptor({ ...receipt(), selectionToken: value }));
	let coerced = 0;
	assert.throws(() => descriptor({ ...receipt(), sessionId: { toString() { coerced++; return sessionId; } } }));
	assert.equal(coerced, 0);
});

void test('Lightscaper Session descriptor uses the maintained catalog ID grammar', options, () => {
	assert.equal(descriptor({ ...receipt(), catalogId: 'a'.repeat(128) }).catalogId.length, 128);
	for (const catalogId of ['', 'a'.repeat(129), 'path/to/catalog', ' catalog', 'catalog\0tail', 'café'])
		assert.throws(() => descriptor({ ...receipt(), catalogId }));
});

void test('Lightscaper Session envelope readers do not invoke property getters', options, () => {
	let calls = 0;
	for (const read of [descriptor, identity]) {
		const input = read === descriptor ? receipt() : request();
		Object.defineProperty(input, 'sessionId', { enumerable: true, get() { calls++; return sessionId; } });
		assert.throws(() => read(input));
	}
	const input = Object.defineProperty({ kind: 'upload' }, 'id', { enumerable: true, get() { calls++; return sessionId; } });
	assert.throws(() => handle(input, 'upload')); assert.equal(calls, 0);
});

void test('Lightscaper Session envelope readers reject hidden, symbol and inherited state', options, () => {
	for (const read of [descriptor, identity]) {
		const value = read === descriptor ? receipt() : request();
		assert.throws(() => read(Object.defineProperty({ ...value }, 'sessionId', { value: sessionId, enumerable: false })));
		assert.throws(() => read({ ...value, [Symbol('extra')]: true }));
		assert.throws(() => read(Object.create(value)));
		for (const input of [null, undefined, [], true, 'value']) assert.throws(() => read(input));
	}
});

void test('Lightscaper Session borrowed reflection errors remain opaque and grant no native cleanup witness', options, () => {
	let inspected = 0, caught = false;
	const reason = Object.defineProperty(Object.create(null) as object, 'then', { get() { inspected++; throw new Error('Opaque reason inspected.'); } });
	const value = new Proxy(receipt(), { ownKeys() { throw reason; } });
	try { descriptor(value); } catch (actual) { caught = true; assert.equal(actual, reason); }
	assert.equal(caught, true); assert.equal(inspected, 0);
});

void test('Lightscaper Session request identity preserves explicit exclusive absence and full safe sequence range', options, () => {
	const value = identity(request()); assert.deepEqual(value, request()); assert.ok(Object.isFrozen(value));
	assert.equal(identity({ ...request(), requestId: Number.MAX_SAFE_INTEGER }).requestId, Number.MAX_SAFE_INTEGER);
	assert.equal(identity({ ...request(), exclusiveId }).exclusiveId, exclusiveId);
});

void test('Lightscaper Session request IDs are positive safe integers without coercion', options, () => {
	for (const requestId of [0, -0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1', true, null])
		assert.throws(() => identity({ ...request(), requestId }));
});

void test('Lightscaper Session request identity is closed and requires an explicit exclusive field', options, () => {
	for (const key of Object.keys(request())) {
		const value: Record<string, unknown> = { ...request() }; delete value[key]; assert.throws(() => identity(value));
	}
	for (const exclusiveId of [undefined, '', 'c'.repeat(63), 'C'.repeat(64), {}])
		assert.throws(() => identity({ ...request(), exclusiveId }));
	for (const key of ['method', 'args', 'path', 'signal', 'owner']) assert.throws(() => identity({ ...request(), [key]: null }));
	assert.throws(() => identity({ ...request(), schemaVersion: 2 }));
});

void test('Lightscaper Session handles capture each fixed purpose and require the expected purpose', options, () => {
	for (const kind of ['upload', 'download', 'resource', 'archive', 'exclusive'] as const) {
		const input = { kind, id: sessionId }, value = handle(input, kind);
		assert.deepEqual(value, input); assert.notEqual(value, input); assert.ok(Object.isFrozen(value));
		assert.throws(() => handle(input, kind === 'upload' ? 'download' : 'upload'));
	}
});

void test('Lightscaper Session handles refuse unrelated authorities and invalid tokens', options, () => {
	for (const kind of ['session', 'original', 'file', 'directory', 'callback', null]) assert.throws(() => handle({ kind, id: sessionId }, 'upload'));
	for (const id of ['', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), `${sessionId}\n`, null])
		assert.throws(() => handle({ kind: 'upload', id }, 'upload'));
	for (const input of [{ id: sessionId }, { kind: 'upload' }, { kind: 'upload', id: sessionId, path: 'body' }])
		assert.throws(() => handle(input, 'upload'));
});

void test('Lightscaper Session transport capacities stay separate from Original value limits', options, () => {
	assert.deepEqual(limits, { maximumActiveRequests: 16, maximumHandles: 16, maximumInFlightChunks: 1,
		maximumChunkBytes: 1_048_576, maximumRetainedBodyBytes: 134_217_728 });
	assert.ok(Object.isFrozen(limits)); assert.equal(Object.hasOwn(limits, 'maximumOriginalBytes'), false);
});

void test('Lightscaper Session channel inventory is fixed and contains no lifecycle retirement DTO channel', options, () => {
	assert.deepEqual(Object.keys(channels).sort(), ['archive', 'cache', 'cancel', 'catalog', 'close', 'custody', 'exclusive', 'linked',
		'open', 'originalClose', 'originalCloseGroup', 'originalOpen', 'originalOpenGroup', 'originalRead', 'originalReadGroup',
		'query', 'rawClose', 'rawInput', 'rawOpen', 'rawRead', 'resource', 'saved', 'settings', 'stacks', 'stop', 'upload'].sort());
	assert.equal(new Set(Object.values(channels)).size, Object.keys(channels).length);
	for (const channel of Object.values(channels)) assert.match(channel, /^lightscaper:v1:photo-session:[a-z-]+$/u);
	assert.ok(Object.isFrozen(channels));
});
