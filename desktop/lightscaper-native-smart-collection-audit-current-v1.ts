/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash, type Hash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { readValidatedPhotoCatalogRootV1 } from '../src/lightscaper/catalog/documents.ts';
import { PHOTO_SMART_COLLECTION_AUDIT_LIMITS_V1 as LIMITS } from '../src/lightscaper/catalog/photo-smart-collection-contract-v1.ts';
import { PHOTO_SMART_COLLECTION_RECORD_LIMITS_V1, photoSmartCollectionKeyV1 } from '../src/lightscaper/catalog/photo-smart-collection-record-v1.ts';
import { readPhotoSmartCollectionScopedKeyV1, readPhotoSmartCollectionSignalOptionsV1, smartCollectionRevisionV1 } from '../src/lightscaper/catalog/photo-smart-collection-repository-types-v1.ts';
import { PHOTO_SMART_COLLECTION_LIMITS_V1, serializePhotoSmartCollectionV1 } from '../src/lightscaper/catalog/photo-smart-collection-v1.ts';
import { PhotoCatalogRevisionConflictError } from '../src/lightscaper/catalog/repository-types.ts';
import { LIGHTSCAPER_CATALOG_LIMITS, type PhotoCatalogRootV1 } from '../src/lightscaper/catalog/types.ts';
import { field, id, record } from '../src/lightscaper/catalog/value-validation.ts';
import { captureLightscaperNativeSmartCollectionContextCurrentV1 as capture, readLightscaperNativeSmartCollectionPairCurrentV1 as pair,
	type LightscaperNativeSmartCollectionContextCurrentV1 } from './lightscaper-native-smart-collection-context-current-v1.ts';
import { LIGHTSCAPER_NATIVE_SMART_COLLECTION_SUMMARY_COLUMNS_CURRENT_V1 as SUMMARY_COLUMNS,
	readLightscaperNativeSmartCollectionSummaryRowCurrentV1 } from './lightscaper-native-smart-collection-records-current-v1.ts';
import { readAdmittedLightscaperNativeSmartCollectionWriteCurrentV1, type AdmittedLightscaperNativeSmartCollectionWriteCurrentV1 } from './lightscaper-native-smart-collection-admission-current-v1.ts';
import { assertLightscaperNativeSmartCollectionNotAbortedCurrentV1 as notAborted,
	withLightscaperNativeSmartCollectionTransactionCurrentV1 as transaction } from './lightscaper-native-smart-collection-transaction-current-v1.ts';

declare const guardBrand: unique symbol;
export interface LightscaperNativeSmartCollectionRootGuardCurrentV1 { readonly [guardBrand]: true }
interface Binding {
	readonly database: DatabaseSync;
	readonly contextDigest: string;
	readonly validationDigest: string;
	readonly packet: AdmittedLightscaperNativeSmartCollectionWriteCurrentV1 | null;
	readonly retainedBytes: number;
}
export interface LightscaperNativeSmartCollectionArchiveAuditCurrentV1 {
	readonly context: Readonly<LightscaperNativeSmartCollectionContextCurrentV1>;
	readonly contextDigest: string;
	readonly inventoryDigest: string;
}
const proofs = new WeakMap<object, Binding>();
const phases = ['definitions', 'summaries', 'definition-index', 'summary-index'] as const;
type Phase = typeof phases[number];
interface Progress { afterKey: string | null; count: number }
interface Scan {
	readonly database: DatabaseSync;
	readonly catalogId: string;
	readonly chosen: Readonly<PhotoCatalogRootV1> | null;
	readonly expected: number | null;
	readonly retainedBytes: number;
	readonly signal?: AbortSignal;
}
interface ScanResult {
	readonly context: Readonly<LightscaperNativeSmartCollectionContextCurrentV1> | null;
	readonly contextDigest: string;
	readonly inventoryDigest: string;
}

/** Fixed writer entrypoint; callers cannot choose an audit profile or byte reserve. */
export async function prepareLightscaperNativeSmartCollectionRootGuardCurrentV1(database: DatabaseSync, value: unknown,
	expectedValue: unknown, options: unknown = {}): Promise<LightscaperNativeSmartCollectionRootGuardCurrentV1> {
	const chosen = readValidatedPhotoCatalogRootV1(value), expected = smartCollectionRevisionV1(expectedValue);
	const { signal } = readPhotoSmartCollectionSignalOptionsV1(options);
	if (chosen.revision !== expected) throw new PhotoCatalogRevisionConflictError('catalog');
	const validationDigest = digest(chosen);
	const scanned = await scan({ database, catalogId: chosen.id, chosen, expected, retainedBytes: 0, signal });
	return grant({ database, contextDigest: scanned.contextDigest, validationDigest, packet: null, retainedBytes: 0 });
}

/** Fresh caller-owned write context is required. Only a successful validation consumes authority. */
export function assertLightscaperNativeSmartCollectionRootGuardCurrentV1(guard: unknown, database: DatabaseSync,
	context: LightscaperNativeSmartCollectionContextCurrentV1, value: unknown): void {
	const binding = readProof(guard, database), chosen = readValidatedPhotoCatalogRootV1(value);
	if (binding.packet !== null || binding.retainedBytes !== 0 || binding.validationDigest !== digest(chosen)) throw new TypeError('Saved audit guard belongs to another root candidate.');
	assertContext(binding, database, context); proofs.delete(guard as object);
}

/** Archive authentication grants no current-library mutation authority. Always reserve
 * the caller's ordinary snapshot root and one maximum held recipe, including final audit. */
export async function auditLightscaperNativeSmartCollectionArchiveCurrentV1(database: DatabaseSync, catalogValue: unknown,
	options: unknown = {}): Promise<Readonly<LightscaperNativeSmartCollectionArchiveAuditCurrentV1>> {
	const catalogId = id(catalogValue, 'saved archive catalog ID'), { signal } = readPhotoSmartCollectionSignalOptionsV1(options);
	const scanned = await scan({ database, catalogId, chosen: null, expected: null,
		retainedBytes: PHOTO_SMART_COLLECTION_LIMITS_V1.maximumDocumentBytes, signal });
	if (scanned.context === null) throw new Error('Archive audit did not capture its context.');
	return Object.freeze({ context: scanned.context, contextDigest: scanned.contextDigest, inventoryDigest: scanned.inventoryDigest });
}

/** Private CRUD handoff binds the exact owning packet and its retained candidate budget. */
export async function prepareLightscaperNativeSmartCollectionWriteGuardCurrentV1(database: DatabaseSync, value: unknown,
	root: Readonly<PhotoCatalogRootV1>, signal?: AbortSignal): Promise<object> {
	const packet = readAdmittedLightscaperNativeSmartCollectionWriteCurrentV1(value);
	const chosen = readValidatedPhotoCatalogRootV1(root);
	if (chosen.id !== packet.catalogId || chosen.revision !== packet.options.expectedCatalogRevision) throw new PhotoCatalogRevisionConflictError('catalog');
	const retainedBytes = packet.candidate === null ? 0 : bytes(packet.candidate), validationDigest = digest(chosen);
	const scanned = await scan({ database, catalogId: packet.catalogId, chosen, expected: packet.options.expectedCatalogRevision, retainedBytes, signal });
	return grant({ database, contextDigest: scanned.contextDigest, validationDigest, packet, retainedBytes });
}
export function assertLightscaperNativeSmartCollectionWriteGuardCurrentV1(guard: unknown, database: DatabaseSync,
	context: LightscaperNativeSmartCollectionContextCurrentV1, value: unknown): void {
	const binding = readProof(guard, database), packet = readAdmittedLightscaperNativeSmartCollectionWriteCurrentV1(value);
	if (binding.packet !== packet || binding.validationDigest !== digest(context.root)
		|| binding.retainedBytes !== (packet.candidate === null ? 0 : bytes(packet.candidate))) throw new TypeError('Saved audit guard belongs to another admitted writer candidate or budget.');
	assertContext(binding, database, context); proofs.delete(guard as object);
}

/** Complete canonical authority, including physical absence versus a persisted tombstone. */
export function lightscaperNativeSmartCollectionContextDigestCurrentV1(context: LightscaperNativeSmartCollectionContextCurrentV1): string {
	return digest({ root: context.root, index: context.index, state: context.state, persistedState: context.persistedState });
}
function grant(binding: Binding): LightscaperNativeSmartCollectionRootGuardCurrentV1 {
	const guard = Object.freeze({}) as LightscaperNativeSmartCollectionRootGuardCurrentV1;
	proofs.set(guard, binding); return guard;
}
function readProof(value: unknown, database: DatabaseSync): Binding {
	const binding = value !== null && typeof value === 'object' ? proofs.get(value) : undefined;
	if (!binding || binding.database !== database) throw new TypeError('Invalid, consumed or foreign native saved audit guard.');
	return binding;
}
function assertContext(binding: Binding, database: DatabaseSync, context: LightscaperNativeSmartCollectionContextCurrentV1): void {
	if (!database.isTransaction) throw new Error('Saved audit guard requires a fresh caller-owned transaction.');
	if (binding.contextDigest !== lightscaperNativeSmartCollectionContextDigestCurrentV1(context)) throw new PhotoCatalogRevisionConflictError('catalog');
}

/** Four independently counted traversals; no full inventory array, COUNT, held
 * iterator, borrowed callback or transaction survives an asynchronous yield. */
async function scan(options: Scan): Promise<ScanResult> {
	const { database, catalogId, chosen, expected, retainedBytes, signal } = options;
	const chosenBytes = chosen === null ? LIGHTSCAPER_CATALOG_LIMITS.maximumDocumentBytes : bytes(chosen);
	const inventory = createHash('sha256'); let captured: string | null = null;
	let archiveContext: Readonly<LightscaperNativeSmartCollectionContextCurrentV1> | null = null;
	for (const phase of phases) {
		const progress: Progress = { afterKey: null, count: 0 }; let done = false;
		while (!done) {
			notAborted(signal);
			done = transaction(database, 'read', signal, () => {
				const context = capture(database, catalogId, null);
				if (expected !== null && context.root.revision !== expected) throw new PhotoCatalogRevisionConflictError('catalog');
				if (chosen !== null && chosen.photoCount !== context.root.photoCount) throw new RangeError('Only photo publication changes the catalog photo count.');
				const current = lightscaperNativeSmartCollectionContextDigestCurrentV1(context);
				if (captured !== null && captured !== current) throw new PhotoCatalogRevisionConflictError('catalog');
				captured = current;
				const root = chosen ?? context.root;
				if (root.collections.length + context.state.collectionCount > PHOTO_SMART_COLLECTION_LIMITS_V1.maximumCollections) throw new RangeError('Combined collection count exceeds its 10000 collection budget.');
				const baseBytes = chosenBytes + bytes(context.root) + bytes(context.index) + bytes(context.state)
					+ PHOTO_SMART_COLLECTION_RECORD_LIMITS_V1.maximumBytes + retainedBytes + LIMITS.reservedScalarBytes;
				const complete = auditPage(database, phase, progress, context.state.collectionCount, root, baseBytes, inventory, signal);
				// Retain no previous full native root across pages. The external ordinary
				// snapshot root is already reserved; return only the final joined context.
				if (chosen === null && phase === 'summary-index' && complete) archiveContext = context;
				return complete;
			});
			notAborted(signal);
			if (!done) { await new Promise<void>(resolve => setTimeout(resolve, 0)); notAborted(signal); }
		}
	}
	notAborted(signal);
	if (captured === null) throw new Error('Native saved audit did not capture authority.');
	return { context: archiveContext, contextDigest: captured, inventoryDigest: inventory.digest('hex') };
}
function auditPage(database: DatabaseSync, phase: Phase, progress: Progress, count: number,
	root: Readonly<PhotoCatalogRootV1>, baseBytes: number, inventory: Hash, signal?: AbortSignal): boolean {
	const indexed = phase.endsWith('index'), definitions = phase === 'definitions' || phase === 'definition-index';
	const allowance = indexed ? 4096 : definitions ? PHOTO_SMART_COLLECTION_RECORD_LIMITS_V1.maximumBytes + PHOTO_SMART_COLLECTION_LIMITS_V1.maximumSummaryBytes
		: PHOTO_SMART_COLLECTION_LIMITS_V1.maximumSummaryBytes;
	let charged = baseBytes, processed = 0;
	while (processed < LIMITS.maximumKeys && (phase !== 'definitions' || processed < LIMITS.maximumDefinitions)) {
		notAborted(signal);
		const key = nextKey(database, root.id, definitions, indexed, progress.afterKey);
		if (key === null) {
			if (progress.count !== count) throw new TypeError('Saved collection inventory count differs from its state.');
			return true;
		}
		if (charged + allowance > LIMITS.maximumPageBytes) {
			if (processed === 0) throw new RangeError('Saved collection audit page cannot admit one record.');
			return false;
		}
		if (++progress.count > count) throw new TypeError('Saved collection inventory count exceeds its state.');
		if (indexed) charged += bytes(key);
		else if (definitions) {
			const admitted = pair(database, root.id, key, root);
			if (admitted === null) throw new TypeError('Saved definition disappeared inside its inventory snapshot.');
			charged += bytes(admitted.record) + bytes({ key, catalogId: root.id, document: admitted.summary });
			const serialized = Buffer.from(serializePhotoSmartCollectionV1(admitted.definition), 'utf8');
			const length = Buffer.allocUnsafe(4); length.writeUInt32LE(serialized.byteLength); inventory.update(length); inventory.update(serialized);
		} else {
			const raw = database.prepare(`SELECT ${SUMMARY_COLUMNS} FROM native_photo_smart_collection_summaries WHERE collection_key=?`).get(key);
			const summary = readLightscaperNativeSmartCollectionSummaryRowCurrentV1(raw, root.id, key);
			charged += bytes({ key, catalogId: root.id, document: summary });
		}
		progress.afterKey = key; processed++; notAborted(signal);
	}
	return false;
}
function nextKey(database: DatabaseSync, catalogId: string, definitions: boolean, indexed: boolean, after: string | null): string | null {
	const table = definitions ? 'native_photo_smart_collections' : 'native_photo_smart_collection_summaries';
	const prefix = JSON.stringify([catalogId]).slice(0, -1) + ',';
	const raw = indexed
		? database.prepare(`SELECT collection_key,catalog_id,collection_id FROM ${table} INDEXED BY ${table}_catalog_key
			WHERE catalog_id=? AND collection_key>? ORDER BY collection_key LIMIT 1`).get(catalogId, after ?? '')
		: database.prepare(`SELECT collection_key,catalog_id,collection_id FROM ${table}
			WHERE collection_key>? AND collection_key<? ORDER BY collection_key LIMIT 1`).get(after ?? prefix, prefix + '\uffff');
	if (raw === undefined) return null;
	const input = record(raw, 'native saved inventory key', ['collection_key', 'catalog_id', 'collection_id']);
	const key = readPhotoSmartCollectionScopedKeyV1(field(input, 'collection_key'), catalogId);
	if (field(input, 'catalog_id') !== catalogId || key !== photoSmartCollectionKeyV1(catalogId, id(field(input, 'collection_id'), 'saved inventory ID'))
		|| after !== null && key <= after) throw new TypeError('Saved inventory key disagrees with its canonical catalog scope.');
	return key;
}
function bytes(value: unknown): number { return Buffer.byteLength(JSON.stringify(value), 'utf8'); }
function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex'); }
