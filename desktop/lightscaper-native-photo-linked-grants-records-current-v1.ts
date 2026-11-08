/* SPDX-License-Identifier: AGPL-3.0-only */
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../src/common/foundation/closed-domain-value.ts';
import { captureNativePath, captureIdentity } from './lightscaper-native-photo-granted-filesystem-codec-current-v1.ts';
import type { NativePath, NativeFileIdentity } from './lightscaper-native-photo-granted-filesystem-current-v1.ts';
import { createLinkedGrantCleanupFailureCurrentV1 as cleanup } from './lightscaper-native-photo-linked-grants-failures-current-v1.ts';
export interface LightscaperNativePhotoLinkedGrantCurrentV1 { readonly grantId: string; readonly displayName: string; readonly revision: number; readonly revoked: boolean }
export type LinkedGrantSelectionCurrentV1 = Readonly<{ path: NativePath; displayName: string }>;
export type LinkedGrantRowCurrentV1 = Readonly<{ grant: Readonly<LightscaperNativePhotoLinkedGrantCurrentV1>; path: NativePath; identity: NativeFileIdentity }>;
type SqlRow = Record<string, SQLOutputValue>;
const TABLE = 'native_photo_linked_root_grants';
const typed = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TAG = Object.getOwnPropertyDescriptor(typed, Symbol.toStringTag)!.get!;
const ID = "CASE WHEN typeof(grant_id)='text' AND length(CAST(grant_id AS BLOB))=64 THEN grant_id END AS grant_id";
const SUMMARY = `${ID},CASE WHEN typeof(display_name)='text' AND length(CAST(display_name AS BLOB))<=24578 THEN display_name END AS display_name,revision,revoked`;
const BODY = `CASE WHEN path_encoding IN ('posix-bytes','windows-utf16le') THEN path_encoding END AS path_encoding,
	CASE WHEN typeof(native_path)='blob' AND length(native_path) BETWEEN 1 AND 262144 THEN native_path END AS native_path,
	CASE WHEN typeof(volume_identity)='text' AND length(CAST(volume_identity AS BLOB)) BETWEEN 1 AND 256 THEN volume_identity END AS volume_identity,
	CASE WHEN typeof(object_identity)='text' AND length(CAST(object_identity AS BLOB)) BETWEEN 1 AND 256 THEN object_identity END AS object_identity`;
export function linkedGrantIdCurrentV1(value: unknown): string {
	if (typeof value !== 'string' || value.length !== 64 || !/^[0-9a-f]{64}$/u.test(value)) throw new TypeError('Native grant ID is invalid.'); return value;
}
function name(value: unknown): string {
	if (typeof value !== 'string' || value.length > 4096) throw new TypeError('Native grant display name is invalid.'); return value;
}
export function captureLinkedGrantSelectionCurrentV1(value: unknown): LinkedGrantSelectionCurrentV1 {
	const selected = record(value, 'native chooser result', ['path', 'displayName']);
	const pathValue = field(selected, 'path', 'native chooser result'), path = record(pathValue, 'native chooser path', ['encoding', 'bytes']);
	const bytes = field(path, 'bytes', 'native chooser path'); if (Reflect.apply(TAG, bytes, []) !== 'Uint8Array') throw new TypeError('Native chooser requires actual byte units.');
	return Object.freeze({ path: captureNativePath({ encoding: field(path, 'encoding', 'native chooser path'), bytes }, true), displayName: name(field(selected, 'displayName', 'native chooser result')) });
}
export function readLinkedGrantSummaryCurrentV1(db: DatabaseSync, grantId: string): Readonly<LightscaperNativePhotoLinkedGrantCurrentV1> | null {
	idle(db); const row = db.prepare(`SELECT ${SUMMARY} FROM ${TABLE} WHERE grant_id=?`).get(grantId); return row ? summary(row) : null;
}
export function readLinkedGrantCurrentV1(db: DatabaseSync, grantId: string): LinkedGrantRowCurrentV1 | null {
	idle(db); const row = db.prepare(`SELECT ${SUMMARY},${BODY} FROM ${TABLE} WHERE grant_id=?`).get(grantId);
	if (!row) return null; const grant = summary(row);
	return Object.freeze({ grant, path: captureNativePath({ encoding: row.path_encoding, bytes: row.native_path }, true), identity: captureIdentity({ volume: row.volume_identity, object: row.object_identity }) });
}
export function readLinkedGrantPageCurrentV1(db: DatabaseSync, after: string | null) {
	idle(db); const rows = after === null ? db.prepare(`SELECT ${SUMMARY} FROM ${TABLE} ORDER BY grant_id LIMIT 64`).all()
		: db.prepare(`SELECT ${SUMMARY} FROM ${TABLE} WHERE grant_id>? ORDER BY grant_id LIMIT 64`).all(after);
	const grants = Object.freeze(rows.map(summary));
	return Object.freeze({ grants, afterGrantId: grants.length === 64 ? grants[63]!.grantId : null });
}
export function insertLinkedGrantCurrentV1(db: DatabaseSync, grantId: string, selected: LinkedGrantSelectionCurrentV1, identity: NativeFileIdentity,
	check: () => void, acknowledge: () => void): Readonly<LightscaperNativePhotoLinkedGrantCurrentV1> {
	return transaction(db, () => {
		db.prepare(`INSERT INTO ${TABLE}(grant_id,display_name,path_encoding,native_path,volume_identity,object_identity,revision,revoked) VALUES(?,?,?,?,?,?,0,0)`)
			.run(grantId, JSON.stringify(selected.displayName), selected.path.encoding, selected.path.bytes, identity.volume, identity.object);
		const row = db.prepare(`SELECT ${SUMMARY},${BODY} FROM ${TABLE} WHERE grant_id=?`).get(grantId);
		if (!row) throw new Error('Native grant insert disappeared.');
		const saved = summary(row), storedIdentity = captureIdentity({ volume: row.volume_identity, object: row.object_identity });
		const storedPath = captureNativePath({ encoding: row.path_encoding, bytes: row.native_path }, true);
		if (saved.grantId !== grantId || saved.displayName !== selected.displayName || saved.revision !== 0 || saved.revoked
			|| storedIdentity.volume !== identity.volume || storedIdentity.object !== identity.object || storedPath.encoding !== selected.path.encoding
			|| storedPath.bytes.byteLength !== selected.path.bytes.byteLength || !storedPath.bytes.every((byte, index) => byte === selected.path.bytes[index])) throw new Error('Native grant insert was rewritten.');
		return saved;
	}, check, acknowledge);
}
export function revokeLinkedGrantCurrentV1(db: DatabaseSync, grantId: string, check: () => void, acknowledge: () => void): boolean {
	return transaction(db, () => {
		const row = db.prepare(`SELECT ${SUMMARY} FROM ${TABLE} WHERE grant_id=?`).get(grantId); if (!row) return false;
		const before = summary(row); if (before.revoked) return false;
		if (before.revision === Number.MAX_SAFE_INTEGER) throw new RangeError('Native grant revision is exhausted.');
		db.prepare(`UPDATE ${TABLE} SET revoked=1,revision=revision+1 WHERE grant_id=? AND revision=? AND revoked=0`).run(grantId, before.revision);
		const after = db.prepare(`SELECT ${SUMMARY} FROM ${TABLE} WHERE grant_id=?`).get(grantId);
		if (!after) throw new Error('Native revoked grant disappeared.'); const saved = summary(after);
		if (!saved.revoked || saved.revision !== before.revision + 1 || saved.displayName !== before.displayName || saved.grantId !== before.grantId) throw new Error('Native grant revocation was not exact.');
		return true;
	}, check, acknowledge);
}
function transaction<Result>(db: DatabaseSync, run: () => Result, check: () => void, acknowledge: () => void): Result {
	idle(db); check(); db.exec('BEGIN IMMEDIATE');
	try { check(); const result = run(); check(); db.exec('COMMIT'); if (result !== false) acknowledge(); return result; }
	catch (primary) { try { if (db.isTransaction) db.exec('ROLLBACK'); } catch (failure) { throw cleanup([primary, failure], 'Native grant rollback failed.'); } throw primary; }
}
function summary(row: SqlRow): Readonly<LightscaperNativePhotoLinkedGrantCurrentV1> {
	const grantId = linkedGrantIdCurrentV1(row.grant_id), encoded = row.display_name;
	if (typeof encoded !== 'string' || Buffer.byteLength(encoded) > 24578) throw new TypeError('Native grant name encoding exceeds its bound.');
	const decoded: unknown = JSON.parse(encoded); const displayName = name(decoded);
	if (JSON.stringify(displayName) !== encoded || typeof row.revision !== 'number' || !Number.isSafeInteger(row.revision) || row.revision < 0 || (row.revoked !== 0 && row.revoked !== 1)) throw new TypeError('Native grant projection is not canonical.');
	return Object.freeze({ grantId, displayName, revision: row.revision, revoked: row.revoked === 1 });
}
function idle(db: DatabaseSync): void { if (db.isTransaction) throw new Error('Native grant read or mutation refuses an active transaction.'); }
