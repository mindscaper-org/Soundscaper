/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DesktopPhotoLibrarySessionStorageCurrentV1 as Storage } from './desktop-photo-library-session-storage-current-v1.ts';
import { array, field, id, integer, record, text, boolean, oneOf } from './catalog/value-validation.ts';
import { readValidatedPhotoCatalogRootV1 } from './catalog/documents.ts';
import { normalizePhotoDocumentCurrentV1 } from './catalog/photo-document-current-v1.ts';
import { readPhotoSummary, filterScope, photoStorageKey } from './catalog/repository-records.ts';
import { normalizePhotoStackV1, normalizePhotoStackStateV1 } from './catalog/photo-stack-v1.ts';
import { normalizePhotoSmartCollectionV1, readPhotoSmartCollectionSummaryV1 } from './catalog/photo-smart-collection-v1.ts';
import { normalizePhotoSmartCollectionsStateV1 } from './catalog/photo-smart-collection-state-v1.ts';
import { readPhotoSmartCollectionPageOptionsV1 } from './catalog/photo-smart-collection-repository-types-v1.ts';
import { readPhotoStackPageOptionsV1 } from './catalog/photo-stack-repository-contract-v1.ts';
import { normalizePhotoCatalogQueryV1, readPhotoQueryContinuationV1 } from './catalog/photo-query-types-v1.ts';
import { PHOTO_QUERY_LIMITS_V2, normalizePhotoCatalogQueryV2, readPhotoQueryContinuationV2 } from './catalog/photo-query-types-v2.ts';
import { readPhotoStackQueryContinuationV1 } from './catalog/photo-stack-query-types-v1.ts';
import { readPhotoStackQueryContinuationV2 } from './catalog/photo-stack-query-types-v2.ts';
import { readPhotoSavedQueryContinuationV1 } from './catalog/photo-smart-collection-query-types-v1.ts';

type Catalog = Storage['components']['catalog'];
const n = (value: unknown): number => integer(value, 0, Number.MAX_SAFE_INTEGER, 'desktop count/revision');
const scalar = (value: unknown): string => text(value, 'desktop scalar', 16_384);
const nullable = <Value>(value: unknown, read: (value: unknown) => Value): Value | null => value === null ? null : read(value);
export function readDesktopPhotoSessionCatalogReplyCurrentV1<Method extends keyof Catalog>(method: Method, value: unknown,
	catalog: string, packet: Readonly<Record<string, unknown>>): Awaited<ReturnType<Catalog[Method]>> {
	const result = read(method, value, catalog, packet);
	// The fixed switch below authenticates the exact domain shape. The generic
	// only reconnects that closed method/result relation to the owning port type.
	return result as Awaited<ReturnType<Catalog[Method]>>;
}
function read(method: keyof Catalog, value: unknown, catalog: string, packet: Readonly<Record<string, unknown>>): unknown {
	switch (method) {
		case 'createCatalog': if (value !== undefined) throw new TypeError('Catalog creation reply must be empty.'); return;
		case 'loadCatalog': return nullable(value, v => root(v, catalog));
		case 'publishPhotos': case 'publishDerivedPhotoCurrentV1': case 'saveCatalog': return root(value, catalog);
		case 'loadPhoto': return nullable(value, v => photo(v, catalog));
		case 'savePhoto': return photo(value, catalog);
		case 'readSnapshot': { if (value === null) return null; const row = record(value, 'catalog snapshot', ['catalog', 'indexRevision']); return Object.freeze({ catalog: root(field(row, 'catalog'), catalog), indexRevision: n(field(row, 'indexRevision')) }); }
		case 'readSummaryPage': { const row = record(value, 'summary page', ['items', 'continuation']); const raw = field(row, 'continuation');
			let continuation = null; if (raw !== null) { const c = record(raw, 'summary continuation', ['catalogId', 'indexRevision', 'scope', 'afterKey']);
				if (field(c, 'catalogId') !== catalog) throw new TypeError('Foreign summary page.');
				const scope = scalar(field(c, 'scope')), afterKey = scalar(field(c, 'afterKey'));
				if (!afterKey.startsWith(`${catalog}|`) || scope !== filterScope(catalog, request(packet).filter as Parameters<typeof filterScope>[1])) throw new TypeError('Foreign summary scope.');
				continuation = Object.freeze({ catalogId: catalog, indexRevision: n(field(c, 'indexRevision')), scope, afterKey }); }
			return Object.freeze({ items: summaries(field(row, 'items'), catalog), continuation }); }
		case 'readQueryPage': case 'readQueryPageV2': case 'readStackQueryPage': case 'readStackQueryPageV2': return query(method, value, catalog, packet);
		case 'rebuildQueryIndexPage': { const row = record(value, 'query progress', ['processed', 'bytes', 'ready']); return Object.freeze({ processed: integer(field(row, 'processed'), 0, 16, 'rebuilt photos'), bytes: integer(field(row, 'bytes'), 0, 8_388_608, 'rebuilt bytes'), ready: boolean(field(row, 'ready'), 'query readiness') }); }
		case 'rebuildQueryIndexPageV2': { const row = record(value, 'query2 progress', ['processed', 'bytes', 'derivedBytes', 'ready']);
			const bytes = integer(field(row, 'bytes'), 0, PHOTO_QUERY_LIMITS_V2.rebuildBytes, 'query2 rebuilt source bytes'), derivedBytes = integer(field(row, 'derivedBytes'), 0, PHOTO_QUERY_LIMITS_V2.rebuildBytes, 'query2 rebuilt derived bytes');
			if (bytes + derivedBytes > PHOTO_QUERY_LIMITS_V2.rebuildBytes) throw new RangeError('Photo query2 rebuild exceeds its combined byte budget.');
			return Object.freeze({ processed: integer(field(row, 'processed'), 0, PHOTO_QUERY_LIMITS_V2.rebuildPhotos, 'query2 rebuilt photos'), bytes, derivedBytes, ready: boolean(field(row, 'ready'), 'query2 readiness') }); }
		case 'loadStack': return nullable(value, v => scoped(normalizePhotoStackV1(v), catalog));
		case 'saveStack': return scoped(normalizePhotoStackV1(value), catalog);
		case 'readStackState': case 'dissolveStack': return scoped(normalizePhotoStackStateV1(value), catalog);
		case 'readStackPage': case 'readStackMembershipPage': { const row = record(value, 'stack page', ['items', 'continuation']);
			const continuation = readPhotoStackPageOptionsV1({ continuation: field(row, 'continuation') }, catalog, method === 'readStackPage' ? 'stacks' : 'memberships').continuation ?? null;
			const items = array(field(row, 'items'), 'stack page rows', 0, 64).map(v => {
				const keys = method === 'readStackPage' ? ['catalogId', 'id', 'revision', 'photoCount', 'coverPhotoId'] : ['catalogId', 'photoId', 'stackId'];
				const item = record(v, 'stack scalar', keys); if (field(item, 'catalogId') !== catalog) throw new TypeError('Foreign stack scalar.');
				return method === 'readStackPage' ? Object.freeze({ catalogId: catalog, id: id(field(item, 'id'), 'stack ID'), revision: n(field(item, 'revision')),
					photoCount: integer(field(item, 'photoCount'), 2, 1024, 'stack count'), coverPhotoId: id(field(item, 'coverPhotoId'), 'cover ID') })
					: Object.freeze({ catalogId: catalog, photoId: id(field(item, 'photoId'), 'Photo ID'), stackId: id(field(item, 'stackId'), 'stack ID') }); }); return Object.freeze({ items: Object.freeze(items), continuation }); }
		case 'readStackMemberPage': return Object.freeze(array(value, 'stack member summaries', 0, 64).map(v => { const row = record(v, 'member summary', ['photoId', 'fileName', 'photoRevision']); return Object.freeze({ photoId: id(field(row, 'photoId'), 'member ID'), fileName: scalar(field(row, 'fileName')), photoRevision: n(field(row, 'photoRevision')) }); }));
		case 'loadSmartCollection': return nullable(value, v => scoped(normalizePhotoSmartCollectionV1(v), catalog));
		case 'readSmartCollectionState': return scoped(normalizePhotoSmartCollectionsStateV1(value), catalog);
		case 'readSmartCollectionPage': { const row = record(value, 'saved summary page', ['items', 'continuation']); return Object.freeze({ items: Object.freeze(array(field(row, 'items'), 'saved summaries', 0, 64).map(v => scoped(readPhotoSmartCollectionSummaryV1(v), catalog))), continuation: readPhotoSmartCollectionPageOptionsV1({ continuation: field(row, 'continuation') }, catalog).continuation }); }
		case 'saveSmartCollection': case 'deleteSmartCollection': { const row = record(value, 'saved write receipt', ['schemaVersion', 'kind', 'catalogId', 'catalogRevision', 'indexRevision', 'state', 'definition']); kind(row, 1, 'photo-smart-collection-write', catalog);
			return Object.freeze({ schemaVersion: 1, kind: 'photo-smart-collection-write', catalogId: catalog, catalogRevision: n(field(row, 'catalogRevision')), indexRevision: n(field(row, 'indexRevision')),
				state: scoped(normalizePhotoSmartCollectionsStateV1(field(row, 'state')), catalog), definition: nullable(field(row, 'definition'), v => scoped(normalizePhotoSmartCollectionV1(v), catalog)) }); }
		case 'readSmartCollectionSnapshotV1': { const row = record(value, 'saved snapshot', ['schemaVersion', 'kind', 'selectedId', 'context', 'definition']); kind(row, 1, 'photo-smart-collection-snapshot');
			const c = record(field(row, 'context'), 'saved snapshot context', ['catalogId', 'catalogRevision', 'indexRevision', 'collectionStateRevision', 'collectionCount']); if (field(c, 'catalogId') !== catalog) throw new TypeError('Foreign saved context.');
			return Object.freeze({ schemaVersion: 1, kind: 'photo-smart-collection-snapshot', selectedId: nullable(field(row, 'selectedId'), v => id(v, 'saved ID')),
				context: Object.freeze({ catalogId: catalog, catalogRevision: n(field(c, 'catalogRevision')), indexRevision: n(field(c, 'indexRevision')), collectionStateRevision: n(field(c, 'collectionStateRevision')), collectionCount: n(field(c, 'collectionCount')) }),
				definition: nullable(field(row, 'definition'), v => scoped(normalizePhotoSmartCollectionV1(v), catalog)) }); }
		case 'readSmartCollectionArchiveContextV1': return readDesktopPhotoArchiveContextCurrentV1(value, catalog);
		case 'readSmartCollectionQueryPageV1': case 'readSmartCollectionStackQueryPageV1': return savedQuery(value, catalog, String(packet.collectionId), method === 'readSmartCollectionQueryPageV1' ? 'ordinary' : 'collapsed');
		case 'readCullingDestinationPage': { if (value === null) return null; const row = record(value, 'culling destination', ['catalogName', 'totalCount', 'rows', 'cursor']);
			return Object.freeze({ catalogName: scalar(field(row, 'catalogName')), totalCount: n(field(row, 'totalCount')), cursor: nullable(field(row, 'cursor'), v => text(v, 'culling cursor', 16_384)),
				rows: Object.freeze(array(field(row, 'rows'), 'culling rows', 0, 64).map(v => { const r = record(v, 'culling row', ['id', 'fileName', 'width', 'height', 'rating', 'flag', 'colorLabel']); return Object.freeze({ id: id(field(r, 'id'), 'Photo ID'), fileName: scalar(field(r, 'fileName')), width: n(field(r, 'width')), height: n(field(r, 'height')), rating: integer(field(r, 'rating'), 0, 5, 'rating'), flag: oneOf(field(r, 'flag'), ['unflagged', 'pick', 'reject'], 'flag'), colorLabel: oneOf(field(r, 'colorLabel'), ['none', 'red', 'yellow', 'green', 'blue', 'purple'], 'label') }); })) }); }
		case 'captureSmartCollectionArchiveV1': throw new TypeError('Archive requires an actual owned iterator.');
	}
}
function request(packet: Readonly<Record<string, unknown>>): Record<string, unknown> { return record(packet.request ?? {}, 'query request', ['query', 'continuation', 'filter', 'photoIds'], []); }
function scoped<Value extends { readonly catalogId: string }>(value: Value, catalog: string): Value { if (value.catalogId !== catalog) throw new TypeError('Foreign desktop result.'); return value; }
function root(value: unknown, catalog: string) { const r = readValidatedPhotoCatalogRootV1(value); if (r.id !== catalog) throw new TypeError('Foreign catalog result.'); return r; }
function photo(value: unknown, catalog: string) { return scoped(normalizePhotoDocumentCurrentV1(value), catalog); }
function summaries(value: unknown, catalog: string) { return Object.freeze(array(value, 'query summaries', 0, 64).map(v => { const s = scoped(readPhotoSummary(v), catalog); if (s.key !== photoStorageKey(catalog, s.photoId)) throw new TypeError('Foreign summary key.'); return s; })); }
function kind(row: Readonly<Record<string, unknown>>, version: number, expected: string, catalog?: string): void { if (field(row, 'schemaVersion') !== version || field(row, 'kind') !== expected || (catalog !== undefined && field(row, 'catalogId') !== catalog)) throw new TypeError('Foreign desktop reply profile.'); }
export function readDesktopPhotoArchiveContextCurrentV1(value: unknown, catalog: string) {
	const row = record(value, 'saved archive context', ['schemaVersion', 'kind', 'catalogId', 'catalogRevision', 'indexRevision', 'state']); kind(row, 1, 'photo-smart-collection-archive-context', catalog);
	return Object.freeze({ schemaVersion: 1 as const, kind: 'photo-smart-collection-archive-context' as const, catalogId: catalog, catalogRevision: n(field(row, 'catalogRevision')), indexRevision: n(field(row, 'indexRevision')), state: nullable(field(row, 'state'), v => scoped(normalizePhotoSmartCollectionsStateV1(v), catalog)) });
}
function query(method: keyof Catalog, value: unknown, catalog: string, packet: Readonly<Record<string, unknown>>) {
	const v2 = method === 'readQueryPageV2' || method === 'readStackQueryPageV2', collapsed = method === 'readStackQueryPage' || method === 'readStackQueryPageV2';
	const keys = ['items', 'scanned', 'continuation', ...(collapsed || v2 ? ['catalogName', 'totalCount'] : []), ...(v2 ? ['schemaVersion', 'kind', 'catalogId', 'catalogRevision', 'indexRevision'] : []), ...(v2 && collapsed ? ['stateRevision'] : [])];
	const row = record(value, 'query page', keys), q = request(packet).query, raw = field(row, 'continuation');
	const continuation = raw === null ? null : v2 ? collapsed ? readPhotoStackQueryContinuationV2(raw, catalog, normalizePhotoCatalogQueryV2(q)) : readPhotoQueryContinuationV2(raw, catalog, normalizePhotoCatalogQueryV2(q))
		: collapsed ? readPhotoStackQueryContinuationV1(raw, catalog, normalizePhotoCatalogQueryV1(q)) : readPhotoQueryContinuationV1(raw, catalog, normalizePhotoCatalogQueryV1(q));
	const result = { items: summaries(field(row, 'items'), catalog), scanned: integer(field(row, 'scanned'), 0, 64, 'scanned candidates'), continuation,
		...(collapsed || v2 ? { catalogName: scalar(field(row, 'catalogName')), totalCount: n(field(row, 'totalCount')) } : {}) };
	if (!v2) return Object.freeze(result); kind(row, 2, collapsed ? 'collapsed-photo-query-page' : 'photo-query-page', catalog);
	return Object.freeze({ ...result, schemaVersion: 2, kind: collapsed ? 'collapsed-photo-query-page' : 'photo-query-page', catalogId: catalog,
		catalogRevision: n(field(row, 'catalogRevision')), indexRevision: n(field(row, 'indexRevision')), ...(collapsed ? { stateRevision: n(field(row, 'stateRevision')) } : {}) });
}
function savedQuery(value: unknown, catalog: string, collection: string, mode: 'ordinary' | 'collapsed') {
	const row = record(value, 'saved query page', ['schemaVersion', 'kind', 'mode', 'catalogId', 'catalogName', 'totalCount', 'catalogRevision', 'indexRevision', 'collectionId', 'collectionName', 'definitionRevision', 'collectionStateRevision', 'definitionSha256', 'querySha256', 'stackStateRevision', 'items', 'scanned', 'continuation']);
	kind(row, 1, 'saved-photo-query-page', catalog); if (field(row, 'mode') !== mode || field(row, 'collectionId') !== collection) throw new TypeError('Foreign saved page.');
	const digest = (key: string): string => { const v = field(row, key); if (typeof v !== 'string' || !/^[a-f0-9]{64}$/u.test(v)) throw new TypeError('Invalid saved digest.'); return v; };
	return Object.freeze({ schemaVersion: 1, kind: 'saved-photo-query-page', mode, catalogId: catalog, catalogName: scalar(field(row, 'catalogName')), totalCount: n(field(row, 'totalCount')),
		catalogRevision: n(field(row, 'catalogRevision')), indexRevision: n(field(row, 'indexRevision')), collectionId: collection, collectionName: scalar(field(row, 'collectionName')),
		definitionRevision: n(field(row, 'definitionRevision')), collectionStateRevision: n(field(row, 'collectionStateRevision')), definitionSha256: digest('definitionSha256'), querySha256: digest('querySha256'),
		stackStateRevision: nullable(field(row, 'stackStateRevision'), n), items: summaries(field(row, 'items'), catalog), scanned: integer(field(row, 'scanned'), 0, 64, 'saved candidates'),
		continuation: nullable(field(row, 'continuation'), v => readPhotoSavedQueryContinuationV1(v, catalog, collection, mode)) });
}
