/* SPDX-License-Identifier: AGPL-3.0-only */

import { types } from 'node:util';
import { verifyPhotoResourcesCurrentV1 } from '../src/lightscaper/storage/photo-media-resource-verification-current-v1.ts';
import { LightscaperNativeCatalogStoreCurrentV1 as Catalog } from './lightscaper-native-catalog-store-current-v1.ts';
import { LightscaperNativePhotoMediaCurrentV1 as Media } from './lightscaper-native-photo-media-current-v1.ts';
import { LightscaperNativePhotoResourcesCurrentV1 as Resources } from './lightscaper-native-photo-resources-current-v1.ts';
import { LightscaperNativePhotoSettingsCurrentV1 as Settings } from './lightscaper-native-photo-settings-current-v1.ts';
import { checkLightscaperNativePhotoMediaSignalCurrentV1 as check } from './lightscaper-native-photo-media-lifetime-current-v1.ts';

export interface LightscaperNativePhotoLibraryComponentsCurrentV1 {
	readonly catalog: Catalog;
	readonly media: Media;
	readonly resources: Resources;
	readonly settings: Settings;
	close(): Promise<void>;
}

/** Only fresh main-owned static constructors enter this boundary. Their native
 * AggregateError signals combined opening/retirement failure before an owner
 * can be returned. Conservatively retain exclusion without reading its causes.
 * Caller signal checks stay outside this boundary; opaque reasons stay opaque. */
export async function openLightscaperNativePhotoLibraryOwnerCurrentV1<Owner>(run: () => Promise<Owner>, unretired: () => void): Promise<Owner> {
	try { return await run(); }
	catch (error) {
		if (types.isNativeError(error) && Object.getOwnPropertyDescriptor(error, 'errors') !== undefined) unretired();
		throw error;
	}
}

/** Actual same-generation owners. Capture each retirement before vending any
 * child, so replacing a public close property cannot retarget parent cleanup.
 * Catalog users retire before resources; every partial open is joined too. */
export async function openLightscaperNativePhotoLibraryComponentsCurrentV1(appDataPath: string, signal: AbortSignal,
	unretired: () => void): Promise<Readonly<LightscaperNativePhotoLibraryComponentsCurrentV1>> {
	const dependents: Array<() => Promise<void>> = [];
	let retireResources: (() => Promise<void>) | undefined, closing: Promise<void> | undefined;
	const close = (): Promise<void> => {
		if (closing) return closing;
		closing = Promise.resolve().then(async () => {
			const results = await Promise.allSettled(dependents.map(retire => Promise.resolve().then(retire)));
			const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
			try { await retireResources?.(); } catch (error) { failures.push(error); }
			if (failures.length) { unretired(); throw new AggregateError(failures, 'Native library component retirement is unproved.'); }
		});
		return closing;
	};
	try {
		check(signal); const resources = await openLightscaperNativePhotoLibraryOwnerCurrentV1(() => Resources.open({ appDataPath }), unretired);
		const resourceClose = resources.close; retireResources = () => Reflect.apply(resourceClose, resources, []); check(signal);
		const media = await openLightscaperNativePhotoLibraryOwnerCurrentV1(() => Media.open({ appDataPath }), unretired), mediaClose = media.close;
		dependents.push(() => Reflect.apply(mediaClose, media, [])); check(signal);
		const settings = await openLightscaperNativePhotoLibraryOwnerCurrentV1(() => Settings.open({ appDataPath, scope: 'selected:library' }), unretired), settingsClose = settings.close;
		dependents.push(() => Reflect.apply(settingsClose, settings, [])); check(signal);
		const catalog = await openLightscaperNativePhotoLibraryOwnerCurrentV1(() => Catalog.open({ appDataPath,
			verifyResources: (photo, selected) => verifyPhotoResourcesCurrentV1(photo, resources, selected) }), unretired);
		const catalogClose = catalog.close; dependents.push(() => Reflect.apply(catalogClose, catalog, [])); check(signal);
		return Object.freeze({ catalog, media, resources, settings, close });
	} catch (primary) {
		try { await close(); }
		catch (cleanup) { throw new AggregateError([primary, cleanup], 'Native library component opening and retirement failed.', { cause: cleanup }); }
		throw primary;
	}
}
