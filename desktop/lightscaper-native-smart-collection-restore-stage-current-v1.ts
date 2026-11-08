/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash, type Hash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { claimLightscaperNativeSmartCollectionRestoreCandidateCurrentV1 } from './lightscaper-native-smart-collection-restore-candidate-current-v1.ts';
import { readLightscaperNativeCatalogRowCurrentV1 } from './lightscaper-native-catalog-records-current-v1.ts';
import { auditLightscaperNativeSmartCollectionArchiveCurrentV1, lightscaperNativeSmartCollectionContextDigestCurrentV1 } from './lightscaper-native-smart-collection-audit-current-v1.ts';
import { isLightscaperNativeSmartCollectionCleanupFailureCurrentV1, withLightscaperNativeSmartCollectionTransactionCurrentV1 } from './lightscaper-native-smart-collection-transaction-current-v1.ts';
import { assertPhotoSmartCollectionArchiveQueryV1, photoSmartCollectionSummaryRecordV1,
	type PhotoSmartCollectionArchiveContextV1 } from '../src/lightscaper/catalog/photo-smart-collection-contract-v1.ts';
import { photoSmartCollectionRecordV1, type PhotoSmartCollectionRecordV1 } from '../src/lightscaper/catalog/photo-smart-collection-record-v1.ts';
import { normalizePhotoSmartCollectionsStateV1 } from '../src/lightscaper/catalog/photo-smart-collection-state-v1.ts';
import { readPhotoSmartCollectionSignalOptionsV1 } from '../src/lightscaper/catalog/photo-smart-collection-repository-types-v1.ts';
import { PHOTO_SMART_COLLECTION_LIMITS_V1, serializePhotoSmartCollectionV1 } from '../src/lightscaper/catalog/photo-smart-collection-v1.ts';
import { validatePhotoSmartCollectionReferencesV1 } from '../src/lightscaper/catalog/photo-smart-collection-references-v1.ts';
import { array, field, id, integer, record } from '../src/lightscaper/catalog/value-validation.ts';

export interface LightscaperNativeSmartCollectionRestoreReadyCurrentV1 {
	readonly schemaVersion: 1;
	readonly kind: 'native-saved-collection-restore-ready';
	readonly context: PhotoSmartCollectionArchiveContextV1;
	readonly definitionCount: number;
	readonly inventorySha256: string;
}
export interface LightscaperNativeSmartCollectionRestoreStageCurrentV1 {
	append(pack: unknown): void;
	finish(): Promise<LightscaperNativeSmartCollectionRestoreReadyCurrentV1>;
	retire(): Promise<void>;
}
const nativeThrowIfAborted = AbortSignal.prototype.throwIfAborted;
const nativeAny = AbortSignal.any;
const nativeAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const nativeReason = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
const nativeAdd = EventTarget.prototype.addEventListener, nativeRemove = EventTarget.prototype.removeEventListener;

/** MAIN-PRIVATE fresh staging DB only. The candidate creator admitted its root;
 * the candidate lends the connection through joined retirement. This grants no current-library CAS
 * proof, selected pointer, media readiness, or complete restore publication. */
export function createLightscaperNativeSmartCollectionRestoreStageCurrentV1(permit: unknown, contextValue: unknown,
	options: unknown = {}): LightscaperNativeSmartCollectionRestoreStageCurrentV1 {
	const lease = claimLightscaperNativeSmartCollectionRestoreCandidateCurrentV1(permit);
	try {
		const context = readContext(contextValue), callerSignal = readPhotoSmartCollectionSignalOptionsV1(options).signal;
		const signal = callerSignal === undefined ? lease.signal : nativeAny([lease.signal, callerSignal]);
		const stage = new RestoreStage(lease.database, context, signal); lease.registerRetire(() => stage.retire());
		return Object.freeze({ append: (pack: unknown) => stage.append(pack), finish: () => stage.finish(), retire: () => stage.retire() });
	} catch (error) {
		lease.registerRetire(isLightscaperNativeSmartCollectionCleanupFailureCurrentV1(error) ? () => Promise.reject(error) : () => Promise.resolve()); throw error;
	}
}

class RestoreStage {
	readonly #database: DatabaseSync;
	readonly #context: PhotoSmartCollectionArchiveContextV1;
	readonly #controller = new AbortController();
	readonly #signal: AbortSignal;
	readonly #detach: () => void;
	readonly #retirementReason = new Error('Private saved restore stage retired.');
	readonly #cleanupFailures: unknown[] = [];
	readonly #contextDigest: string;
	#hash = createHash('sha256');
	#count = 0;
	#after: string | null = null;
	#appending = false;
	#closed = false;
	#active: Promise<LightscaperNativeSmartCollectionRestoreReadyCurrentV1> | null = null;
	#retirement: Promise<void> | null = null;
	constructor(database: DatabaseSync, context: PhotoSmartCollectionArchiveContextV1, signal?: AbortSignal) {
		this.#database = database; this.#context = context; this.#signal = this.#controller.signal;
		const forward = () => this.#controller.abort(Reflect.apply(nativeReason, signal, []));
		this.#detach = signal === undefined ? () => undefined : () => { Reflect.apply(nativeRemove, signal, ['abort', forward]); };
		if (signal !== undefined) { Reflect.apply(nativeAdd, signal, ['abort', forward, { once: true }]); if (Reflect.apply(nativeAborted, signal, []) === true) forward(); }
		try { this.#contextDigest = this.#transaction(() => {
			const catalogs = database.prepare('SELECT id FROM native_photo_catalogs LIMIT 2').all();
			if (catalogs.length !== 1 || catalogs[0]?.id !== context.catalogId) throw new TypeError('Private saved stage requires exactly its restored catalog root.');
			for (const table of ['native_photo_smart_collections', 'native_photo_smart_collection_summaries', 'native_photo_smart_collection_states']) {
				if (database.prepare(`SELECT 1 AS present FROM ${table} LIMIT 1`).get() !== undefined) throw new TypeError('Private saved stage must not contain existing saved inventory.');
			}
			const captured = this.#captureRoot();
			if (captured.root.collections.length + (context.state?.collectionCount ?? 0) > PHOTO_SMART_COLLECTION_LIMITS_V1.maximumCollections) throw new RangeError('Restored collection count exceeds its limit.');
			if (context.state !== null) database.prepare('INSERT INTO native_photo_smart_collection_states(catalog_id,revision,collection_count) VALUES(?,?,?)')
				.run(context.catalogId, context.state.revision, context.state.collectionCount);
			return this.#digest(captured);
		}); } catch (error) { this.#detach(); throw error; }
	}
	append(value: unknown): void {
		if (this.#closed || this.#active || this.#appending) throw new TypeError('Private saved stage is closed or has pending work.');
		this.#appending = true;
		try {
			const input = array(value, 'private saved restore pack', 0, 64), records: PhotoSmartCollectionRecordV1[] = []; let bytes = 2 * 1024 * 1024;
			for (const raw of input) {
				this.#check(); const admitted = photoSmartCollectionRecordV1(raw); assertPhotoSmartCollectionArchiveQueryV1(admitted.document, { ...admitted, document: raw });
				bytes += Buffer.byteLength(JSON.stringify(admitted), 'utf8') + Buffer.byteLength(JSON.stringify(photoSmartCollectionSummaryRecordV1(admitted.document)), 'utf8');
				if (bytes > 8 * 1024 * 1024) throw new RangeError('Private saved restore pack exceeds its charged byte budget.'); records.push(admitted);
			}
			const count = this.#count + records.length; if (count > (this.#context.state?.collectionCount ?? 0)) throw new TypeError('Private saved restore count exceeds its declared state.');
			const hash = this.#hash.copy(); let after = this.#after;
			this.#transaction(() => {
				const captured = this.#captureRoot(); if (this.#digest(captured) !== this.#contextDigest) throw new TypeError('Private saved restore root changed.');
				const insert = this.#database.prepare('INSERT INTO native_photo_smart_collections(collection_key,catalog_id,collection_id,revision,document,reference_keys) VALUES(?,?,?,?,?,?)');
				const summary = this.#database.prepare('INSERT INTO native_photo_smart_collection_summaries(collection_key,catalog_id,collection_id,revision,name) VALUES(?,?,?,?,?)');
				for (const admitted of records) {
					this.#check(); const definition = admitted.document;
					if (definition.catalogId !== this.#context.catalogId || after !== null && admitted.key <= after) throw new TypeError('Private saved restore records are foreign, duplicated or not canonically ordered.');
					validatePhotoSmartCollectionReferencesV1(definition, captured.root);
					insert.run(admitted.key, admitted.catalogId, definition.id, definition.revision, serializePhotoSmartCollectionV1(definition), JSON.stringify(admitted.referenceKeys));
					summary.run(admitted.key, admitted.catalogId, definition.id, definition.revision, JSON.stringify(definition.name)); hashDefinition(hash, admitted); after = admitted.key;
				}
			});
			this.#hash = hash; this.#count = count; this.#after = after;
		} finally { this.#appending = false; }
	}
	finish(): Promise<LightscaperNativeSmartCollectionRestoreReadyCurrentV1> {
		if (this.#closed || this.#active || this.#appending) return Promise.reject(new TypeError('Private saved restore stage is closed or has pending work.'));
		this.#closed = true;
		this.#active = Promise.resolve().then(async () => {
			this.#check(); if (this.#count !== (this.#context.state?.collectionCount ?? 0)) throw new TypeError('Private saved restore delivery count is incomplete.');
			const audit = await this.#audit(); this.#check();
			const digest = this.#hash.copy().digest('hex');
			if (audit.contextDigest !== this.#contextDigest || audit.inventoryDigest !== digest) throw new TypeError('Private saved restore inventory digest changed.');
			return Object.freeze({ schemaVersion: 1, kind: 'native-saved-collection-restore-ready', context: this.#context, definitionCount: this.#count, inventorySha256: digest });
		}); return this.#active;
	}
	retire(): Promise<void> {
		if (this.#retirement) return this.#retirement; this.#closed = true;
		this.#retirement = Promise.resolve().then(async () => {
			await Promise.allSettled([this.#active]);
			if (this.#cleanupFailures.length) throw new AggregateError(this.#cleanupFailures, 'Private saved restore retirement retains cleanup failures.');
		});
		this.#controller.abort(this.#retirementReason); this.#detach(); return this.#retirement;
	}
	async #audit() {
		try { return await auditLightscaperNativeSmartCollectionArchiveCurrentV1(this.#database, this.#context.catalogId, { signal: this.#signal }); }
		catch (error) { if (isLightscaperNativeSmartCollectionCleanupFailureCurrentV1(error)) this.#cleanupFailures.push(error); throw error; }
	}
	#captureRoot() {
		const raw = this.#database.prepare('SELECT id,document,root_revision,photo_count,index_revision FROM native_photo_catalogs WHERE id=?').get(this.#context.catalogId);
		if (raw === undefined) throw new ReferenceError('Restored catalog root is missing.');
		const captured = readLightscaperNativeCatalogRowCurrentV1(raw, this.#context.catalogId);
		if (captured.root.revision !== this.#context.catalogRevision || captured.index.indexRevision !== this.#context.indexRevision) throw new TypeError('Restored catalog epoch disagrees with its saved archive context.');
		return captured;
	}
	#digest(captured: ReturnType<typeof readLightscaperNativeCatalogRowCurrentV1>): string {
		const state = this.#context.state ?? normalizePhotoSmartCollectionsStateV1({ schemaVersion: 1, kind: 'photo-smart-collections-state', catalogId: this.#context.catalogId, revision: 0, collectionCount: 0 });
		return lightscaperNativeSmartCollectionContextDigestCurrentV1({ root: captured.root, index: captured.index, state, persistedState: this.#context.state,
			definition: null, record: null, summary: null });
	}
	#check(): void { if (this.#signal !== undefined) Reflect.apply(nativeThrowIfAborted, this.#signal, []); }
	#transaction<Result>(run: () => Result): Result {
		try { return withLightscaperNativeSmartCollectionTransactionCurrentV1(this.#database, 'write', this.#signal, run); }
		catch (error) { if (isLightscaperNativeSmartCollectionCleanupFailureCurrentV1(error)) this.#cleanupFailures.push(error); throw error; }
	}
}
function readContext(value: unknown): PhotoSmartCollectionArchiveContextV1 {
	const input = record(value, 'private saved restore context', ['schemaVersion', 'kind', 'catalogId', 'catalogRevision', 'indexRevision', 'state']);
	if (field(input, 'schemaVersion') !== 1 || field(input, 'kind') !== 'photo-smart-collection-archive-context') throw new TypeError('Private saved restore requires its exact archive context.');
	const catalogId = id(field(input, 'catalogId'), 'private restore catalog'), raw = field(input, 'state'), state = raw === null ? null : normalizePhotoSmartCollectionsStateV1(raw);
	if (state !== null && state.catalogId !== catalogId) throw new TypeError('Restored saved state belongs to another catalog.');
	return Object.freeze({ schemaVersion: 1, kind: 'photo-smart-collection-archive-context', catalogId,
		catalogRevision: integer(field(input, 'catalogRevision'), 0, Number.MAX_SAFE_INTEGER, 'restored catalog revision'),
		indexRevision: integer(field(input, 'indexRevision'), 0, Number.MAX_SAFE_INTEGER, 'restored index revision'), state });
}
function hashDefinition(hash: Hash, admitted: PhotoSmartCollectionRecordV1): void {
	const bytes = Buffer.from(serializePhotoSmartCollectionV1(admitted.document), 'utf8'), length = Buffer.alloc(4); length.writeUInt32LE(bytes.byteLength); hash.update(length); hash.update(bytes);
}
