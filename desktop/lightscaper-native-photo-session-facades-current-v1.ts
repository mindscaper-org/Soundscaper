/* SPDX-License-Identifier: AGPL-3.0-only */

import type { LightscaperNativePhotoLibraryComponentsCurrentV1 as Components } from './lightscaper-native-photo-library-components-current-v1.ts';
import type { LightscaperNativePhotoSessionCallsCurrentV1 as Calls } from './lightscaper-native-photo-session-calls-current-v1.ts';
import { captureLightscaperNativePhotoSessionArchiveCurrentV1 as archive, captureLightscaperNativePhotoSessionWriterCurrentV1 as writer } from './lightscaper-native-photo-session-escaped-current-v1.ts';

type Catalog = Omit<Pick<Components['catalog'], keyof Components['catalog']>, 'close' | 'storeOriginal' | 'readOriginal'>;
type Media = Pick<Components['media'], 'writeAsset' | 'beginAssetWrite' | 'getAssetMetadata' | 'deleteAsset'
	| 'inspectCatalogOriginalBody' | 'restoreCatalogOriginalBody' | 'catalogOriginals' | 'createBinaryDerivativeCache'>;
export interface LightscaperNativePhotoSessionComponentsCurrentV1 {
	readonly catalog: Readonly<Catalog>;
	readonly media: Readonly<Media>;
	readonly settings: Readonly<Pick<Components['settings'], 'settingsRepository' | 'readImportIntentCurrentV1'>>;
	readonly resources: Readonly<Pick<Components['resources'], 'cubeLutResources' | 'maskRasterResources'>>;
	readonly originals: Readonly<Pick<Components['originals'], 'withOriginal' | 'withOriginalGroup'>>;
	readonly originalTickets: Readonly<Pick<Components['originalTickets'], 'transport'>>;
	close(): Promise<void>;
}
const CATALOG = ['createCatalog', 'loadCatalog', 'loadPhoto', 'publishPhotos', 'publishDerivedPhotoCurrentV1', 'savePhoto', 'saveCatalog',
	'readSummaryPage', 'readCullingDestinationPage', 'readSnapshot', 'readQueryPage', 'readQueryPageV2', 'readStackQueryPage', 'readStackQueryPageV2',
	'rebuildQueryIndexPage', 'rebuildQueryIndexPageV2', 'loadStack', 'readStackState', 'readStackPage', 'readStackMembershipPage', 'readStackMemberPage',
	'saveStack', 'dissolveStack', 'loadSmartCollection', 'readSmartCollectionState', 'readSmartCollectionPage', 'readSmartCollectionSnapshotV1',
	'saveSmartCollection', 'deleteSmartCollection', 'readSmartCollectionQueryPageV1', 'readSmartCollectionStackQueryPageV1',
	'readSmartCollectionArchiveContextV1'] as const satisfies readonly (keyof Catalog)[];

/** Every escaped capability captures its actual receiver before vending.
 * Physical-only pin allocation, raw stores, owner close and anchor authority
 * stay inside Main; the complete Current Session storage ports are present. */
export function createLightscaperNativePhotoSessionFacadesCurrentV1(actual: Readonly<Components>, calls: Calls,
	close: () => Promise<void>): Readonly<LightscaperNativePhotoSessionComponentsCurrentV1> {
	const captureArchive = actual.catalog.captureSmartCollectionArchiveV1;
	const begin = actual.media.beginAssetWrite, createCache = actual.media.createBinaryDerivativeCache;
	const cube = actual.resources.cubeLutResources, brush = actual.resources.maskRasterResources;
	return Object.freeze({
		catalog: Object.freeze({ ...methods(actual.catalog, CATALOG, calls), captureSmartCollectionArchiveV1: (...args: Parameters<typeof captureArchive>) =>
			calls.run(async () => archive(await Reflect.apply(captureArchive, actual.catalog, args), calls)) }),
		media: Object.freeze({ ...methods(actual.media, ['writeAsset', 'getAssetMetadata', 'deleteAsset', 'inspectCatalogOriginalBody', 'restoreCatalogOriginalBody'], calls),
			catalogOriginals: methods(actual.media.catalogOriginals, ['retain', 'stage', 'release', 'releaseStaged', 'promote', 'readPage', 'findDigestPage'], calls),
			beginAssetWrite: (...args: Parameters<typeof begin>) => calls.run(async () => writer(await Reflect.apply(begin, actual.media, args), calls)),
			createBinaryDerivativeCache: (...args: Parameters<typeof createCache>) => calls.sync(() => {
				const cache = Reflect.apply(createCache, actual.media, args);
				return methods(cache, ['load', 'store', 'trim'], calls);
			}) }),
		settings: Object.freeze({ ...methods(actual.settings, ['readImportIntentCurrentV1'], calls),
			settingsRepository: methods(actual.settings.settingsRepository, ['get', 'readEntry', 'put', 'delete', 'putIfAbsent', 'replaceIfCurrent',
				'deleteIfCurrent', 'replaceIfCurrentAndPutIfAbsent'], calls) }),
		resources: Object.freeze({ cubeLutResources: () => calls.run(async () => {
			const family = await Reflect.apply(cube, actual.resources, []);
			return Object.freeze({ ...methods(family, ['put', 'importFile', 'verifyPhoto', 'verifyPreset', 'verifyReferencesV1'], calls),
				source: methods(family.source, ['withBytes'], calls) });
		}), maskRasterResources: () => calls.run(async () => {
			const family = await Reflect.apply(brush, actual.resources, []);
			return Object.freeze({ ...methods(family, ['put', 'verifyPhoto', 'verifyPreset', 'verifyReferencesV1'], calls),
				source: methods(family.source, ['withBytes'], calls) });
		}) }),
		originals: methods(actual.originals, ['withOriginal', 'withOriginalGroup'], calls),
		originalTickets: Object.freeze({ transport: Object.freeze({
			...methods(actual.originalTickets.transport, ['open', 'read', 'openGroup', 'readGroup'], calls),
			...methods(actual.originalTickets.transport, ['close', 'closeGroup'], calls, true),
		}) }), close,
	});
}

function methods<Owner extends object, Key extends keyof Owner>(owner: Owner, names: readonly Key[], calls: Calls, cleanup = false): Readonly<Pick<Owner, Key>> {
	const facade: Partial<Record<Key, unknown>> = {};
	for (const key of names) {
		const method = owner[key];
		if (typeof method !== 'function') throw new TypeError('Native Session storage capability is incomplete.');
		facade[key] = (...args: unknown[]) => calls.run(() => Reflect.apply(method, owner, args) as unknown, cleanup);
	}
	return Object.freeze(facade) as Readonly<Pick<Owner, Key>>;
}
