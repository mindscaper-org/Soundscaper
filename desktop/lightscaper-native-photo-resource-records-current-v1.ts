/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import { VIDEO_COLOR_LIMITS_V1 } from '../src/common/editor/cube-lut-reference-contract.ts';
import { BRUSH_MASK_RESOURCE_LIMITS_V1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import { admitLightscaperNativePhotoResourceReferenceCurrentV1 as admit, captureLightscaperNativePhotoResourceBodyCurrentV1 as capture,
	assertAuthenticatedLightscaperNativePhotoResourceBodyCurrentV1 as assertAuthenticated, wipeLightscaperNativePhotoResourceBodyCurrentV1 as wipe,
	type LightscaperNativePhotoResourceFamilyCurrentV1 as Family, type LightscaperNativePhotoResourceReferenceCurrentV1 as Reference,
	type LightscaperNativePhotoResourceBodyCurrentV1 as Body } from './lightscaper-native-photo-resource-body-current-v1.ts';

const FILL = Uint8Array.prototype.fill, CHECK = AbortSignal.prototype.throwIfAborted;

/** One atomic point statement returns only bounded payloads. Its cursor has
 * retired before any shared parser or scoped consumer can yield. */
export function readLightscaperNativePhotoResourceBodyCurrentV1<F extends Family>(database: DatabaseSync, family: F,
	reference: Readonly<Reference<F>>): Body<F> {
	if (database.isTransaction) throw new Error('Native resource reads require their own point snapshot.');
	const expected = admit(family, reference), packet = readRow(database, family, expected);
	if (!packet) throw new ReferenceError('Native resource body is missing or outside its fixed bound.');
	return packet;
}

/** Full parser proof precedes SQL; exact existing bytes inherit that proof
 * through equality. Publication owns a native COMMIT acknowledgement, with no
 * later cancellation check and no parser or consumer inside this transaction. */
export function installLightscaperNativePhotoResourceBodyCurrentV1<F extends Family>(database: DatabaseSync, body: Body<F>,
	signal?: AbortSignal): Readonly<{ reference: Readonly<Reference<F>>; created: boolean }> {
	check(signal); assertAuthenticated(body);
	if (database.isTransaction) throw new Error('Native resource installation requires its own write transaction.');
	database.exec('BEGIN IMMEDIATE');
	try {
		check(signal); const existing = readRow(database, body.family, body.reference); let created = false;
		if (existing) {
			try {
				if (existing.bytes.byteLength !== body.reference.byteLength) throw new TypeError('Stored immutable resource body length differs.');
				for (let index = 0; index < body.reference.byteLength; index++) if (existing.bytes[index] !== body.bytes[index]) {
					throw new TypeError('Stored immutable resource body differs from its authenticated incoming bytes.');
				}
			} finally { wipe(existing); }
		} else {
			database.prepare('INSERT INTO native_photo_resources(storage_key,family,reference,body) VALUES(?,?,?,?)')
				.run(body.reference.storageKey, body.family, JSON.stringify(body.reference), body.bytes); created = true;
		}
		check(signal); database.exec('COMMIT'); return Object.freeze({ reference: body.reference, created });
	} catch (error) {
		try { if (database.isTransaction) database.exec('ROLLBACK'); }
		catch (cleanup) { throw new AggregateError([error, cleanup], 'Native resource installation and rollback failed.', { cause: cleanup }); }
		throw error;
	}
}

function readRow<F extends Family>(database: DatabaseSync, family: F, reference: Readonly<Reference<F>>): Body<F> | null {
	const maximum = family === 'lut' ? VIDEO_COLOR_LIMITS_V1.maximumCubeLutBytes : BRUSH_MASK_RESOURCE_LIMITS_V1.maximumBodyBytes;
	const row = database.prepare(`SELECT storage_key,family,reference,body FROM native_photo_resources WHERE storage_key=?
		AND length(CAST(reference AS BLOB)) BETWEEN 1 AND 2048 AND length(body) BETWEEN 1 AND ?`).get(reference.storageKey, maximum);
	if (!row) return null;
	try {
		if (row.storage_key !== reference.storageKey || row.family !== family || typeof row.reference !== 'string') throw new TypeError('Stored native resource identity differs.');
		const stored = admit(family, JSON.parse(row.reference) as unknown), canonical = JSON.stringify(stored);
		if (canonical !== row.reference || canonical !== JSON.stringify(reference)) throw new TypeError('Stored native resource reference differs from its canonical identity.');
		return capture(family, stored, row.body);
	} finally {
		// SQLite has returned its own bounded BLOB allocation. Only our detached
		// packet remains available to parser/consumer code after this statement.
		if (row.body instanceof Uint8Array) Reflect.apply(FILL, row.body, [0]);
	}
}
function check(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(CHECK, signal, []); }
