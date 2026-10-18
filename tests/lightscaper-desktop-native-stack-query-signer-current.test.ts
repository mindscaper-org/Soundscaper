/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { constants, DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { authenticateLightscaperNativeStackQueryProgressCurrentV1 as authenticate,
	issueLightscaperNativeStackQueryProgressCurrentV1 as issue,
	retireLightscaperNativeStackQueryProgressCurrentV1 as retire } from '../desktop/lightscaper-native-stack-query-progress-current-v1.ts';
import { normalizePhotoCatalogQueryV2, photoQueryDigestV2 } from '../src/lightscaper/catalog/photo-query-types-v2.ts';
import { PHOTO_STACK_QUERY_LIMITS_V2, readPhotoStackQueryContinuationV2, type PhotoStackQueryContinuationV2 } from '../src/lightscaper/catalog/photo-stack-query-types-v2.ts';

type Unsigned = Omit<PhotoStackQueryContinuationV2, 'progressSha256'>;
const query = normalizePhotoCatalogQueryV2();
function progress(changed: Partial<Unsigned> = {}): Unsigned {
	return { schemaVersion: 2, kind: 'collapsed-photo-query', catalogId: 'catalog', catalogRevision: 3, indexRevision: 11,
		stateRevision: 5, querySha256: photoQueryDigestV2(query), captureBucket: 0, afterKey: null, pending: null, stackAudit: null, ...changed };
}
const pending = (): Unsigned => progress({ afterKey: ['catalog', 'photo-1'], pending: { photoId: 'photo-1', stackId: 'stack-1', stackRevision: 4, nextMember: 63 } });
const auditing = (): Unsigned => progress({ stackAudit: { afterKey: 'catalog|stack-64', count: 64 } });
function withDatabase(run: (database: DatabaseSync) => void): void {
	const database = new DatabaseSync(':memory:', { allowExtension: false, enableDoubleQuotedStringLiterals: false });
	try { run(database); } finally { retire(database); database.close(); }
}
const invokeAuthenticate = (database: unknown, value: unknown): unknown => Reflect.apply(authenticate, undefined, [database, value]);
const invokeIssue = (database: unknown, value: unknown, currentQuery: unknown = query): unknown => Reflect.apply(issue, undefined, [database, value, currentQuery]);

test('Lightscaper native stack Query2 signer preserves the exact owning normalized body and bounds every issued public continuation', () => {
	withDatabase(database => {
		authenticate(database, null);
		for (const unsigned of [progress(), pending(), auditing()]) {
			const value = issue(database, unsigned, query), normalized = readPhotoStackQueryContinuationV2(value, 'catalog', query);
			assert.deepEqual(value, normalized); assert.match(value.progressSha256, /^[a-f0-9]{64}$/u);
			const { progressSha256: _signature, ...body } = value; assert.deepEqual(body, unsigned);
			assert.ok(Buffer.byteLength(JSON.stringify(value), 'utf8') <= PHOTO_STACK_QUERY_LIMITS_V2.maximumContinuationBytes);
			assert.equal(Object.isFrozen(value), true); authenticate(database, value); authenticate(database, value);
		}
	});
});

test('Lightscaper native stack Query2 signer owns no schema or SQL side effects', () => {
	withDatabase(database => {
		database.setAuthorizer(() => constants.SQLITE_DENY);
		try { const value = issue(database, pending(), query); authenticate(database, value); }
		finally { database.setAuthorizer(null); }
		assert.deepEqual(database.prepare("SELECT name FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*'").all(), []);
	});
});

test('Lightscaper native stack Query2 signature covers every revision, query identity and pending position', () => {
	withDatabase(database => {
		const value = issue(database, pending(), query);
		for (const change of [{ catalogRevision: 4 }, { indexRevision: 12 }, { stateRevision: 6 }, { catalogId: 'other' },
			{ querySha256: 'a'.repeat(64) }, { captureBucket: 1 }, { afterKey: ['catalog', 'photo-2'], pending: { ...value.pending!, photoId: 'photo-2' } },
			{ pending: { ...value.pending!, nextMember: 64 } }, { pending: { ...value.pending!, stackId: 'stack-2' } },
			{ pending: { ...value.pending!, stackRevision: 5 } }, { progressSha256: '0'.repeat(64) }]) {
			assert.throws(() => invokeAuthenticate(database, { ...value, ...change }));
		}
		authenticate(database, value);
	});
});

test('Lightscaper native stack Query2 signature covers initial count audit and cannot skip or invent audited keys', () => {
	withDatabase(database => {
		const value = issue(database, auditing(), query);
		for (const stackAudit of [null, { afterKey: 'catalog|stack-65', count: 64 }, { afterKey: 'catalog|stack-64', count: 65 }]) {
			assert.throws(() => invokeAuthenticate(database, { ...value, stackAudit }));
		}
		authenticate(database, value);
	});
});

test('Lightscaper native stack Query2 signer snapshots borrowed unsigned arrays and nested pending data before returning', () => {
	withDatabase(database => {
		const unsigned = pending(), value = issue(database, unsigned, query);
		assert.ok(unsigned.afterKey && unsigned.pending); Reflect.set(unsigned.afterKey, 1, 'moved'); Reflect.set(unsigned.pending, 'nextMember', 1000);
		assert.deepEqual(value.afterKey, ['catalog', 'photo-1']); assert.equal(value.pending?.nextMember, 63);
		assert.equal(Object.isFrozen(value.afterKey), true); assert.equal(Object.isFrozen(value.pending), true); authenticate(database, value);
	});
});

test('Lightscaper native stack Query2 signer uses normalized property order including nested pending and audit bodies', () => {
	withDatabase(database => {
		for (const unsigned of [pending(), auditing()]) {
			const value = issue(database, unsigned, query), reordered = Object.fromEntries(Object.entries(value).reverse());
			if (value.pending) reordered.pending = Object.fromEntries(Object.entries(value.pending).reverse());
			if (value.stackAudit) reordered.stackAudit = Object.fromEntries(Object.entries(value.stackAudit).reverse());
			assert.doesNotThrow(() => invokeAuthenticate(database, reordered));
		}
	});
});

test('Lightscaper native stack Query2 signer refuses protocol confusion, wrong query digest and oversized unsigned payloads', () => {
	withDatabase(database => {
		for (const change of [{ schemaVersion: 1 }, { schemaVersion: 3 }, { kind: 'photo-query' }, { kind: 'saved-stack-query' },
			{ querySha256: '0'.repeat(64) }, { extra: true }]) assert.throws(() => invokeIssue(database, { ...progress(), ...change }));
		const fileQuery = normalizePhotoCatalogQueryV2({ schemaVersion: 2, kind: 'photo-catalog-query', sort: { field: 'file-name', direction: 'ascending' } });
		assert.throws(() => invokeIssue(database, progress({ querySha256: photoQueryDigestV2(fileQuery), afterKey: ['catalog', 'ä'.repeat(4096), 'photo-1'] }), fileQuery));
		const value = issue(database, pending(), query);
		for (const change of [{ schemaVersion: 1 }, { kind: 'photo-query' }, { extra: true }, { progressSha256: 'A'.repeat(64) },
			{ progressSha256: 'a'.repeat(63) }, { afterKey: ['catalog', 'x'.repeat(4096), 'photo-1'] }]) assert.throws(() => invokeAuthenticate(database, { ...value, ...change }));
	});
});

test('Lightscaper native stack Query2 signer never invokes borrowed getters or toJSON during issuance or authentication', () => {
	withDatabase(database => {
		let invoked = 0;
		assert.throws(() => invokeIssue(database, { ...progress(), get pending() { invoked++; return null; } }));
		assert.throws(() => invokeIssue(database, progress(), { ...query, get text() { invoked++; return ''; } }));
		const value = issue(database, pending(), query);
		assert.throws(() => invokeAuthenticate(database, { ...value, get progressSha256() { invoked++; return value.progressSha256; } }));
		assert.throws(() => invokeAuthenticate(database, { ...value, pending: { ...value.pending!, get nextMember() { invoked++; return 63; } } }));
		assert.throws(() => invokeAuthenticate(database, { ...value, afterKey: ['catalog', { toJSON() { invoked++; return 'photo-1'; } }] }));
		assert.equal(invoked, 0); authenticate(database, value);
	});
});

test('Lightscaper native stack Query2 progress belongs to the actual SQLite connection and survives ordinary same-connection replay', () => {
	withDatabase(first => withDatabase(second => {
		const old = issue(first, pending(), query), newer = issue(first, auditing(), query);
		assert.throws(() => authenticate(second, old)); assert.throws(() => authenticate(second, newer));
		authenticate(first, old); authenticate(first, newer);
		const otherQuery = normalizePhotoCatalogQueryV2({ schemaVersion: 2, kind: 'photo-catalog-query', text: 'later' });
		issue(first, progress({ querySha256: photoQueryDigestV2(otherQuery) }), otherQuery); authenticate(first, old);
	}));
});

test('Lightscaper native stack Query2 signer refuses structurally forged or Proxy-wrapped SQLite owners without invoking isOpen shadows', () => {
	withDatabase(database => {
		let invoked = 0;
		for (const fake of [{ isOpen: true }, { get isOpen() { invoked++; throw Error('borrowed shadow'); } }, Object.create(DatabaseSync.prototype) as unknown,
			new Proxy(database, { get(target, key, receiver) { invoked++; return Reflect.get(target, key, receiver) as unknown; } })]) {
			assert.throws(() => invokeIssue(fake, progress())); assert.throws(() => invokeAuthenticate(fake, null));
		}
		assert.equal(Object.getOwnPropertyDescriptor(database, 'isOpen')?.configurable, false);
		assert.throws(() => Object.defineProperty(database, 'isOpen', { get() { invoked++; throw Error('borrowed shadow'); } }), TypeError);
		const value = issue(database, progress(), query); authenticate(database, value); assert.equal(invoked, 0);
	});
});

test('Lightscaper native stack Query2 retirement erases signing authority permanently and remains idempotent after database close', () => {
	const database = new DatabaseSync(':memory:');
	try {
		const value = issue(database, pending(), query); retire(database); retire(database);
		assert.throws(() => authenticate(database, value)); assert.throws(() => issue(database, progress(), query)); assert.throws(() => authenticate(database, null));
		database.close(); retire(database); database.open();
		assert.throws(() => authenticate(database, value)); assert.throws(() => issue(database, progress(), query)); retire(database);
	} finally { if (database.isOpen) database.close(); }
	const closed = new DatabaseSync(':memory:'); closed.close();
	try { assert.throws(() => issue(closed, progress(), query)); assert.throws(() => authenticate(closed, null)); } finally { retire(closed); }
	const unissued = new DatabaseSync(':memory:');
	try { retire(unissued); assert.throws(() => issue(unissued, progress(), query)); }
	finally { unissued.close(); }
});

test('Lightscaper native stack Query2 signer rejects closed connections and a reopened file cannot inherit old authority', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'lightscaper native query signer ')); let first: DatabaseSync | undefined, second: DatabaseSync | undefined;
	try {
		const path = join(directory, 'catalog.sqlite3'); first = new DatabaseSync(path); const value = issue(first, pending(), query);
		retire(first); first.close(); assert.throws(() => authenticate(first!, value)); assert.throws(() => issue(first!, progress(), query));
		second = new DatabaseSync(path); assert.throws(() => authenticate(second!, value));
		const current = issue(second, pending(), query); authenticate(second, current); assert.notEqual(current.progressSha256, value.progressSha256);
	} finally { if (first) retire(first); if (second) { retire(second); second.close(); } if (first?.isOpen) first.close(); await rm(directory, { recursive: true, force: false }); }
});
