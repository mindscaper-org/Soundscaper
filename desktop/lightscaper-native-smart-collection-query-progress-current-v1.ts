/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readPhotoSavedQueryContinuationV1, type PhotoSavedQueryContinuationV1 } from '../src/lightscaper/catalog/photo-smart-collection-query-types-v1.ts';
import { serializePhotoSmartCollectionV1, type PhotoSmartCollectionV1 } from '../src/lightscaper/catalog/photo-smart-collection-v1.ts';
import { field, id, oneOf, record } from '../src/lightscaper/catalog/value-validation.ts';

export type LightscaperNativeSavedQueryUnsignedProgressCurrentV1 = Omit<PhotoSavedQueryContinuationV1, 'progressSha256'>;
const DOMAIN = 'lightscaper.native.sqlite.saved-photo-query.v1\0';
const keys = new WeakMap<DatabaseSync, Buffer>(), retired = new WeakSet<DatabaseSync>();
const nativeIsOpen = (() => {
	const unopened = new DatabaseSync(':memory:', { open: false, allowExtension: false });
	const getter = Object.getOwnPropertyDescriptor(unopened, 'isOpen')?.get;
	if (typeof getter !== 'function') throw new TypeError('Native SQLite status accessor is unavailable.');
	return getter;
})();
const BODY_FIELDS = ['schemaVersion', 'kind', 'mode', 'catalogId', 'collectionId', 'definitionRevision', 'collectionStateRevision',
	'definitionSha256', 'querySha256', 'catalogRevision', 'indexRevision', 'sort', 'captureBucket', 'afterKey', 'stackStateRevision', 'pending', 'stackAudit'] as const;

export function issueLightscaperNativeSavedQueryProgressCurrentV1(database: DatabaseSync,
	unsigned: LightscaperNativeSavedQueryUnsignedProgressCurrentV1): PhotoSavedQueryContinuationV1 {
	assertConnection(database, true);
	const input = record(unsigned, 'native saved unsigned progress', BODY_FIELDS);
	const normalized = normalize({ ...Object.fromEntries(BODY_FIELDS.map(key => [key, field(input, key)])), progressSha256: '0'.repeat(64) });
	const { progressSha256: _placeholder, ...body } = normalized;
	let key = keys.get(database); if (!key) { key = randomBytes(32); keys.set(database, key); }
	return Object.freeze({ ...body, progressSha256: signature(key, body).toString('hex') });
}
export function authenticateLightscaperNativeSavedQueryProgressCurrentV1(database: DatabaseSync,
	continuation: PhotoSavedQueryContinuationV1 | null): void {
	assertConnection(database, true); if (continuation === null) return;
	const key = keys.get(database); if (!key) throw new TypeError('Native saved progress has no issuing connection authority.');
	const { progressSha256, ...body } = normalize(continuation);
	if (!timingSafeEqual(signature(key, body), Buffer.from(progressSha256, 'hex'))) throw new TypeError('Native saved query progress signature authentication failed.');
}
/** Called only after every queued and escaped reader has joined, before close.
 * A retired object cannot regain authority through manual close/open reuse. */
export function retireLightscaperNativeSavedQueryProgressCurrentV1(database: DatabaseSync): void {
	assertConnection(database, false); keys.get(database)?.fill(0); keys.delete(database); retired.add(database);
}
export function lightscaperNativeSavedDefinitionDigestCurrentV1(definition: PhotoSmartCollectionV1): string {
	return createHash('sha256').update(serializePhotoSmartCollectionV1(definition), 'utf8').digest('hex');
}
function assertConnection(database: DatabaseSync, requireOpen: boolean): void {
	const open: unknown = Reflect.apply(nativeIsOpen, database, []);
	if (typeof open !== 'boolean' || requireOpen && (!open || retired.has(database))) throw new TypeError('Native saved progress requires its live issuing SQLite connection.');
}
function signature(key: Buffer, body: LightscaperNativeSavedQueryUnsignedProgressCurrentV1): Buffer {
	return createHmac('sha256', key).update(DOMAIN, 'utf8').update(JSON.stringify(body), 'utf8').digest();
}
function normalize(value: unknown): PhotoSavedQueryContinuationV1 {
	const input = record(value, 'native saved progress', [...BODY_FIELDS, 'progressSha256']);
	const catalog = id(field(input, 'catalogId'), 'native saved catalog'), collection = id(field(input, 'collectionId'), 'native saved collection');
	const mode = oneOf(field(input, 'mode'), ['ordinary', 'collapsed'] as const, 'native saved query mode');
	return readPhotoSavedQueryContinuationV1(input, catalog, collection, mode);
}
