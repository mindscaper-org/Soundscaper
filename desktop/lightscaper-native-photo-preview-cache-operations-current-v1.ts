/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { binaryDerivativeManifestV1, type BinaryDerivativeCacheIdentityV1 as Identity, type BinaryDerivativeCacheProfileV1 as Profile } from '../src/common/editor/storage/binary-derivative-cache-records.ts';
import type { BinaryDerivativeCacheLoadedV1, BinaryDerivativeCacheStoreResultV1, BinaryDerivativeCacheTrimResultV1 } from '../src/common/editor/storage/binary-derivative-cache-repository.ts';
import { planDerivativeCacheEviction } from '../src/common/editor/storage/derivative-cache-policy.ts';
import { checkLightscaperNativePhotoMediaSignalCurrentV1 as check } from './lightscaper-native-photo-media-lifetime-current-v1.ts';
import { LIGHTSCAPER_NATIVE_PHOTO_PREVIEW_CHUNK_CURRENT_V1 as CHUNK, LIGHTSCAPER_NATIVE_PHOTO_PREVIEW_MAXIMUM_BYTES_CURRENT_V1 as MAXIMUM } from './lightscaper-native-photo-preview-cache-database-current-v1.ts';
import { readLightscaperNativePhotoPreviewEntryCurrentV1 as entry, readLightscaperNativePhotoPreviewChunkCurrentV1 as chunk,
	lightscaperNativePhotoPreviewSourceCurrentV1 as source, lightscaperNativePhotoPreviewTransactionCurrentV1 as transaction,
	discardLightscaperNativePhotoPreviewStagingCurrentV1 as discard, lightscaperNativePhotoPreviewCleanupErrorCurrentV1 as cleanupError } from './lightscaper-native-photo-preview-cache-records-current-v1.ts';
const NativeBlob = Blob, SLICE = Blob.prototype.slice, BYTES = Blob.prototype.arrayBuffer;
type Databases = Readonly<{ cache: DatabaseSync; source: DatabaseSync }>;
export interface LightscaperNativePreviewStoreCurrentV1 { readonly identity: Identity; readonly body: Blob; readonly output: string; readonly mime: string }

export async function loadLightscaperNativePhotoPreviewCurrentV1(db: Databases, identity: Identity, profile: Profile, signal: AbortSignal): Promise<BinaryDerivativeCacheLoadedV1 | null> {
	discard(db.cache); check(signal);
	const current = source(db.source, identity), stored = entry(db.cache, identity.key, profile), version = dataVersion(db.cache);
	if (!current || !stored || current !== stored.token || stored.manifest !== binaryDerivativeManifestV1(identity)) return null;
	let body = new NativeBlob([], { type: stored.mime }); const hash = createHash('sha256');
	try {
		for (let offset = 0, position = 0; offset < stored.size; offset += CHUNK, position++) {
			check(signal); const bytes = chunk(db.cache, stored.bodyToken, position, Math.min(CHUNK, stored.size - offset));
			try { hash.update(bytes); const part = Uint8Array.from(bytes); try { body = new NativeBlob([body, part], { type: stored.mime }); } finally { part.fill(0); } }
			finally { bytes.fill(0); }
			await nextTurn(); check(signal); if (dataVersion(db.cache) !== version) return null;
		}
		if (db.cache.prepare('SELECT 1 FROM native_photo_preview_chunks WHERE body_token=? AND position<0 LIMIT 1').get(stored.bodyToken)
			|| db.cache.prepare('SELECT 1 FROM native_photo_preview_chunks WHERE body_token=? AND position>=? LIMIT 1').get(stored.bodyToken, Math.ceil(stored.size / CHUNK))) throw new Error('Native preview has undeclared payload chunks.');
		if (body.size !== stored.size || hash.digest('hex') !== stored.outputSha256) throw new Error('Native preview body failed length/SHA integrity.');
	} catch (error) { check(signal); if (dataVersion(db.cache) !== version) return null; throw error; }
	check(signal); if (dataVersion(db.cache) !== version || source(db.source, identity) !== current) return null;
	const final = entry(db.cache, identity.key, profile); if (!final || final.bodyToken !== stored.bodyToken || final.outputSha256 !== stored.outputSha256) return null;
	return Object.freeze({ identity, body, outputSha256: stored.outputSha256 });
}

export async function storeLightscaperNativePhotoPreviewCurrentV1(db: Databases, input: LightscaperNativePreviewStoreCurrentV1, profile: Profile, signal: AbortSignal): Promise<BinaryDerivativeCacheStoreResultV1> {
	const { identity, body, output } = input;
	if (identity.byteLength > profile.maximumBytes || profile.maximumEntries === 0) return Object.freeze({ outcome: 'pressure' });
	discard(db.cache); check(signal); const original = source(db.source, identity);
	if (!original) throw new Error('Native preview source is absent or untrusted.');
	const token = randomBytes(16).toString('hex'); let staged = false, result: BinaryDerivativeCacheStoreResultV1;
	try {
		transaction(db.cache, signal, () => {
			db.cache.prepare('INSERT INTO native_photo_preview_bodies(token,byte_length,chunk_count) VALUES(?,?,?)').run(token, identity.byteLength, Math.ceil(identity.byteLength / CHUNK));
			db.cache.prepare('INSERT INTO native_photo_preview_staging(singleton,body_token) VALUES(1,?)').run(token);
			const stage = db.cache.prepare('SELECT CASE WHEN length(CAST(body_token AS BLOB))=32 THEN body_token END AS token FROM native_photo_preview_staging WHERE singleton=1').get();
			const bodyRow = db.cache.prepare('SELECT byte_length,chunk_count FROM native_photo_preview_bodies WHERE token=?').get(token);
			if (stage?.token !== token || bodyRow?.byte_length !== identity.byteLength || bodyRow.chunk_count !== Math.ceil(identity.byteLength / CHUNK)) throw new Error('Native preview stage was not published exactly.'); staged = true;
		});
		const version = dataVersion(db.cache), hash = createHash('sha256');
		for (let offset = 0, position = 0; offset < identity.byteLength; offset += CHUNK, position++) {
			check(signal); const length = Math.min(CHUNK, identity.byteLength - offset);
			const part = Reflect.apply(SLICE, body, [offset, offset + length]) as Blob;
			const buffer = await Reflect.apply(BYTES, part, []) as ArrayBuffer;
			const bytes = new Uint8Array(buffer);
			try {
				check(signal); if (dataVersion(db.cache) !== version) throw new Error('Native preview stage changed during Blob work.'); if (bytes.byteLength !== length) throw new Error('Native preview Blob read has the wrong size.'); hash.update(bytes);
				transaction(db.cache, signal, () => {
					db.cache.prepare('INSERT INTO native_photo_preview_chunks(body_token,position,body) VALUES(?,?,?)').run(token, position, bytes);
					const actual = chunk(db.cache, token, position, length);
					try { if (!equal(actual, bytes)) throw new Error('Native preview staged chunk changed before acknowledgment.'); } finally { actual.fill(0); }
				});
			} finally { bytes.fill(0); }
		}
		check(signal); if (hash.digest('hex') !== output) throw new Error('Native preview body differs from its prepared output SHA.');
		if (db.cache.prepare('SELECT 1 FROM native_photo_preview_chunks WHERE body_token=? AND position<0 LIMIT 1').get(token)
			|| db.cache.prepare('SELECT 1 FROM native_photo_preview_chunks WHERE body_token=? AND position>=? LIMIT 1').get(token, Math.ceil(identity.byteLength / CHUNK))) throw new Error('Native preview stage has undeclared chunks.');
		if (dataVersion(db.cache) !== version) throw new Error('Native preview stage changed before publication.');
		result = publish(db, input, profile, original, token, version, signal); if (result.outcome === 'stored') staged = false;
	} catch (primary) {
		if (staged) { try { discard(db.cache, token); } catch (cleanup) { throw cleanupError(primary, cleanup); } } throw primary;
	}
	if (staged) {
		try { discard(db.cache, token); }
		catch (cleanup) { return Object.freeze({ ...result, cleanupErrors: Object.freeze([...(result.cleanupErrors ?? []), cleanupError(new Error('Native preview pressure stage failed retirement.'), cleanup)]) }); }
	}
	return result;
}

/** Source exclusion spans only synchronous SQL and cache COMMIT. A true cache
 * ACK cannot be retracted by later source-guard COMMIT failure or cancellation. */
function publish(db: Databases, input: LightscaperNativePreviewStoreCurrentV1, profile: Profile, original: string, token: string, version: number, signal: AbortSignal): BinaryDerivativeCacheStoreResultV1 {
	if (db.source.isTransaction) throw new Error('Native preview source guard requires an idle connection.');
	check(signal); db.source.exec('BEGIN IMMEDIATE'); let result: BinaryDerivativeCacheStoreResultV1;
	try {
		check(signal); if (source(db.source, input.identity) !== original) throw new Error('Native preview source changed during body work.');
		result = transaction(db.cache, signal, () => {
			if (dataVersion(db.cache) !== version) throw new Error('Native preview stage changed at publication.');
			const rows = inventory(db.cache), previous = entry(db.cache, input.identity.key);
			const plan = planDerivativeCacheEviction(rows.filter(row => row.key !== input.identity.key), {
				maximumBytes: profile.maximumBytes - input.identity.byteLength, maximumEntries: profile.maximumEntries - 1 });
			if (plan.removals.length > profile.maximumEvictions) return Object.freeze({ outcome: 'pressure' as const });
			for (const removal of plan.removals) remove(db.cache, String(removal.key));
			if (previous) remove(db.cache, previous.identity.key);
			const manifest = binaryDerivativeManifestV1(input.identity), stamp = Date.now();
			db.cache.prepare('INSERT INTO native_photo_preview_entries(key,manifest,source_token,output_sha256,body_token,byte_length,mime_type,committed_at) VALUES(?,?,?,?,?,?,?,?)')
				.run(input.identity.key, manifest, original, input.output, token, input.identity.byteLength, input.mime, stamp);
			const stored = entry(db.cache, input.identity.key, profile);
			if (!stored || stored.manifest !== manifest || stored.token !== original || stored.bodyToken !== token || stored.outputSha256 !== input.output || stored.mime !== input.mime || stored.committedAt !== stamp) throw new Error('Native preview publication changed before acknowledgment.');
			const stage = db.cache.prepare('SELECT CASE WHEN length(CAST(body_token AS BLOB))=32 THEN body_token END AS token FROM native_photo_preview_staging WHERE singleton=1').get();
			if (stage?.token !== token) throw new Error('Native preview staging ownership changed.');
			db.cache.prepare('DELETE FROM native_photo_preview_staging WHERE singleton=1 AND body_token=?').run(token);
			if (db.cache.prepare('SELECT 1 FROM native_photo_preview_staging WHERE singleton=1').get()) throw new Error('Native preview staging completion was ignored.');
			return Object.freeze({ outcome: 'stored' as const });
		});
	} catch (primary) {
		try { if (db.source.isTransaction) db.source.exec('ROLLBACK'); } catch (cleanup) { throw cleanupError(primary, cleanup); } throw primary;
	}
	try { db.source.exec('COMMIT'); }
	catch (primary) {
		try { if (db.source.isTransaction) db.source.exec('ROLLBACK'); }
		catch (cleanup) { const error = cleanupError(primary, cleanup); return Object.freeze({ ...result, cleanupErrors: Object.freeze([error]) }); }
		return Object.freeze({ ...result, cleanupErrors: Object.freeze([primary]) });
	}
	return result;
}

export function trimLightscaperNativePhotoPreviewCurrentV1(db: DatabaseSync, profile: Profile, signal: AbortSignal): BinaryDerivativeCacheTrimResultV1 {
	discard(db); return transaction(db, signal, () => {
		const plan = planDerivativeCacheEviction(inventory(db), profile), selected = plan.removals.slice(0, profile.maximumEvictions);
		for (const item of selected) remove(db, String(item.key));
		return Object.freeze({ removedEntries: selected.length, removedBytes: selected.reduce((sum, row) => sum + Number(row.size), 0), more: selected.length < plan.removals.length });
	});
}
function inventory(db: DatabaseSync): readonly Readonly<{ key: string; size: number; committedAt: string }>[] {
	const rows = db.prepare(`SELECT CASE WHEN length(CAST(key AS BLOB))<=256 THEN key END AS key,byte_length,committed_at FROM native_photo_preview_entries ORDER BY committed_at,key LIMIT 1025`).all();
	if (rows.length > 1024) throw new RangeError('Native preview inventory exceeds its hard entry bound.'); let total = 0;
	return rows.map(row => {
		if (typeof row.key !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(row.key) || typeof row.byte_length !== 'number' || !Number.isSafeInteger(row.byte_length) || row.byte_length < 0 || row.byte_length > MAXIMUM
			|| typeof row.committed_at !== 'number' || !Number.isSafeInteger(row.committed_at) || row.committed_at < 0) throw new TypeError('Native preview inventory is malformed.');
		total += row.byte_length; if (total > MAXIMUM) throw new RangeError('Native preview inventory exceeds its hard byte bound.');
		return Object.freeze({ key: row.key, size: row.byte_length, committedAt: new Date(row.committed_at).toISOString() });
	});
}
function remove(db: DatabaseSync, key: string): void {
	const previous = entry(db, key); if (!previous) throw new Error('Native preview eviction lost its entry.');
	db.prepare('DELETE FROM native_photo_preview_entries WHERE key=? AND body_token=?').run(key, previous.bodyToken);
	if (db.prepare('SELECT 1 FROM native_photo_preview_entries WHERE key=?').get(key)) throw new Error('Native preview eviction was ignored.');
	db.prepare('DELETE FROM native_photo_preview_bodies WHERE token=?').run(previous.bodyToken);
	if (db.prepare('SELECT 1 FROM native_photo_preview_bodies WHERE token=?').get(previous.bodyToken)) throw new Error('Native preview body retirement was ignored.');
}
function dataVersion(db: DatabaseSync): number { const value = db.prepare('PRAGMA data_version').get()?.data_version; if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError('Native preview data version is invalid.'); return value; }
function equal(a: Uint8Array, b: Uint8Array): boolean { return a.byteLength === b.byteLength && a.every((value, i) => value === b[i]); }
