/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DesktopPhotoLibrarySessionStorageCurrentV1 as Storage } from './desktop-photo-library-session-storage-current-v1.ts';
import { DesktopPhotoSessionClientCallsCurrentV1 as Calls, desktopPhotoSignalCurrentV1 as signalOf } from './desktop-photo-library-session-client-calls-current-v1.ts';
import { readDesktopPhotoSessionCatalogReplyCurrentV1 as reply } from './desktop-photo-library-session-client-replies-current-v1.ts';
import { createDesktopPhotoSessionArchiveCurrentV1 } from './desktop-photo-library-session-owned-client-current-v1.ts';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../common/foundation/closed-domain-value.ts';

type Catalog = Storage['components']['catalog'];
type Family = 'catalog' | 'query' | 'stacks' | 'saved';
export function createDesktopPhotoSessionCatalogCurrentV1(c: Calls): Catalog {
	const catalog = (value: unknown): void => { c.catalog(value); };
	function call<Method extends keyof Catalog>(method: Method, family: Family, capture: () => { payload: Record<string, unknown>; signal?: AbortSignal }, mutation = false): ReturnType<Catalog[Method]> {
		const work = c.own(() => { const packet = capture(); return c.send(family, () => packet.payload,
			value => reply(method, value, c.descriptor.catalogId, packet.payload), packet.signal, false, mutation); });
		return work as ReturnType<Catalog[Method]>;
	}
	function read<Method extends keyof Catalog>(method: Method, family: Family, operation: string, catalogId: string, options: unknown = {}, extra = {}): ReturnType<Catalog[Method]> {
		return call(method, family, () => { catalog(catalogId); const captured = optionsRecord(options);
			return { signal: captured.signal, payload: { operation, ...extra, ...(Object.keys(captured.request).length ? { request: captured.request } : {}) } }; });
	}
	return Object.freeze<Catalog>({
		createCatalog: root => call('createCatalog', 'catalog', () => ({ payload: { operation: 'create', root } }), true),
		loadCatalog: id => read('loadCatalog', 'catalog', 'load', id),
		loadPhoto: (id, photoId) => read('loadPhoto', 'catalog', 'load-photo', id, {}, { photoId }),
		publishPhotos: (id, expectedCatalogRevision, photos, options = {}) => call('publishPhotos', 'catalog', () => {
			catalog(id); return { payload: { operation: 'publish', expectedCatalogRevision, photos }, signal: signalOf(options) }; }, true),
		publishDerivedPhotoCurrentV1: (id, expectedCatalogRevision, selections, photo, options = {}) => call('publishDerivedPhotoCurrentV1', 'catalog', () => {
			catalog(id); return { payload: { operation: 'publish-derived', expectedCatalogRevision, selections, photo }, signal: signalOf(options) }; }, true),
		savePhoto: (photo, expectedPhotoRevision, options = {}) => call('savePhoto', 'catalog', () => ({ payload: { operation: 'save-photo', photo, expectedPhotoRevision }, signal: signalOf(options) }), true),
		saveCatalog: (root, expectedCatalogRevision, options = {}) => call('saveCatalog', 'catalog', () => ({ payload: { operation: 'save-root', root, expectedCatalogRevision }, signal: signalOf(options) }), true),
		readSummaryPage: (id, options = {}) => call('readSummaryPage', 'catalog', () => { catalog(id); const p = optionsRecord(options); return { payload: { operation: 'summaries', request: p.request }, signal: p.signal }; }),
		readSnapshot: (id, options = {}) => read('readSnapshot', 'catalog', 'snapshot', id, options),
		readCullingDestinationPage: (id, context, request) => call('readCullingDestinationPage', 'catalog', () => {
			catalog(id); const p = optionsRecord(request); return { payload: { operation: 'culling-destination', context, request: p.request }, signal: p.signal }; }),
		readQueryPage: (id, options = {}) => query('readQueryPage', 'read-v1', id, options),
		readQueryPageV2: (id, options = {}) => query('readQueryPageV2', 'read-v2', id, options),
		readStackQueryPage: (id, options = {}) => query('readStackQueryPage', 'collapsed-v1', id, options),
		readStackQueryPageV2: (id, options = {}) => query('readStackQueryPageV2', 'collapsed-v2', id, options),
		rebuildQueryIndexPage: (id, options = {}) => read('rebuildQueryIndexPage', 'query', 'rebuild-v1', id, options),
		rebuildQueryIndexPageV2: (id, options = {}) => read('rebuildQueryIndexPageV2', 'query', 'rebuild-v2', id, options),
		loadStack: (id, stackId, options = {}) => read('loadStack', 'stacks', 'load', id, options, { stackId }),
		readStackState: (id, options = {}) => read('readStackState', 'stacks', 'state', id, options),
		readStackPage: (id, options = {}) => page('readStackPage', 'stacks', 'page', id, options),
		readStackMembershipPage: (id, options = {}) => page('readStackMembershipPage', 'stacks', 'memberships', id, options),
		readStackMemberPage: (id, stackId, expectedStackRevision, photoIds, options = {}) => read('readStackMemberPage', 'stacks', 'members', id, options, { stackId, expectedStackRevision, photoIds }),
		saveStack: (stack, expectedStackRevision, options) => call('saveStack', 'stacks', () => { const p = optionsRecord(options); return { payload: { operation: 'save', stack, expectedStackRevision, ...p.request }, signal: p.signal }; }, true),
		dissolveStack: (id, stackId, expectedStackRevision, options) => call('dissolveStack', 'stacks', () => { catalog(id); const p = optionsRecord(options); return { payload: { operation: 'dissolve', stackId, expectedStackRevision, ...p.request }, signal: p.signal }; }, true),
		loadSmartCollection: (id, collectionId, options = {}) => read('loadSmartCollection', 'saved', 'load', id, options, { collectionId }),
		readSmartCollectionState: (id, options = {}) => read('readSmartCollectionState', 'saved', 'state', id, options),
		readSmartCollectionPage: (id, options = {}) => page('readSmartCollectionPage', 'saved', 'page', id, options),
		readSmartCollectionSnapshotV1: (id, selectedId, options = {}) => read('readSmartCollectionSnapshotV1', 'saved', 'snapshot', id, options, { selectedId }),
		saveSmartCollection: (definition, expectedRevision, options) => call('saveSmartCollection', 'saved', () => { const p = optionsRecord(options); return { payload: { operation: 'save', definition, expectedRevision, ...p.request }, signal: p.signal }; }, true),
		deleteSmartCollection: (id, collectionId, expectedRevision, options) => call('deleteSmartCollection', 'saved', () => { catalog(id); const p = optionsRecord(options); return { payload: { operation: 'delete', collectionId, expectedRevision, ...p.request }, signal: p.signal }; }, true),
		readSmartCollectionQueryPageV1: (id, collectionId, options = {}) => page('readSmartCollectionQueryPageV1', 'saved', 'query', id, options, { collectionId }),
		readSmartCollectionStackQueryPageV1: (id, collectionId, options = {}) => page('readSmartCollectionStackQueryPageV1', 'saved', 'collapsed-query', id, options, { collectionId }),
		readSmartCollectionArchiveContextV1: (id, options = {}) => read('readSmartCollectionArchiveContextV1', 'saved', 'archive-context', id, options),
		captureSmartCollectionArchiveV1: (id, options = {}) => c.own(() => { catalog(id); return createDesktopPhotoSessionArchiveCurrentV1(c, signalOf(options)); }),
	});
	function query<Method extends keyof Catalog>(method: Method, operation: string, id: string, options: unknown): ReturnType<Catalog[Method]> { return page(method, 'query', operation, id, options); }
	function page<Method extends keyof Catalog>(method: Method, family: Family, operation: string, id: string, options: unknown, extra = {}): ReturnType<Catalog[Method]> {
		return call(method, family, () => { catalog(id); const p = optionsRecord(options); return { payload: { operation, ...extra, request: p.request }, signal: p.signal }; });
	}
}
/** Capture inert own option fields; native signals stay local. Main repeats the
	* fixed family admission on these complete records before invoking an owner. */
function optionsRecord(value: unknown): { request: Record<string, unknown>; signal?: AbortSignal } {
	const input = record(value, 'desktop Session options', ['signal', 'query', 'continuation', 'filter', 'photoIds', 'photoId', 'expectedCatalogRevision', 'expectedIndexRevision', 'expectedStateRevision'], []);
	const request: Record<string, unknown> = {};
	for (const key of Object.keys(input)) if (key !== 'signal') request[key] = field(input, key, 'desktop Session options');
	const signal = signalOf(Object.hasOwn(input, 'signal') ? { signal: field(input, 'signal', 'desktop Session options') } : {});
	return { request, ...(signal ? { signal } : {}) };
}
