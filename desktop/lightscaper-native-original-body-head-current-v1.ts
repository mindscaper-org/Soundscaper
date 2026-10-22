/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../src/common/editor/closed-domain-value.ts';
import { readLightscaperNativeOriginalBindingCurrentV1 as binding,
	type LightscaperNativeOriginalBindingCurrentV1 as Binding } from './lightscaper-native-original-index-current-v1.ts';

export const LIGHTSCAPER_NATIVE_ORIGINAL_BODY_GENERATION_LIMIT_CURRENT_V1 = 9;
export interface LightscaperNativeOriginalBodyLocatorCurrentV1 {
	readonly contentSha256: string; readonly locatorId: string; readonly byteLength: number;
	readonly layout: 'legacy-sha-v1' | 'generation-v1';
}
export interface LightscaperNativeOriginalBodyHeadCurrentV1 extends LightscaperNativeOriginalBodyLocatorCurrentV1 {
	/** null is actual head absence, explicitly resolved to the historical path. */
	readonly revision: number | null;
}
type Locator = Readonly<LightscaperNativeOriginalBodyLocatorCurrentV1>;
type Head = Readonly<LightscaperNativeOriginalBodyHeadCurrentV1>;
type Row = Readonly<Record<string, unknown>>;
const MAXIMUM = 205520896;
const LOCATOR_COLUMNS = `CASE WHEN typeof(content_sha256)='text' AND length(CAST(content_sha256 AS BLOB))=64 THEN content_sha256 END AS sha,
	CASE WHEN typeof(locator_id)='text' AND length(CAST(locator_id AS BLOB))<=64 THEN locator_id END AS id,
	CASE WHEN typeof(byte_length)='integer' AND byte_length BETWEEN 1 AND ${MAXIMUM} THEN byte_length END AS bytes,
	CASE WHEN typeof(layout)='text' AND length(CAST(layout AS BLOB))<=32 THEN layout END AS layout`;

/** Scalar identity only: no locator row proves that bytes exist or hash-match.
 * Outside a caller snapshot this owns one short, coherent read transaction. */
export function readLightscaperNativeOriginalBodyHeadCurrentV1(database: DatabaseSync, value: unknown): Head {
	const expected = binding(value);
	if (database.isTransaction) return readHead(database, expected);
	database.exec('BEGIN');
	try { const result = readHead(database, expected); database.exec('COMMIT'); return result; }
	catch (primary) {
		try { if (database.isTransaction) database.exec('ROLLBACK'); }
		catch (cleanup) { throw new AggregateError([primary, cleanup], 'Native Original head read and rollback failed.', { cause: cleanup }); }
		throw primary;
	}
}

/** Caller owns BEGIN IMMEDIATE/COMMIT. Reservation precedes file IO so failed
 * attempts consume bounded durable debt; it never authenticates a file. */
export function reserveLightscaperNativeOriginalBodyLocatorCurrentV1(database: DatabaseSync, value: unknown,
	locatorId: unknown): Locator {
	active(database); const expected = binding(value), id = generatedId(locatorId);
	readHead(database, expected); const before = inventory(database, expected);
	if (before.some(row => row.locatorId === id)) throw new Error('Native Original locator identity is already reserved.');
	if (before.filter(row => row.layout === 'generation-v1').length >= LIGHTSCAPER_NATIVE_ORIGINAL_BODY_GENERATION_LIMIT_CURRENT_V1) {
		throw new Error('Native Original repair generation debt is full.');
	}
	const legacy: Locator = Object.freeze({ contentSha256: expected.contentSha256, locatorId: 'legacy', byteLength: expected.byteLength, layout: 'legacy-sha-v1' });
	if (!before.some(row => row.locatorId === 'legacy')) insertLocator(database, legacy);
	const next: Locator = Object.freeze({ contentSha256: expected.contentSha256, locatorId: id, byteLength: expected.byteLength, layout: 'generation-v1' });
	insertLocator(database, next);
	const required = [...before, ...(before.some(row => row.locatorId === 'legacy') ? [] : [legacy]), next].sort(order);
	if (JSON.stringify(inventory(database, expected)) !== JSON.stringify(required)) throw new Error('Native Original locator reservation changed its immutable inventory.');
	return next;
}

/** Only the physical publisher may call after consuming its genuine body
 * proof. This scalar CAS requires its already-reserved candidate and leaves
 * COMMIT, cancellation and uncertain-ACK reconciliation to that owner. */
export function switchLightscaperNativeOriginalBodyHeadCurrentV1(database: DatabaseSync, value: unknown,
	expectedValue: unknown, locatorId: unknown): Head {
	active(database); const expected = binding(value), previous = expectedHead(expectedValue, expected), id = generatedId(locatorId);
	const current = readHead(database, expected), before = inventory(database, expected);
	if (!sameHead(current, previous)) throw new Error('Native Original head changed before publication.');
	const next = before.find(row => row.locatorId === id);
	if (!next || next.layout !== 'generation-v1' || current.locatorId === id) throw new Error('Native Original head requires its distinct reserved generation.');
	const revision = current.revision === null ? 0 : current.revision + 1;
	if (!Number.isSafeInteger(revision)) throw new RangeError('Native Original head revision exceeds its safe integer bound.');
	const result = current.revision === null
		? database.prepare('INSERT INTO native_photo_original_body_heads(content_sha256,locator_id,byte_length,revision) VALUES(?,?,?,?)')
			.run(expected.contentSha256, id, expected.byteLength, revision)
		: database.prepare('UPDATE native_photo_original_body_heads SET locator_id=?,byte_length=?,revision=? WHERE content_sha256=? AND locator_id=? AND byte_length=? AND revision=?')
			.run(id, expected.byteLength, revision, expected.contentSha256, current.locatorId, expected.byteLength, current.revision);
	if (result.changes !== 1) throw new Error('Native Original head CAS was not published.');
	const candidate: Head = Object.freeze({ ...next, revision }), stored = readHead(database, expected);
	if (!sameHead(stored, candidate) || JSON.stringify(inventory(database, expected)) !== JSON.stringify(before)) {
		throw new Error('Native Original head or immutable locators changed before acknowledgment.');
	}
	return stored;
}

function readHead(database: DatabaseSync, expected: Readonly<Binding>): Head {
	if (database.prepare('SELECT 1 AS collision FROM native_photo_original_bindings WHERE content_sha256=? AND byte_length<>? LIMIT 1')
		.get(expected.contentSha256, expected.byteLength)
		|| database.prepare('SELECT 1 AS collision FROM native_photo_original_body_locators WHERE content_sha256=? AND byte_length<>? LIMIT 1')
			.get(expected.contentSha256, expected.byteLength)) throw new Error('Native Original SHA-256 has conflicting byte lengths.');
	const row = database.prepare(`SELECT
		CASE WHEN typeof(h.locator_id)='text' AND length(CAST(h.locator_id AS BLOB))<=64 THEN h.locator_id END AS head_id,
		CASE WHEN typeof(h.byte_length)='integer' AND h.byte_length BETWEEN 1 AND ${MAXIMUM} THEN h.byte_length END AS head_bytes,
		CASE WHEN typeof(h.revision)='integer' AND h.revision BETWEEN 0 AND 9007199254740991 THEN h.revision END AS revision,
		CASE WHEN typeof(l.content_sha256)='text' AND length(CAST(l.content_sha256 AS BLOB))=64 THEN l.content_sha256 END AS sha,
		CASE WHEN typeof(l.locator_id)='text' AND length(CAST(l.locator_id AS BLOB))<=64 THEN l.locator_id END AS id,
		CASE WHEN typeof(l.byte_length)='integer' AND l.byte_length BETWEEN 1 AND ${MAXIMUM} THEN l.byte_length END AS bytes,
		CASE WHEN typeof(l.layout)='text' AND length(CAST(l.layout AS BLOB))<=32 THEN l.layout END AS layout
		FROM native_photo_original_body_heads h LEFT JOIN native_photo_original_body_locators l
		ON l.content_sha256=h.content_sha256 AND l.locator_id=h.locator_id AND l.byte_length=h.byte_length WHERE h.content_sha256=?`).get(expected.contentSha256);
	if (!row) {
		const legacy = database.prepare(`SELECT ${LOCATOR_COLUMNS} FROM native_photo_original_body_locators WHERE content_sha256=? AND locator_id='legacy'`).get(expected.contentSha256);
		if (legacy) locator(legacy, expected);
		return Object.freeze({ contentSha256: expected.contentSha256, locatorId: 'legacy', byteLength: expected.byteLength, layout: 'legacy-sha-v1', revision: null });
	}
	const resolved = locator(row, expected);
	if (row.head_id !== resolved.locatorId || row.head_bytes !== expected.byteLength || typeof row.revision !== 'number'
		|| !Number.isSafeInteger(row.revision) || row.revision < 0) throw new Error('Native Original head is corrupt or its locator is missing.');
	return Object.freeze({ ...resolved, revision: row.revision });
}
function inventory(database: DatabaseSync, expected: Readonly<Binding>): readonly Locator[] {
	const rows = database.prepare(`SELECT ${LOCATOR_COLUMNS} FROM native_photo_original_body_locators WHERE content_sha256=? ORDER BY locator_id
		LIMIT ${LIGHTSCAPER_NATIVE_ORIGINAL_BODY_GENERATION_LIMIT_CURRENT_V1 + 2}`).all(expected.contentSha256);
	const result = rows.map(row => locator(row, expected));
	if (result.filter(row => row.layout === 'generation-v1').length > LIGHTSCAPER_NATIVE_ORIGINAL_BODY_GENERATION_LIMIT_CURRENT_V1) {
		throw new Error('Native Original locator inventory exceeds its bounded repair debt.');
	}
	return result;
}
function insertLocator(database: DatabaseSync, value: Locator): void {
	const result = database.prepare('INSERT INTO native_photo_original_body_locators(content_sha256,locator_id,byte_length,layout) VALUES(?,?,?,?)')
		.run(value.contentSha256, value.locatorId, value.byteLength, value.layout);
	if (result.changes !== 1) throw new Error('Native Original locator reservation was not published.');
	const stored = database.prepare(`SELECT ${LOCATOR_COLUMNS} FROM native_photo_original_body_locators WHERE content_sha256=? AND locator_id=?`)
		.get(value.contentSha256, value.locatorId);
	if (!stored || JSON.stringify(locator(stored, value)) !== JSON.stringify(value)) throw new Error('Native Original locator reservation changed before acknowledgment.');
}
function locator(row: Row, expected: Readonly<Pick<Binding, 'contentSha256' | 'byteLength'>>): Locator {
	if (row.sha !== expected.contentSha256 || row.bytes !== expected.byteLength || typeof row.id !== 'string'
		|| !(row.id === 'legacy' ? row.layout === 'legacy-sha-v1' : /^[a-f0-9]{64}$/u.test(row.id) && row.layout === 'generation-v1')) {
		throw new Error('Native Original locator scalar identity or layout is corrupt.');
	}
	return Object.freeze({ contentSha256: expected.contentSha256, locatorId: row.id, byteLength: expected.byteLength,
		layout: row.id === 'legacy' ? 'legacy-sha-v1' : 'generation-v1' });
}
function expectedHead(value: unknown, expected: Readonly<Binding>): Head {
	const input = record(value, 'native Original expected head', ['contentSha256', 'locatorId', 'byteLength', 'layout', 'revision']);
	const key = (name: string) => field(input, name, 'native Original expected head');
	const resolved = locator({ sha: key('contentSha256'), id: key('locatorId'), bytes: key('byteLength'), layout: key('layout') }, expected);
	const revision = key('revision');
	if (revision !== null && (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0)) {
		throw new TypeError('Native Original expected head revision is invalid.');
	}
	if (revision === null && resolved.locatorId !== 'legacy') throw new TypeError('Absent native Original heads require the legacy locator.');
	return Object.freeze({ ...resolved, revision });
}
function sameHead(left: Head, right: Head): boolean {
	return left.contentSha256 === right.contentSha256 && left.locatorId === right.locatorId && left.byteLength === right.byteLength
		&& left.layout === right.layout && left.revision === right.revision;
}
function generatedId(value: unknown): string {
	if (typeof value !== 'string' || value.length !== 64 || !/^[a-f0-9]{64}$/u.test(value)) throw new TypeError('Native Original generation requires a lowercase 64-hex identity.');
	return value;
}
function active(database: DatabaseSync): void { if (!database.isTransaction) throw new Error('Native Original publication requires its caller IMMEDIATE transaction.'); }
function order(left: Locator, right: Locator): number { return left.locatorId < right.locatorId ? -1 : left.locatorId > right.locatorId ? 1 : 0; }
