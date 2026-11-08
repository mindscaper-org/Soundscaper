/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import test from 'node:test';
import { admitLightscaperNativeCullingNavigationCurrentV1 as admit,
	readAdmittedLightscaperNativeCullingNavigationCurrentV1 as readPacket } from '../desktop/lightscaper-native-culling-admission-current-v1.ts';
import { normalizePhotoCatalogQueryV1 } from '../src/lightscaper/catalog/photo-query-types-v1.ts';
import { normalizePhotoCatalogQueryV2 } from '../src/lightscaper/catalog/photo-query-types-v2.ts';

const query = normalizePhotoCatalogQueryV2();
const plain = Object.freeze({ kind: 'plain' });

test('Lightscaper native culling captures all seven closed contexts into genuine detached packets', () => {
	const contexts = [plain,
		...[false, true].flatMap(collapsed => [
			{ kind: 'query', query: normalizePhotoCatalogQueryV1(), collapsed },
			{ kind: 'query', query, collapsed }, { kind: 'saved', collectionId: 'saved', collapsed }
		])];
	for (const context of contexts) {
		const packet = admit('catalog', context, { photoId: 'photo' });
		assert.equal(readPacket(packet), packet); assert.ok(Object.isFrozen(packet)); assert.ok(Object.isFrozen(packet.context));
		assert.deepEqual(Object.keys(packet).sort(), ['catalogId', 'context', 'photoId']);
		assert.throws(() => readPacket({ ...packet }), TypeError);
	}
	const mutable = { kind: 'query', query: { ...query, sort: { field: 'rating', direction: 'ascending' } }, collapsed: false };
	const request = { photoId: 'before' }, packet = admit('catalog', mutable, request);
	mutable.query.sort.direction = 'descending'; mutable.query.text = 'mutated'; request.photoId = 'after';
	assert.equal(packet.photoId, 'before');
	assert.equal(packet.context.kind, 'query');
	if (packet.context.kind === 'query') { assert.equal(packet.context.query.sort.direction, 'ascending'); assert.equal(packet.context.query.text, ''); }
});

test('Lightscaper native culling rejects caller cursor, inclusive, profile and getter authority without invoking accessors', () => {
	let getters = 0;
	const invalid = [
		[plain, { photoId: 'photo', continuation: null }], [plain, { photoId: 'photo', signal: {} }],
		[{ ...plain, inclusive: true }, { photoId: 'photo' }],
		[{ kind: 'query', query, collapsed: false, profile: 'metadata' }, { photoId: 'photo' }],
		[{ kind: 'saved', collectionId: 'saved' }, { photoId: 'photo' }],
		[{ kind: 'query', query: { ...query, schemaVersion: 3 }, collapsed: false }, { photoId: 'photo' }],
		[plain, { get photoId() { getters++; return 'photo'; } }],
		[{ kind: 'saved', get collectionId() { getters++; return 'saved'; }, collapsed: false }, { photoId: 'photo' }],
		[Object.create({ kind: 'plain' }) as unknown, { photoId: 'photo' }]
	];
	for (const [context, request] of invalid) assert.throws(() => admit('catalog', context, request));
	assert.equal(getters, 0);
});

test('Lightscaper native culling captured cancellation precedes a later borrowed context failure and disposes links', () => {
	const caller = new AbortController(), owner = new AbortController(), reason = Symbol('caller'), secondary = Symbol('trap');
	const before = [caller, owner].map(value => getEventListeners(value.signal, 'abort').length);
	const context = new Proxy({ kind: 'plain' }, { ownKeys() { caller.abort(reason); throw secondary; } });
	assert.throws(() => admit('catalog', context, { photoId: 'photo', signal: caller.signal }, owner.signal), error => error === reason);
	assert.deepEqual([caller, owner].map(value => getEventListeners(value.signal, 'abort').length), before);
});

test('Lightscaper native culling synchronous admission preserves first joined owner reason over later caller reason', () => {
	const caller = new AbortController(), owner = new AbortController(), reason = Symbol('owner');
	const context = new Proxy({ kind: 'plain' }, { ownKeys(target) { owner.abort(reason); caller.abort(Symbol('later')); return Reflect.ownKeys(target); } });
	assert.throws(() => admit('catalog', context, { photoId: 'photo', signal: caller.signal }, owner.signal), error => error === reason);
	assert.equal(getEventListeners(caller.signal, 'abort').length, 0); assert.equal(getEventListeners(owner.signal, 'abort').length, 0);
});

test('Lightscaper native culling late native signal shadows are never executed during joined admission cancellation', () => {
	const caller = new AbortController(), owner = new AbortController(), reason = Symbol('opaque'); let getters = 0;
	const context = new Proxy({ kind: 'plain' }, { ownKeys(target) {
		Object.defineProperties(caller.signal, { aborted: { configurable: true, get() { getters++; throw Error('aborted shadow'); } },
			reason: { configurable: true, get() { getters++; throw Error('reason shadow'); } } });
		caller.abort(reason); return Reflect.ownKeys(target);
	} });
	try {
		assert.throws(() => admit('catalog', context, { photoId: 'photo', signal: caller.signal }, owner.signal), error => error === reason);
		assert.equal(getters, 0);
	} finally { Reflect.deleteProperty(caller.signal, 'aborted'); Reflect.deleteProperty(caller.signal, 'reason'); }
});

test('Lightscaper native culling already aborted caller has defined priority and never inspects opaque reasons', () => {
	let traps = 0;
	const reason = new Proxy({}, { get() { traps++; throw Error('reason reflected'); }, getPrototypeOf() { traps++; throw Error('reason traversed'); } });
	const caller = new AbortController(), owner = new AbortController(); caller.abort(reason); owner.abort(Symbol('owner'));
	assert.throws(() => admit('catalog', plain, { photoId: 'photo', signal: caller.signal }, owner.signal), error => error === reason);
	assert.equal(traps, 0);
});
