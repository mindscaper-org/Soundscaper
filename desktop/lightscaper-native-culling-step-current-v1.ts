/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import type { AdmittedLightscaperNativeCullingNavigationCurrentV1 } from './lightscaper-native-culling-admission-current-v1.ts';
import { readLightscaperNativeCatalogRowCurrentV1, readLightscaperNativeSummaryRowCurrentV1 } from './lightscaper-native-catalog-records-current-v1.ts';
import { captureLightscaperNativeSmartCollectionContextCurrentV1 } from './lightscaper-native-smart-collection-context-current-v1.ts';
import { captureLightscaperNativeStackGroupingContextCurrentV1 } from './lightscaper-native-stack-auth-current-v1.ts';
import { readLightscaperNativeCullingPointCurrentV1, type LightscaperNativeCullingQueryCurrentV1 } from './lightscaper-native-culling-point-current-v1.ts';
import { readLightscaperNativeLegacyQueryInTransactionCurrentV1 } from './lightscaper-native-legacy-query-pages-current-v1.ts';
import { readLightscaperNativeQueryInTransactionCurrentV1 } from './lightscaper-native-query-page-kernel-current-v1.ts';
import { readLightscaperNativeStackQueryInTransactionCurrentV1, readLightscaperNativeLegacyStackQueryInTransactionCurrentV1,
	type LightscaperNativeStackQueryDestinationCurrentV1 } from './lightscaper-native-stack-query-kernel-shared-current-v1.ts';
import { issueLightscaperNativeStackQueryProgressCurrentV1 } from './lightscaper-native-stack-query-progress-current-v1.ts';
import { issueLightscaperNativeLegacyStackQueryProgressCurrentV1 } from './lightscaper-native-legacy-stack-query-progress-current-v1.ts';
import { issueLightscaperNativeSavedQueryProgressCurrentV1, lightscaperNativeSavedDefinitionDigestCurrentV1 } from './lightscaper-native-smart-collection-query-progress-current-v1.ts';
import { PhotoCatalogRevisionConflictError, type PhotoSummaryV1 } from '../src/lightscaper/catalog/repository-types.ts';
import { validatePhotoSmartCollectionReferencesV1 } from '../src/lightscaper/catalog/photo-smart-collection-references-v1.ts';
import { photoQueryDigestV1 } from '../src/lightscaper/catalog/photo-query-types-v1.ts';
import { photoQueryDigestV2, readPhotoQueryContinuationV2, type PhotoCatalogQueryV2 } from '../src/lightscaper/catalog/photo-query-types-v2.ts';
import type { PhotoStackQueryContinuationV1 } from '../src/lightscaper/catalog/photo-stack-query-types-v1.ts';
import type { PhotoLibraryPageV1 } from '../src/common/editor/photo-library-session-port-v1.ts';

interface Proof {
	readonly root: number;
	readonly index: number;
	readonly saved?: Readonly<{ revision: number; state: number; digest: string }>;
}
type Pending = Pick<PhotoStackQueryContinuationV1, 'catalogId' | 'catalogRevision' | 'indexRevision' | 'stateRevision' | 'captureBucket' | 'afterKey' | 'pending' | 'stackAudit'>;
export interface LightscaperNativeCullingProgressCurrentV1 {
	proof: Proof | null;
	start: LightscaperNativeStackQueryDestinationCurrentV1 | null;
	pending: Pending | null;
}
type Next = Readonly<{ captureBucket: 0 | 1; afterKey: readonly (string | number)[] | null }> & Partial<Pick<Pending, 'pending' | 'stackAudit'>>;
const nativeCheck = AbortSignal.prototype.throwIfAborted;

/** Synchronous caller-snapshot body only. No document, recipe, stack inventory
 * or iterator escapes through private progress; it contains scalar proof and
 * tuple/member/audit positions only. No public wrapper is nested here. */
export function readLightscaperNativeCullingStepCurrentV1(database: DatabaseSync, input: AdmittedLightscaperNativeCullingNavigationCurrentV1,
	progress: LightscaperNativeCullingProgressCurrentV1, signal?: AbortSignal): PhotoLibraryPageV1 | null | undefined {
	if (!database.isTransaction) throw new Error('Native culling step requires one caller snapshot.'); check(signal);
	const { catalogId, context: selected, photoId } = input;
	const saved = selected.kind === 'saved' ? captureLightscaperNativeSmartCollectionContextCurrentV1(database, catalogId, selected.collectionId) : null;
	const { root, index } = saved ?? readRoot(database, catalogId);
	let query: LightscaperNativeCullingQueryCurrentV1 | null = selected.kind === 'query' ? selected.query : null;
	let savedProof: Proof['saved'];
	if (saved !== null) {
		if (saved.definition === null) throw new ReferenceError('Selected culling saved query is missing.');
		validatePhotoSmartCollectionReferencesV1(saved.definition, root); query = saved.definition.query;
		savedProof = Object.freeze({ revision: saved.definition.revision, state: saved.state.revision, digest: lightscaperNativeSavedDefinitionDigestCurrentV1(saved.definition) });
	}
	const proof: Proof = Object.freeze({ root: root.revision, index: index.indexRevision, ...(savedProof === undefined ? {} : { saved: savedProof }) });
	if (progress.proof !== null && JSON.stringify(progress.proof) !== JSON.stringify(proof)) throw new PhotoCatalogRevisionConflictError('catalog'); progress.proof = proof;
	const point = readLightscaperNativeCullingPointCurrentV1(database, root, photoId, query, signal); if (point === null) return null;
	if (selected.kind === 'plain') {
		const rows = database.prepare(`SELECT photo_key,catalog_id,photo_id,revision,summary FROM native_photos
			WHERE catalog_id=? AND photo_key>? ORDER BY photo_key COLLATE BINARY ASC LIMIT 63`).all(catalogId, point.summary.key);
		const items = [point.summary, ...rows.map(raw => { check(signal); return readLightscaperNativeSummaryRowCurrentV1(raw, catalogId); })];
		return page(root.name, root.photoCount, items, items.length === 64 ? { catalogId, indexRevision: index.indexRevision, scope: `${catalogId}|all`, afterKey: items.at(-1)!.key } : null);
	}
	if (query === null || point.position === null) throw new TypeError('Native culling query lost its admitted inclusive point.');
	const metadata = 'schemaVersion' in query;
	if (!selected.collapsed) {
		const result = 'schemaVersion' in query ? readLightscaperNativeQueryInTransactionCurrentV1(database, root, index, query, null, signal, point.position)
			: readLightscaperNativeLegacyQueryInTransactionCurrentV1(database, root, index, query, null, signal, point.position);
		if (result.items[0]?.photoId !== photoId) throw new TypeError('Culling inclusive index failed to deliver its admitted point row.');
		const cursor = selected.kind === 'saved' ? savedCursor(database, catalogId, selected.collectionId, false, query as PhotoCatalogQueryV2, proof, result.continuation, null)
			: metadata && result.continuation !== null ? readPhotoQueryContinuationV2(result.continuation, catalogId, query as PhotoCatalogQueryV2) : result.continuation;
		return page(root.name, root.photoCount, result.items, cursor);
	}
	progress.start ??= { position: point.position, inclusivePending: true, auditComplete: false, stateRevision: null };
	// Preserve browser ordering: grouping is read only after ready selected
	// point admission; its known state fence remains inside the fixed kernel.
	const grouping = captureLightscaperNativeStackGroupingContextCurrentV1(database, catalogId);
	if ('schemaVersion' in query) {
		const result = readLightscaperNativeStackQueryInTransactionCurrentV1(database, grouping, query, progress.pending === null ? null
			: { schemaVersion: 2, kind: 'collapsed-photo-query', ...progress.pending, querySha256: photoQueryDigestV2(query) }, signal, progress.start);
		progress.pending = result.continuation;
		if (progress.start.inclusivePending || result.continuation?.pending?.photoId === photoId) return undefined;
		if (result.items[0]?.photoId !== photoId) return null;
		const cursor = selected.kind === 'saved' ? savedCursor(database, catalogId, selected.collectionId, true, query, proof, result.continuation, result.stateRevision)
			: result.continuation === null ? null : issueLightscaperNativeStackQueryProgressCurrentV1(database, result.continuation, query);
		return page(root.name, root.photoCount, result.items, cursor);
	}
	const result = readLightscaperNativeLegacyStackQueryInTransactionCurrentV1(database, grouping, query, progress.pending === null ? null
		: { schemaVersion: 1, kind: 'collapsed-photo-query', ...progress.pending, querySha256: photoQueryDigestV1(query) }, signal, progress.start);
	progress.pending = result.continuation;
	if (progress.start.inclusivePending || result.continuation?.pending?.photoId === photoId) return undefined;
	if (result.items[0]?.photoId !== photoId) return null;
	return page(root.name, root.photoCount, result.items, result.continuation === null ? null : issueLightscaperNativeLegacyStackQueryProgressCurrentV1(database, result.continuation, query));
}
function readRoot(database: DatabaseSync, catalogId: string) {
	const raw = database.prepare('SELECT id,document,root_revision,photo_count,index_revision FROM native_photo_catalogs WHERE id=?').get(catalogId);
	if (raw === undefined) throw new ReferenceError('Photo catalog is missing.'); return readLightscaperNativeCatalogRowCurrentV1(raw, catalogId);
}
function savedCursor(database: DatabaseSync, catalogId: string, collectionId: string, collapsed: boolean, query: PhotoCatalogQueryV2,
	proof: Proof, next: Next | null, stackStateRevision: number | null) {
	if (next === null) return null;
	if (!proof.saved) throw new TypeError('Native saved culling cursor lost its selected definition proof.');
	return issueLightscaperNativeSavedQueryProgressCurrentV1(database, { schemaVersion: 1, kind: 'saved-photo-query', mode: collapsed ? 'collapsed' : 'ordinary', catalogId, collectionId,
		definitionRevision: proof.saved.revision, collectionStateRevision: proof.saved.state, definitionSha256: proof.saved.digest,
		querySha256: photoQueryDigestV2(query), catalogRevision: proof.root, indexRevision: proof.index, sort: query.sort,
		captureBucket: next.captureBucket, afterKey: next.afterKey, stackStateRevision, pending: next.pending ?? null, stackAudit: next.stackAudit ?? null });
}
function page(catalogName: string, totalCount: number, items: readonly PhotoSummaryV1[], cursor: unknown): PhotoLibraryPageV1 {
	return Object.freeze({ catalogName, totalCount, rows: Object.freeze(items.map(row => Object.freeze({ id: row.photoId, fileName: row.fileName,
		width: row.width, height: row.height, rating: row.rating, flag: row.flag, colorLabel: row.colorLabel }))), cursor: cursor === null ? null : JSON.stringify(cursor) });
}
function check(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(nativeCheck, signal, []); }
