/* SPDX-License-Identifier: AGPL-3.0-only */

import type { LightscaperNativePhotoSessionLeaseCurrentV1 as Lease } from './lightscaper-native-photo-session-lease-current-v1.ts';
import { desktopPhotoSessionSettingsKeyCurrentV1 as keyFor } from '../src/lightscaper/desktop-photo-library-session-settings-current-v1.ts';
type Packet = Readonly<Record<string, unknown>>;
type Catalog = Lease['components']['catalog'];
const CHECK = AbortSignal.prototype.throwIfAborted;
/** Explicit named owning calls only. Packet readers have captured complete
 * domain values; the actual native frontdoors independently authenticate them. */
export function dispatchLightscaperNativePhotoSessionDomainCurrentV1(lease: Lease, family: string, p: Packet, signal: AbortSignal): Promise<unknown> {
	const c = lease.components.catalog, catalog = lease.catalogId, options = { signal }, op = p.operation;
	const request = (p.request ?? {}) as Record<string, unknown>, rev = (key: string) => p[key] as number;
	if (family === 'catalog') switch (op) {
		case 'create': return c.createCatalog(p.root);
		case 'load': return c.loadCatalog(catalog);
		case 'load-photo': return c.loadPhoto(catalog, p.photoId as string);
		case 'publish': return c.publishPhotos(catalog, rev('expectedCatalogRevision'), p.photos, options);
		case 'publish-derived': return c.publishDerivedPhotoCurrentV1(catalog, rev('expectedCatalogRevision'), p.selections, p.photo, options);
		case 'save-photo': return c.savePhoto(p.photo, rev('expectedPhotoRevision'), options);
		case 'save-root': return c.saveCatalog(p.root, rev('expectedCatalogRevision'), options);
		case 'summaries': return c.readSummaryPage(catalog, { ...request, signal } as Parameters<Catalog['readSummaryPage']>[1]);
		case 'snapshot': return c.readSnapshot(catalog, options);
		case 'culling-destination': return c.readCullingDestinationPage(catalog, p.context as Parameters<Catalog['readCullingDestinationPage']>[1], { ...request, signal } as Parameters<Catalog['readCullingDestinationPage']>[2]);
	}
	if (family === 'query') switch (op) {
		case 'read-v1': return c.readQueryPage(catalog, { ...request, signal });
		case 'read-v2': return c.readQueryPageV2(catalog, { ...request, signal });
		case 'collapsed-v1': return c.readStackQueryPage(catalog, { ...request, signal });
		case 'collapsed-v2': return c.readStackQueryPageV2(catalog, { ...request, signal });
		case 'rebuild-v1': return c.rebuildQueryIndexPage(catalog, options);
		case 'rebuild-v2': return c.rebuildQueryIndexPageV2(catalog, options);
	}
	if (family === 'stacks') {
		const write = { expectedCatalogRevision: rev('expectedCatalogRevision'), expectedStateRevision: rev('expectedStateRevision'), signal };
		switch (op) {
			case 'load': return c.loadStack(catalog, p.stackId as string, options);
			case 'state': return c.readStackState(catalog, options);
			case 'page': return c.readStackPage(catalog, { ...request, signal } as Parameters<Catalog['readStackPage']>[1]);
			case 'memberships': return c.readStackMembershipPage(catalog, { ...request, signal } as Parameters<Catalog['readStackMembershipPage']>[1]);
			case 'members': return c.readStackMemberPage(catalog, p.stackId as string, rev('expectedStackRevision'), p.photoIds as readonly string[], options);
			case 'save': return c.saveStack(p.stack, p.expectedStackRevision as number | null, write);
			case 'dissolve': return c.dissolveStack(catalog, p.stackId as string, rev('expectedStackRevision'), write);
		}
	}
	if (family === 'saved') {
		const write = { expectedCatalogRevision: rev('expectedCatalogRevision'), expectedIndexRevision: rev('expectedIndexRevision'), expectedStateRevision: rev('expectedStateRevision'), signal };
		switch (op) {
			case 'load': return c.loadSmartCollection(catalog, p.collectionId as string, options);
			case 'state': return c.readSmartCollectionState(catalog, options);
			case 'page': return c.readSmartCollectionPage(catalog, { ...request, signal } as Parameters<Catalog['readSmartCollectionPage']>[1]);
			case 'snapshot': return c.readSmartCollectionSnapshotV1(catalog, p.selectedId as string | null, options);
			case 'save': return c.saveSmartCollection(p.definition, p.expectedRevision as number | null, write);
			case 'delete': return c.deleteSmartCollection(catalog, p.collectionId as string, rev('expectedRevision'), write);
			case 'query': return c.readSmartCollectionQueryPageV1(catalog, p.collectionId as string, { ...request, signal });
			case 'collapsed-query': return c.readSmartCollectionStackQueryPageV1(catalog, p.collectionId as string, { ...request, signal });
			case 'archive-context': return c.readSmartCollectionArchiveContextV1(catalog, options);
		}
	}
	if (family === 'custody') {
		const custody = lease.components.media.catalogOriginals;
		switch (op) {
			case 'retain': return custody.retain(catalog, p.references, options);
			case 'stage': return custody.stage(catalog, p.importId as string, p.references, options);
			case 'release': return custody.release(catalog, p.photoIds, options);
			case 'release-staged': return custody.releaseStaged(catalog, p.importId as string, p.photoIds, options);
			case 'promote': return custody.promote(catalog, p.importId as string, p.photoIds, options);
			case 'page': return custody.readPage({ catalogId: catalog, importId: p.importId as string | null, afterKey: p.afterKey as string | null }, options);
			case 'digest-page': return custody.findDigestPage(p.sha256 as string, p.afterAssetId as string | null, options);
		}
	}
	if (family === 'settings') return settings(lease, p, signal);
	return Promise.reject(new TypeError('Unknown native domain operation.'));
}
async function settings(lease: Lease, p: Packet, signal: AbortSignal): Promise<unknown> {
	const domain = p.domain, op = p.operation, key = op === 'read-import-intent' ? '' : keyFor(lease.catalogId, domain);
	const selected = lease.components.settings;
	if (op === 'read-import-intent') return selected.readImportIntentCurrentV1(lease.catalogId);
	if (op === 'get' || op === 'read-entry') {
		const entry = domain === 'import-presets' ? await lease.readImportPresetEntryCurrentV1() : await selected.readSessionDomainEntryCurrentV1(lease.catalogId, domain);
		Reflect.apply(CHECK, signal, []); return op === 'read-entry' ? entry : entry.present ? entry.value : undefined;
	}
	if (domain === 'import-presets') {
		if (op === 'put-if-absent') return lease.importPresets.putIfAbsent(key, p.value);
		if (op === 'replace-if-current') return lease.importPresets.replaceIfCurrent(key, p.expected, p.replacement);
		throw new TypeError('Unknown fixed anchor operation.');
	}
	const repository = selected.settingsRepository;
	switch (op) {
		case 'put': return repository.put(key, p.value);
		case 'delete': return repository.delete(key);
		case 'put-if-absent': return repository.putIfAbsent(key, p.value);
		case 'replace-if-current': return repository.replaceIfCurrent(key, p.expected, p.replacement);
		case 'delete-if-current': return repository.deleteIfCurrent(key, p.expected);
		case 'replace-and-put-if-absent': return repository.replaceIfCurrentAndPutIfAbsent(key, p.expected, p.replacement, keyFor(lease.catalogId, p.intentDomain), p.intent);
	}
	throw new TypeError('Unknown fixed settings operation.');
}
/** Only actual owning write acknowledgements bypass a later read fence. */
export function lightscaperNativePhotoSessionOwnsAckCurrentV1(family: string, p: Packet, result: unknown): boolean {
	const op = p.operation;
	if (family === 'catalog') return op === 'create' || op === 'publish' || op === 'publish-derived' || op === 'save-photo' || op === 'save-root';
	if (family === 'query') return op === 'rebuild-v1' || op === 'rebuild-v2';
	if (family === 'stacks') return op === 'save' || op === 'dissolve';
	if (family === 'saved') return op === 'save' || op === 'delete';
	if (family === 'custody') return op === 'retain' || op === 'stage' || op === 'release' || op === 'release-staged' || op === 'promote';
	if (family === 'settings') return op === 'put' || op === 'delete' || ((op === 'put-if-absent' || op === 'replace-if-current' || op === 'delete-if-current' || op === 'replace-and-put-if-absent') && result === true);
	return family === 'upload' && (op === 'write' || op === 'commit' || op === 'delete-asset');
}
