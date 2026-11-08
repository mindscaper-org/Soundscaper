/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { normalizePhotoCatalogQueryV2, type PhotoCatalogQueryV2 } from '../src/lightscaper/catalog/photo-query-types-v2.ts';
import { PHOTO_STACK_QUERY_LIMITS_V2, readPhotoStackQueryContinuationV2, type PhotoStackQueryContinuationV2 } from '../src/lightscaper/catalog/photo-stack-query-types-v2.ts';
import { array, field, id, record } from '../src/lightscaper/catalog/value-validation.ts';

export type LightscaperNativeStackQueryUnsignedProgressCurrentV1 = Omit<PhotoStackQueryContinuationV2, 'progressSha256'>;
const DOMAIN = 'lightscaper.native.sqlite.collapsed-photo-query.v2\0';
const MAXIMUM_BYTES = PHOTO_STACK_QUERY_LIMITS_V2.maximumContinuationBytes;
const keys = new WeakMap<DatabaseSync, Buffer>();
const retired = new WeakSet<DatabaseSync>();
// Node installs this brand-checked accessor on each instance. An unopened
// receiver supplies the intrinsic without creating a database or issuing SQL.
const nativeIsOpen = (() => {
	const unopened = new DatabaseSync(':memory:', { open: false, allowExtension: false });
	const getter = Object.getOwnPropertyDescriptor(unopened, 'isOpen')?.get;
	if (typeof getter !== 'function') throw new TypeError('Native SQLite status accessor is unavailable.');
	return getter;
})();
// This is the owning continuation normalizer's body order, including its nested
// normalized records. Borrowed property insertion order has no signing authority.
const BODY_FIELDS = ['schemaVersion', 'kind', 'catalogId', 'catalogRevision', 'indexRevision', 'querySha256',
	'captureBucket', 'afterKey', 'stateRevision', 'pending', 'stackAudit'] as const;
const ALL_FIELDS = [...BODY_FIELDS, 'progressSha256'];
const PENDING_FIELDS = ['photoId', 'stackId', 'stackRevision', 'nextMember'];
const AUDIT_FIELDS = ['afterKey', 'count'];

/** Only shared-normalized V2 bodies receive authority. Secrets never persist or
 * retain a query/catalog inventory and cannot cross actual SQLite connections. */
export function issueLightscaperNativeStackQueryProgressCurrentV1(database: DatabaseSync,
	unsigned: LightscaperNativeStackQueryUnsignedProgressCurrentV1, query: PhotoCatalogQueryV2): PhotoStackQueryContinuationV2 {
	assertConnection(database, true);
	const input = record(unsigned, 'native collapsed Query2 unsigned progress', BODY_FIELDS);
	const captured = Object.fromEntries(BODY_FIELDS.map(key => [key, field(input, key)]));
	const admittedQuery = normalizePhotoCatalogQueryV2(query), catalogId = id(field(input, 'catalogId'), 'native collapsed Query2 catalog');
	const normalized = readPhotoStackQueryContinuationV2({ ...captured, progressSha256: '0'.repeat(64) }, catalogId, admittedQuery);
	const packet = authenticationPacket(normalized);
	let key = keys.get(database);
	if (!key) { key = randomBytes(32); keys.set(database, key); }
	return Object.freeze({ ...normalized, progressSha256: signature(key, packet.body).toString('hex') });
}

/** Admission owns query/position semantics before this call. The MAC proves
 * that every scalar, pending member and audit position came from our issuer. */
export function authenticateLightscaperNativeStackQueryProgressCurrentV1(database: DatabaseSync,
	continuation: PhotoStackQueryContinuationV2 | null): void {
	assertConnection(database, true);
	if (continuation === null) return;
	const key = keys.get(database);
	if (!key) throw new TypeError('Native collapsed Query2 progress has no issuing connection authority.');
	const packet = authenticationPacket(continuation);
	if (!timingSafeEqual(signature(key, packet.body), Buffer.from(packet.progressSha256, 'hex'))) {
		throw new TypeError('Native collapsed Query2 progress signature authentication failed.');
	}
}

/** The joined owner retires before database.close(), including every manual
 * close/reopen of the same DatabaseSync object. isOpen alone cannot identify a
 * physical reopen epoch. Retirement permanently tombstones this object; direct
 * callers must use a fresh connection object for subsequent signing authority. */
export function retireLightscaperNativeStackQueryProgressCurrentV1(database: DatabaseSync): void {
	assertConnection(database, false);
	keys.get(database)?.fill(0); keys.delete(database); retired.add(database);
}

function assertConnection(database: DatabaseSync, requireOpen: boolean): void {
	// Invoke the native brand-checked accessor, never a caller's isOpen shadow or
	// a Proxy property read. A forged prototype does not possess native storage.
	const open: unknown = Reflect.apply(nativeIsOpen, database, []);
	if (typeof open !== 'boolean' || requireOpen && (!open || retired.has(database))) throw new TypeError('Native query progress requires its live issuing SQLite connection.');
}
function signature(key: Buffer, body: Readonly<Record<string, unknown>>): Buffer {
	return createHmac('sha256', key).update(DOMAIN, 'utf8').update(JSON.stringify(body), 'utf8').digest();
}

/** This is an inert wire snapshot, not an alternative continuation normalizer.
 * Valid semantics originate exclusively at issue() and the public request's
 * owning normalizer. Shape/byte checks keep even failed MAC attempts bounded. */
function authenticationPacket(value: unknown): Readonly<{ body: Readonly<Record<string, unknown>>; progressSha256: string }> {
	const input = record(value, 'native collapsed Query2 signed progress', ALL_FIELDS);
	if (field(input, 'schemaVersion') !== 2 || field(input, 'kind') !== 'collapsed-photo-query') throw new TypeError('Native collapsed progress requires its exact V2 domain.');
	const progressSha256 = field(input, 'progressSha256');
	if (typeof progressSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(progressSha256)) throw new TypeError('Native collapsed progress requires a SHA-256 signature.');
	const body = Object.fromEntries(BODY_FIELDS.map(key => {
		const entry = field(input, key);
		if (key === 'pending') return [key, nested(entry, PENDING_FIELDS)];
		if (key === 'stackAudit') return [key, nested(entry, AUDIT_FIELDS)];
		if (key === 'afterKey') return [key, entry === null ? null : array(entry, 'native query progress key', 2, 4).map(scalar)];
		return [key, scalar(entry)];
	}));
	if (Buffer.byteLength(JSON.stringify({ ...body, progressSha256 }), 'utf8') > MAXIMUM_BYTES) throw new RangeError('Native collapsed progress exceeds its public byte budget.');
	return Object.freeze({ body: Object.freeze(body), progressSha256 });
}
function nested(value: unknown, fields: readonly string[]): Readonly<Record<string, string | number>> | null {
	if (value === null) return null;
	const input = record(value, 'native query progress nested record', fields);
	return Object.freeze(Object.fromEntries(fields.map(key => [key, scalar(field(input, key))])));
}
function scalar(value: unknown): string | number {
	if (typeof value === 'string') {
		if (value.length > MAXIMUM_BYTES) throw new RangeError('Native query progress text exceeds its public byte budget.');
		return value;
	}
	if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
	throw new TypeError('Native query progress requires inert bounded scalar data.');
}
