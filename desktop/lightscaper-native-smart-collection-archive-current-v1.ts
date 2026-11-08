/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash, type Hash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { captureLightscaperNativeSmartCollectionContextCurrentV1, readLightscaperNativeSmartCollectionPairCurrentV1 } from './lightscaper-native-smart-collection-context-current-v1.ts';
import { auditLightscaperNativeSmartCollectionArchiveCurrentV1, lightscaperNativeSmartCollectionContextDigestCurrentV1 } from './lightscaper-native-smart-collection-audit-current-v1.ts';
import { isLightscaperNativeSmartCollectionCleanupFailureCurrentV1 } from './lightscaper-native-smart-collection-transaction-current-v1.ts';
import { admitPhotoSmartCollectionArchiveContextRequestV1, type PhotoSmartCollectionArchiveCaptureV1,
	type PhotoSmartCollectionArchiveContextV1 } from '../src/lightscaper/catalog/photo-smart-collection-contract-v1.ts';
import { photoSmartCollectionKeyV1 } from '../src/lightscaper/catalog/photo-smart-collection-record-v1.ts';
import { serializePhotoSmartCollectionV1, type PhotoSmartCollectionV1 } from '../src/lightscaper/catalog/photo-smart-collection-v1.ts';

export interface LightscaperNativeSmartCollectionArchiveOwnerCurrentV1 {
	readonly capture: Promise<PhotoSmartCollectionArchiveCaptureV1>;
	retire(): Promise<void>;
}
const nativeThrowIfAborted = AbortSignal.prototype.throwIfAborted;
const nativeAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const nativeReason = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
const nativeAdd = EventTarget.prototype.addEventListener, nativeRemove = EventTarget.prototype.removeEventListener;

/** The handle exists before initialization runs. The main-private owner pins
 * retire immediately and lends this connection until retire has joined every
 * initialization, demand read and final audit. No operation enters its queue. */
export function createLightscaperNativeSmartCollectionArchiveCurrentV1(database: DatabaseSync, catalogId: string,
	options: unknown = {}): LightscaperNativeSmartCollectionArchiveOwnerCurrentV1 {
	const admitted = admitPhotoSmartCollectionArchiveContextRequestV1(catalogId, options), source = new ArchiveSource(database, admitted.catalogId, admitted.signal);
	return Object.freeze({ capture: source.initialize(), retire: () => source.retire() });
}

class ArchiveSource implements AsyncIterable<PhotoSmartCollectionV1>, AsyncIterator<PhotoSmartCollectionV1> {
	readonly #database: DatabaseSync;
	readonly #catalogId: string;
	readonly #controller = new AbortController();
	readonly #retirementReason = new Error('Native saved archive retired.');
	readonly #hash = createHash('sha256');
	readonly #cleanupFailures: unknown[] = [];
	readonly #detach: () => void;
	#context: PhotoSmartCollectionArchiveContextV1 | null = null;
	#contextDigest = '';
	#inventoryDigest = '';
	#initialization: Promise<PhotoSmartCollectionArchiveCaptureV1> | null = null;
	#active: Promise<unknown> | null = null;
	#retirement: Promise<void> | null = null;
	#claimed = false;
	#closed = false;
	#retired = false;
	#verified = false;
	#count = 0;
	#afterKey: string | null = null;
	constructor(database: DatabaseSync, catalogId: string, signal?: AbortSignal) {
		this.#database = database; this.#catalogId = catalogId;
		const forward = () => this.#controller.abort(Reflect.apply(nativeReason, signal, []));
		this.#detach = signal === undefined ? () => undefined : () => { Reflect.apply(nativeRemove, signal, ['abort', forward]); };
		if (signal !== undefined) {
			Reflect.apply(nativeAdd, signal, ['abort', forward, { once: true }]);
			if (Reflect.apply(nativeAborted, signal, []) === true) forward();
		}
	}
	initialize(): Promise<PhotoSmartCollectionArchiveCaptureV1> {
		if (this.#initialization) return this.#initialization;
		this.#initialization = Promise.resolve().then(async () => {
			this.#check(); const result = await this.#audit(); this.#check();
			this.#context = Object.freeze({ schemaVersion: 1, kind: 'photo-smart-collection-archive-context', catalogId: this.#catalogId,
				catalogRevision: result.context.root.revision, indexRevision: result.context.index.indexRevision, state: result.context.persistedState });
			this.#contextDigest = result.contextDigest; this.#inventoryDigest = result.inventoryDigest;
			return Object.freeze({ context: this.#context, definitions: this, verify: () => this.verify() });
		});
		return this.#initialization;
	}
	[Symbol.asyncIterator](): AsyncIterator<PhotoSmartCollectionV1> {
		if (this.#claimed) throw new TypeError('Native saved archive source can only be consumed once.'); this.#claimed = true; return this;
	}
	next(): Promise<IteratorResult<PhotoSmartCollectionV1>> {
		if (this.#active) return Promise.reject(new TypeError('Native saved archive has pending work.'));
		if (this.#closed) return Promise.resolve({ done: true, value: undefined });
		return this.#own(() => {
			this.#check(); const document = this.#nextInSnapshot();
			if (document === null) { this.#assertDelivered(); this.#closed = true; return { done: true, value: undefined }; }
			if (++this.#count > (this.#context?.state?.collectionCount ?? 0)) throw new TypeError('Native archive delivered count exceeds its snapshot.');
			hashDefinition(this.#hash, document); this.#afterKey = photoSmartCollectionKeyV1(document.catalogId, document.id);
			return { done: false, value: document };
		});
	}
	async return(): Promise<IteratorResult<PhotoSmartCollectionV1>> { this.#closed = true; await this.#active; return { done: true, value: undefined }; }
	verify(): Promise<void> {
		if (this.#active) return Promise.reject(new TypeError('Native saved archive has pending work.'));
		if (this.#retired || this.#verified) return Promise.reject(new TypeError('Native saved archive verification was already consumed or retired.'));
		return this.#own(async () => {
			this.#check(); this.#assertDelivered();
			const result = await this.#audit(); this.#check();
			if (result.contextDigest !== this.#contextDigest || result.inventoryDigest !== this.#inventoryDigest) throw new TypeError('Native saved archive snapshot changed after delivery.');
			this.#verified = true; this.#closed = true;
		});
	}
	retire(): Promise<void> {
		if (this.#retirement) return this.#retirement;
		// Fence before abort: signal listeners may synchronously reenter the owner.
		this.#retired = true; this.#closed = true;
		this.#retirement = Promise.resolve().then(async () => {
			// Callers observe operation failures on their original promises. All
			// operations settle before the connection lifetime is returned.
			await Promise.allSettled([this.#initialization, this.#active]);
			if (this.#cleanupFailures.length) throw new AggregateError(this.#cleanupFailures, 'Native saved archive retirement retains cleanup failures.');
		});
		this.#controller.abort(this.#retirementReason); this.#detach(); return this.#retirement;
	}
	async #audit() {
		try { return await auditLightscaperNativeSmartCollectionArchiveCurrentV1(this.#database, this.#catalogId, { signal: this.#controller.signal }); }
		catch (error) { if (isLightscaperNativeSmartCollectionCleanupFailureCurrentV1(error)) this.#cleanupFailures.push(error); throw error; }
	}
	#nextInSnapshot(): Readonly<PhotoSmartCollectionV1> | null {
		const db = this.#database; if (db.isTransaction) throw new Error('Native saved archive requires its own snapshot.'); db.exec('BEGIN');
		try {
			const context = captureLightscaperNativeSmartCollectionContextCurrentV1(db, this.#catalogId, null);
			if (lightscaperNativeSmartCollectionContextDigestCurrentV1(context) !== this.#contextDigest) throw new TypeError('Native saved archive context changed.');
			const prefix = JSON.stringify([this.#catalogId]).slice(0, -1) + ',';
			const raw = db.prepare('SELECT collection_key FROM native_photo_smart_collections WHERE collection_key>? AND collection_key<? ORDER BY collection_key LIMIT 1')
				.get(this.#afterKey ?? prefix, prefix + '\uffff');
			let document: Readonly<PhotoSmartCollectionV1> | null = null;
			if (raw !== undefined) {
				if (typeof raw.collection_key !== 'string' || raw.collection_key <= (this.#afterKey ?? prefix)) throw new TypeError('Native saved archive keys are not ordered.');
				const pair = readLightscaperNativeSmartCollectionPairCurrentV1(db, this.#catalogId, raw.collection_key, context.root);
				if (pair === null) throw new TypeError('Native saved archive recipe disappeared.'); document = pair.definition;
			}
			this.#check(); db.exec('COMMIT'); return document;
		} catch (error) {
			try { if (db.isTransaction) db.exec('ROLLBACK'); }
			catch (cleanup) { this.#cleanupFailures.push(cleanup); throw new AggregateError([error, cleanup], 'Native saved archive read and rollback failed.', { cause: cleanup }); }
			throw error;
		}
	}
	#assertDelivered(): void {
		if (this.#context === null || this.#count !== (this.#context.state?.collectionCount ?? 0)) throw new TypeError('Native saved archive delivery count is incomplete.');
		if (this.#hash.copy().digest('hex') !== this.#inventoryDigest) throw new TypeError('Native saved archive snapshot digest changed during delivery.');
	}
	#check(): void { Reflect.apply(nativeThrowIfAborted, this.#controller.signal, []); }
	#own<Result>(run: () => Result | Promise<Result>): Promise<Result> {
		const operation = Promise.resolve().then(run).finally(() => { this.#active = null; }); this.#active = operation; return operation;
	}
}
function hashDefinition(hash: Hash, document: PhotoSmartCollectionV1): void {
	const bytes = Buffer.from(serializePhotoSmartCollectionV1(document), 'utf8'), length = Buffer.alloc(4); length.writeUInt32LE(bytes.byteLength); hash.update(length); hash.update(bytes);
}
