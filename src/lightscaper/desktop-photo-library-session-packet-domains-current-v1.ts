/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../common/editor/closed-domain-value.ts';
import { filterScope } from './catalog/repository-records.ts';
import { normalizeImageDevelopPresetCurrentForProfileV1 } from '../common/editor/imaging/internal/image-develop-preset-kernel-v1.ts';
import { IMAGE_IMPORT_LIMITS } from '../common/editor/image-import-admission.ts';
import { IMAGE_HDR_ORIGINAL_LIMITS_V1 } from '../common/editor/imaging/image-hdr-original-profile-v1.ts';
import { normalizePhotoOriginalV1 } from './catalog/photo-document-envelope-v1.ts';
import { array, id, integer, text } from './catalog/value-validation.ts';
import { readValidatedPhotoCatalogRootV1 } from './catalog/documents.ts';
import { normalizePhotoDocumentCurrentV1 } from './catalog/photo-document-current-v1.ts';
import { capturePhotoDerivedPublicationGuardCurrentV1 } from './catalog/photo-derived-publication-current-v1.ts';
import { normalizePhotoCatalogQueryV1, readPhotoQueryContinuationV1 } from './catalog/photo-query-types-v1.ts';
import { admitPhotoQueryPageRequestV2 } from './catalog/photo-query-types-v2.ts';
import { admitPhotoStackQueryPageRequestV1 } from './catalog/photo-stack-query-types-v1.ts';
import { admitPhotoStackQueryPageRequestV2 } from './catalog/photo-stack-query-types-v2.ts';
import { readPhotoStackPageOptionsV1, admitPhotoStackSaveV1, admitPhotoStackMemberIdsV1 } from './catalog/photo-stack-repository-contract-v1.ts';
import { admitPhotoSmartCollectionSaveV1, readPhotoSmartCollectionPageOptionsV1 } from './catalog/photo-smart-collection-repository-types-v1.ts';
import { admitPhotoSavedQueryPageRequestV1 } from './catalog/photo-smart-collection-query-types-v1.ts';
import { admitPhotoCullingNavigationV1 } from './catalog/photo-culling-navigation-contract-v1.ts';
import { catalogOriginalId, catalogOriginalReferences, catalogOriginalPhotoIds } from '../common/editor/storage/media-catalog-original-schema.ts';
import { normalizeCatalogOriginalRepairBindingV1 } from '../common/editor/storage/media-catalog-original-repair-contract.ts';
import { normalizeBinaryDerivativeCacheProfileV1, normalizeBinaryDerivativeCacheIdentityV1 } from '../common/editor/storage/binary-derivative-cache-records.ts';
import { normalizeVideoCubeLutReferenceV1 } from '../common/editor/cube-lut-reference-contract.ts';
import { normalizeBrushMaskResourceReferenceV1 } from '../common/editor/imaging/brush-mask-resource-v1.ts';
import { readDesktopPhotoOriginalRequestCurrentV1, readDesktopPhotoOriginalTicketIdCurrentV1 } from './desktop-photo-original-contract-current-v1.ts';
import { readPhotoLibraryOriginalGroupCurrentV1 } from './controller/photo-library-original-group-contract-current-v1.ts';
import { readDesktopPhotoLibrarySessionHandleCurrentV1 } from './desktop-photo-library-session-protocol-current-v1.ts';
import { readDesktopPhotoSessionSettingsDomainCurrentV1, assertDesktopPhotoSessionSettingsValueCurrentV1 } from './desktop-photo-library-session-settings-current-v1.ts';

const TYPED = Object.getPrototypeOf(Uint8Array.prototype) as object;
const BYTE_TAG = Object.getOwnPropertyDescriptor(TYPED, Symbol.toStringTag)!.get!, BYTE_LENGTH = Object.getOwnPropertyDescriptor(TYPED, 'byteLength')!.get!;
const BYTE_BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!, RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')!.get!;
function admitUploadChunk(value: unknown): void {
	if (Reflect.apply(BYTE_TAG, value, []) !== 'Uint8Array') throw new TypeError('Desktop upload requires actual Uint8Array bytes.');
	const length = Reflect.apply(BYTE_LENGTH, value, []) as number, backing: unknown = Reflect.apply(BYTE_BUFFER, value, []);
	if (length < 1 || length > 1_048_576 || Reflect.apply(RESIZABLE, backing, []) !== false) throw new RangeError('Desktop upload requires bounded fixed private backing.');
}

export const desktopPhotoSessionRevisionCurrentV1 = (value: unknown): number => integer(value, 0, Number.MAX_SAFE_INTEGER, 'native Session revision');
export function desktopPhotoSessionShaCurrentV1(value: unknown): string {
	if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) throw new TypeError('A canonical SHA-256 is required.'); return value;
}
export function desktopPhotoSessionResourceReferenceCurrentV1(family: unknown, value: unknown) {
	if (family === 'lut') return normalizeVideoCubeLutReferenceV1(value);
	if (family !== 'brush') throw new TypeError('Unknown native resource family.');
	const input = record(value, 'brush reference', ['storageKey', 'sha256', 'width', 'height', 'byteLength']);
	const ref = normalizeBrushMaskResourceReferenceV1(field(input, 'storageKey', 'brush reference'));
	for (const key of ['storageKey', 'sha256', 'width', 'height', 'byteLength'] as const) if (field(input, key, 'brush reference') !== ref[key]) throw new TypeError('Brush reference differs from its canonical key.');
	return ref;
}
export function admitDesktopPhotoSessionDomainsCurrentV1(channel: string, p: Record<string, unknown>, catalog: string): Record<string, unknown> {
	const family = channel.slice(channel.lastIndexOf(':') + 1), op = p.operation;
	const scoped = (value: unknown) => { const photo = normalizePhotoDocumentCurrentV1(value); if (photo.catalogId !== catalog) throw new TypeError('Photo belongs to another selected catalog.'); return photo; };
	const root = (value: unknown) => { const result = readValidatedPhotoCatalogRootV1(value); if (result.id !== catalog) throw new TypeError('Root belongs to another selected catalog.'); return result; };
	for (const key of ['photoId', 'stackId', 'collectionId', 'assetId'] as const) if (Object.hasOwn(p, key)) p[key] = id(p[key], key);
	for (const key of ['expectedCatalogRevision', 'expectedPhotoRevision', 'expectedIndexRevision', 'expectedStateRevision'] as const) if (Object.hasOwn(p, key)) p[key] = desktopPhotoSessionRevisionCurrentV1(p[key]);
	for (const key of ['expectedRevision', 'expectedStackRevision'] as const) if (Object.hasOwn(p, key) && p[key] !== null) p[key] = desktopPhotoSessionRevisionCurrentV1(p[key]);
	if (family === 'catalog') {
		if (Object.hasOwn(p, 'root')) p.root = root(p.root);
		if (Object.hasOwn(p, 'photo')) p.photo = scoped(p.photo);
		if (op === 'publish') p.photos = array(p.photos, 'native published Photos', 1, 16).map(scoped);
		if (op === 'publish-derived') p.selections = capturePhotoDerivedPublicationGuardCurrentV1(catalog, p.selections, scoped(p.photo).id).selections;
		if (op === 'summaries') {
			const request = record(p.request, 'summary wire request', ['filter', 'continuation'], []);
			const scope = filterScope(catalog, request.filter as Parameters<typeof filterScope>[1]);
			if (request.continuation !== undefined && request.continuation !== null) { const c = record(request.continuation, 'summary continuation', ['catalogId', 'indexRevision', 'scope', 'afterKey']); if (c.catalogId !== catalog || c.scope !== scope) throw new TypeError('Foreign summary cursor.'); desktopPhotoSessionRevisionCurrentV1(c.indexRevision); text(c.scope, 'summary scope', 1024); text(c.afterKey, 'summary key', 1024); }
		}
		if (op === 'culling-destination') { record(p.request, 'culling wire request', ['photoId']); const r = admitPhotoCullingNavigationV1(p.context, p.request); p.context = r.context; p.request = { photoId: r.photoId }; }
	} else if (family === 'query' && Object.hasOwn(p, 'request')) {
		const q = record(p.request, 'query wire request', ['query', 'continuation'], []);
		if (op === 'read-v1') { const query = normalizePhotoCatalogQueryV1(q.query); p.request = { query, continuation: q.continuation == null ? null : readPhotoQueryContinuationV1(q.continuation, catalog, query) }; }
		else if (op === 'read-v2') p.request = admitPhotoQueryPageRequestV2(catalog, q);
		else if (op === 'collapsed-v1') { const result = admitPhotoStackQueryPageRequestV1(catalog, q); p.request = { query: result.query, continuation: result.continuation }; }
		else if (op === 'collapsed-v2') p.request = admitPhotoStackQueryPageRequestV2(catalog, q);
	} else if (family === 'stacks') {
		if (op === 'save') { const result = admitPhotoStackSaveV1(p.stack, p.expectedStackRevision); if (result.catalogId !== catalog) throw new TypeError('Foreign stack.'); p.stack = result; }
		if (op === 'page' || op === 'memberships') { record(p.request, 'stack wire request', op === 'page' ? ['continuation'] : ['continuation', 'photoIds'], []); p.request = readPhotoStackPageOptionsV1(p.request, catalog, op === 'page' ? 'stacks' : 'memberships'); }
		if (op === 'members') p.photoIds = admitPhotoStackMemberIdsV1(p.photoIds);
	} else if (family === 'saved') {
		if (op === 'save') { const result = admitPhotoSmartCollectionSaveV1(p.definition, p.expectedRevision); if (result.catalogId !== catalog) throw new TypeError('Foreign saved collection.'); p.definition = result; }
		if (op === 'page') { record(p.request, 'saved wire page', ['continuation'], []); p.request = readPhotoSmartCollectionPageOptionsV1(p.request, catalog); }
		if (op === 'snapshot' && p.selectedId !== null) p.selectedId = id(p.selectedId, 'selected saved ID');
		if (op === 'query' || op === 'collapsed-query') { record(p.request, 'saved query wire request', ['continuation'], []); const r = admitPhotoSavedQueryPageRequestV1(catalog, String(p.collectionId), op === 'query' ? 'ordinary' : 'collapsed', p.request); p.request = { continuation: r.continuation }; }
	} else if (family === 'custody') {
		if (Object.hasOwn(p, 'references')) p.references = catalogOriginalReferences(p.references);
		if (Object.hasOwn(p, 'photoIds')) p.photoIds = catalogOriginalPhotoIds(p.photoIds);
		if (Object.hasOwn(p, 'importId') && p.importId !== null) p.importId = catalogOriginalId(p.importId);
		if (Object.hasOwn(p, 'afterKey') && p.afterKey !== null) p.afterKey = text(p.afterKey, 'custody key', 2048);
		if (Object.hasOwn(p, 'afterAssetId') && p.afterAssetId !== null) p.afterAssetId = text(p.afterAssetId, 'digest cursor', 256);
		if (Object.hasOwn(p, 'sha256')) p.sha256 = desktopPhotoSessionShaCurrentV1(p.sha256);
	} else if (family === 'settings') {
		if (Object.hasOwn(p, 'domain')) p.domain = readDesktopPhotoSessionSettingsDomainCurrentV1(p.domain);
		for (const key of ['value', 'expected', 'replacement'] as const) if (Object.hasOwn(p, key)) assertDesktopPhotoSessionSettingsValueCurrentV1(p[key], catalog, p.domain);
		if (op === 'replace-and-put-if-absent') { p.intentDomain = readDesktopPhotoSessionSettingsDomainCurrentV1(p.intentDomain); if (p.intentDomain === 'import-presets' || p.domain === 'import-presets') throw new TypeError('No cross-anchor pair authority.'); assertDesktopPhotoSessionSettingsValueCurrentV1(p.intent, catalog, p.intentDomain); }
		if (p.domain === 'import-presets' && op !== 'get' && op !== 'read-entry' && op !== 'put-if-absent' && op !== 'replace-if-current') throw new TypeError('Import presets expose exactly four fixed operations.');
	} else if (family === 'upload' || family === 'cache') {
		if (op === 'write') admitUploadChunk(p.bytes);
		if (Object.hasOwn(p, 'binding')) { const result = normalizeCatalogOriginalRepairBindingV1(p.binding); if (result.catalogId !== catalog) throw new TypeError('Foreign repair catalog.'); p.binding = result; }
		if (Object.hasOwn(p, 'profile')) p.profile = normalizeBinaryDerivativeCacheProfileV1(p.profile);
		if (Object.hasOwn(p, 'identity')) p.identity = normalizeBinaryDerivativeCacheIdentityV1(p.identity, normalizeBinaryDerivativeCacheProfileV1(p.profile));
		for (const key of ['expectedSha256', 'expectedOutputSha256'] as const) if (Object.hasOwn(p, key)) p[key] = desktopPhotoSessionShaCurrentV1(p[key]);
		if (Object.hasOwn(p, 'expectedBytes')) p.expectedBytes = integer(p.expectedBytes, 0, Math.max(IMAGE_IMPORT_LIMITS.maximumFileInputBytes, IMAGE_HDR_ORIGINAL_LIMITS_V1.maximumEncodedBytes), 'expected body bytes');
		if (Object.hasOwn(p, 'sequence')) p.sequence = integer(p.sequence, 0, Number.MAX_SAFE_INTEGER, 'chunk sequence');
		if (Object.hasOwn(p, 'handle')) p.handle = readDesktopPhotoLibrarySessionHandleCurrentV1(p.handle, family === 'cache' ? 'download' : 'upload');
		if (op === 'resource-file-begin') { if (p.family !== 'lut') throw new TypeError('Only LUT files have an import profile.'); p.name = text(p.name, 'resource file name', 256); p.mimeType = text(p.mimeType, 'resource MIME', 256); if (Number(p.expectedBytes) < 1 || Number(p.expectedBytes) > 16_777_216) throw new RangeError('LUT file exceeds its fixed bound.'); }
		if (Object.hasOwn(p, 'mimeType')) p.mimeType = text(p.mimeType, 'body MIME', 256);
		if (op === 'resource-begin') p.reference = desktopPhotoSessionResourceReferenceCurrentV1(p.family, p.reference);
	} else if (family === 'resource') {
		if (p.family !== undefined && p.family !== 'lut' && p.family !== 'brush') throw new TypeError('Unknown resource family.');
		if (Object.hasOwn(p, 'reference')) p.reference = desktopPhotoSessionResourceReferenceCurrentV1(p.family, p.reference);
		if (Object.hasOwn(p, 'references')) p.references = array(p.references, 'resource references', 0, 4094).map(value => desktopPhotoSessionResourceReferenceCurrentV1(p.family, value));
		if (Object.hasOwn(p, 'photo')) p.photo = scoped(p.photo);
		if (Object.hasOwn(p, 'preset')) p.preset = normalizeImageDevelopPresetCurrentForProfileV1('current4', p.preset, 'selected');
		if (Object.hasOwn(p, 'handle')) p.handle = readDesktopPhotoLibrarySessionHandleCurrentV1(p.handle, 'resource');
	} else if (family === 'archive' || family === 'exclusive') {
		if (Object.hasOwn(p, 'handle')) p.handle = readDesktopPhotoLibrarySessionHandleCurrentV1(p.handle, family === 'archive' ? 'archive' : 'exclusive');
	} else if (family.startsWith('original-')) {
		if (family === 'original-open') { const result = readDesktopPhotoOriginalRequestCurrentV1(p.request); if (result.catalogId !== catalog) throw new TypeError('Foreign Original catalog.'); p.request = result; }
		if (family === 'original-open-group') { const plan = readPhotoLibraryOriginalGroupCurrentV1(p.requests); if (plan.requests.some(r => r.catalogId !== catalog)) throw new TypeError('Foreign group catalog.'); p.requests = plan.requests.map(readDesktopPhotoOriginalRequestCurrentV1); }
		for (const key of ['ticket', 'group'] as const) if (Object.hasOwn(p, key)) {
			const full = family === 'original-read' && key === 'ticket', input = record(p[key], 'Original ticket', full ? ['id', 'original'] : ['id']);
			const ticketId = readDesktopPhotoOriginalTicketIdCurrentV1(input);
			if (full) { const original = normalizePhotoOriginalV1(input.original); if (original.byteLength > Math.max(IMAGE_IMPORT_LIMITS.maximumFileInputBytes, IMAGE_HDR_ORIGINAL_LIMITS_V1.maximumEncodedBytes)) throw new RangeError('Native Original ticket exceeds its physical profile.'); p[key] = { id: ticketId, original }; }
			else p[key] = { id: ticketId };
		}
		if (Object.hasOwn(p, 'index')) p.index = integer(p.index, 0, 4093, 'group index');
	}
	if (Object.hasOwn(p, 'offset')) p.offset = integer(p.offset, 0, Number.MAX_SAFE_INTEGER, 'range offset');
	if (Object.hasOwn(p, 'length')) p.length = integer(p.length, 1, 1_048_576, 'range length');
	if (family === 'cancel') p.requestId = integer(p.requestId, 1, Number.MAX_SAFE_INTEGER, 'canceled request ID');
	return p;
}
