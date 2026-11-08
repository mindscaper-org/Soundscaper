/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../common/foundation/closed-domain-value.ts';
import { id } from './catalog/value-validation.ts';
import { DESKTOP_PHOTO_LIBRARY_SESSION_CHANNELS_CURRENT_V1 as channels } from './desktop-photo-library-session-protocol-current-v1.ts';
import { admitDesktopPhotoSessionDomainsCurrentV1 } from './desktop-photo-library-session-packet-domains-current-v1.ts';
import { readDesktopPhotoRawPacketCurrentV1 as rawPacket } from './desktop-photo-raw-packets-current-v1.ts';
import { readDesktopPhotoLinkedPacketCurrentV1 as linkedPacket } from './desktop-photo-linked-contract-current-v1.ts';
const CLONE = globalThis.structuredClone;
const FIELDS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
	catalog: {'create':['root'],'load':[],'load-photo':['photoId'],'publish':['expectedCatalogRevision','photos'],'publish-derived':['expectedCatalogRevision','selections','photo'],'save-photo':['photo','expectedPhotoRevision'],'save-root':['root','expectedCatalogRevision'],'summaries':['request'],'snapshot':[],'culling-destination':['context','request']},
	query: {'read-v1':['request'],'read-v2':['request'],'collapsed-v1':['request'],'collapsed-v2':['request'],'rebuild-v1':[],'rebuild-v2':[]},
	stacks: {'load':['stackId'],'state':[],'page':['request'],'memberships':['request'],'members':['stackId','expectedStackRevision','photoIds'],'save':['stack','expectedStackRevision','expectedCatalogRevision','expectedStateRevision'],'dissolve':['stackId','expectedStackRevision','expectedCatalogRevision','expectedStateRevision']},
	saved: {'load':['collectionId'],'state':[],'page':['request'],'snapshot':['selectedId'],'save':['definition','expectedRevision','expectedCatalogRevision','expectedIndexRevision','expectedStateRevision'],'delete':['collectionId','expectedRevision','expectedCatalogRevision','expectedIndexRevision','expectedStateRevision'],'query':['collectionId','request'],'collapsed-query':['collectionId','request'],'archive-context':[]},
	custody: {'retain':['references'],'stage':['importId','references'],'release':['photoIds'],'release-staged':['importId','photoIds'],'promote':['importId','photoIds'],'page':['importId','afterKey'],'digest-page':['sha256','afterAssetId'],'managed-digest-page':['sha256','afterAssetId']},
	settings: {'get':['domain'],'read-entry':['domain'],'put':['domain','value'],'delete':['domain'],'put-if-absent':['domain','value'],'replace-if-current':['domain','expected','replacement'],'delete-if-current':['domain','expected'],'replace-and-put-if-absent':['domain','expected','replacement','intentDomain','intent'],'read-import-intent':[]},
	upload: {'asset-begin':['assetId','metadata','expectedBytes','expectedSha256'],'repair-begin':['binding','expectedBytes','expectedSha256'],'cache-begin':['profile','identity','expectedOutputSha256','mimeType'],'resource-begin':['family','reference'],'resource-file-begin':['family','name','mimeType','expectedBytes','expectedSha256'],'write':['handle','sequence','offset','bytes'],'commit':['handle'],'abort':['handle'],'metadata':['assetId'],'delete-asset':['assetId'],'inspect':['binding']},
	cache: {'load':['profile','identity'],'trim':['profile'],'download':['handle','offset','length'],'close-download':['handle']},
	resource: {'open':['family','reference'],'read':['handle','offset','length'],'close':['handle'],'verify-photo':['family','photo'],'verify-preset':['family','preset'],'verify-references':['family','references']},
	archive: {'open':[],'next':['handle'],'return':['handle'],'verify':['handle']},
	exclusive: {'begin':[],'end':['handle'],'cancel':['handle']},
};
const ORIGINAL_FIELDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
	[channels.originalOpen]: ['request'], [channels.originalRead]: ['ticket', 'offset', 'length'], [channels.originalClose]: ['ticket'],
	[channels.originalOpenGroup]: ['requests'], [channels.originalReadGroup]: ['group', 'index', 'offset', 'length'], [channels.originalCloseGroup]: ['group'],
});
export type DesktopPhotoLibrarySessionPacketCurrentV1 = Readonly<Record<string, unknown>>;
/** Domain snapshots precede SEND and are repeated by Main after routing checks.
 * Fixed tables select only field grammars, never a reflected native method. */
export function readDesktopPhotoLibrarySessionPacketCurrentV1(channel: string, value: unknown, catalogId: string): DesktopPhotoLibrarySessionPacketCurrentV1 {
	const catalog = id(catalogId, 'Session catalog ID');
	if (channel === channels.linked) return linkedPacket(value, catalog);
	if ([channels.rawOpen, channels.rawRead, channels.rawClose, channels.rawInput].some(name => name === channel)) return rawPacket(channel.slice(channel.lastIndexOf(':') + 1), value, catalog);
	if (Object.hasOwn(ORIGINAL_FIELDS, channel)) {
		const input = record(value, 'native Original packet', ORIGINAL_FIELDS[channel]!);
		return Object.freeze(CLONE(admitDesktopPhotoSessionDomainsCurrentV1(channel, { ...input }, catalog)));
	}
	if (channel === channels.cancel) return Object.freeze(CLONE(admitDesktopPhotoSessionDomainsCurrentV1(channel, { ...record(value, 'native request cancellation', ['requestId']) }, catalog)));
	const family = Object.entries(channels).find(([, name]) => name === channel)?.[0];
	if (!family || !Object.hasOwn(FIELDS, family)) throw new TypeError('Unknown fixed native Session family.');
	const operation = field(value as Record<string, unknown>, 'operation', 'native Session packet');
	if (typeof operation !== 'string' || !Object.hasOwn(FIELDS[family]!, operation)) throw new TypeError('Unknown fixed native Session operation.');
	const input = record(value, 'native Session packet', ['operation', ...FIELDS[family]![operation]!]);
	return Object.freeze(CLONE(admitDesktopPhotoSessionDomainsCurrentV1(channel, { ...input }, catalog)));
}
/** Only routing/capacity selection; no nested borrowed member is touched. */
export function desktopPhotoSessionOperationCurrentV1(value: unknown): string {
	const operation = field(value as Record<string, unknown>, 'operation', 'native Session packet');
	if (typeof operation !== 'string') throw new TypeError('A fixed Session operation is required.'); return operation;
}
