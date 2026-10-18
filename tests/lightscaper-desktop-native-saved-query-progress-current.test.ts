/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { issueLightscaperNativeSavedQueryProgressCurrentV1 as issue, authenticateLightscaperNativeSavedQueryProgressCurrentV1 as authenticate,
	retireLightscaperNativeSavedQueryProgressCurrentV1 as retire } from '../desktop/lightscaper-native-smart-collection-query-progress-current-v1.ts';
import type { PhotoSavedQueryContinuationV1 } from '../src/lightscaper/catalog/photo-smart-collection-query-types-v1.ts';

function body(mode: 'ordinary' | 'collapsed' = 'ordinary'): Omit<PhotoSavedQueryContinuationV1, 'progressSha256'> {
	return { schemaVersion: 1, kind: 'saved-photo-query', mode, catalogId: 'catalog', collectionId: 'saved', definitionRevision: 2,
		collectionStateRevision: 7, definitionSha256: 'a'.repeat(64), querySha256: 'b'.repeat(64), catalogRevision: 3, indexRevision: 11,
		sort: { field: 'photo-id', direction: 'ascending' }, captureBucket: 0, afterKey: ['catalog', 'photo'],
		stackStateRevision: mode === 'collapsed' ? 5 : null, pending: mode === 'collapsed' ? { photoId: 'photo', stackId: 'stack', stackRevision: 0, nextMember: 64 } : null, stackAudit: null };
}
for (const mode of ['ordinary', 'collapsed'] as const) test(`Lightscaper native saved signer binds all18 ${mode} fields to its actual SQLite connection`, () => {
	const db = new DatabaseSync(':memory:'), other = new DatabaseSync(':memory:');
	try {
		const token = issue(db, body(mode)); assert.equal(Object.keys(token).length, 18); authenticate(db, token);
		assert.throws(() => authenticate(other, token)); assert.throws(() => authenticate(db, { ...token, collectionId: 'other' }));
		assert.throws(() => authenticate(db, { ...token, definitionSha256: 'c'.repeat(64) }));
		if (token.pending) assert.throws(() => authenticate(db, { ...token, pending: { ...token.pending!, nextMember: 65 } }));
	} finally { retire(db); retire(other); db.close(); other.close(); }
});
test('Lightscaper native saved signer normalizes property order and owns nested inert snapshots', () => {
	const db = new DatabaseSync(':memory:');
	try {
		const original = body('collapsed'), reversed = Object.fromEntries(Object.entries(original).reverse()) as unknown as ReturnType<typeof body>;
		const token = issue(db, reversed);
		authenticate(db, Object.fromEntries(Object.entries(token).reverse()) as unknown as PhotoSavedQueryContinuationV1); assert.ok(Object.isFrozen(token.pending));
		let calls = 0; assert.throws(() => issue(db, { ...body(), get sort() { calls++; return body().sort; } })); assert.equal(calls, 0);
	} finally { retire(db); db.close(); }
});
test('Lightscaper native saved signer refuses forged, proxied, unopened, shadowed and retired SQLite authority', () => {
	const db = new DatabaseSync(':memory:'), unopened = new DatabaseSync(':memory:', { open: false });
	try {
		assert.throws(() => issue(Object.create(DatabaseSync.prototype) as DatabaseSync, body())); assert.throws(() => issue(new Proxy(db, {}), body())); assert.throws(() => issue(unopened, body()));
		const token = issue(db, body()); authenticate(db, token);
		const shadow = Object.create(db) as DatabaseSync; Object.defineProperty(shadow, 'isOpen', { value: true });
		assert.throws(() => issue(shadow, body())); authenticate(db, token);
		retire(db); assert.throws(() => authenticate(db, null)); assert.throws(() => issue(db, body()));
	} finally { db.close(); }
});
test('Lightscaper native saved signer tombstones close/reopen on the same object and never accepts malformed domain or extra fields', () => {
	const db = new DatabaseSync(':memory:');
	try {
		const token = issue(db, body()); assert.throws(() => authenticate(db, { ...token, kind: 'collapsed-photo-query' } as never));
		assert.throws(() => authenticate(db, { ...token, extra: 1 } as never)); assert.throws(() => issue(db, { ...body(), catalogRevision: -0 }));
		retire(db); db.close(); db.open(); assert.throws(() => issue(db, body())); assert.throws(() => authenticate(db, token));
	} finally { db.close(); }
});
