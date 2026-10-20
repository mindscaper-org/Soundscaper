/* SPDX-License-Identifier: AGPL-3.0-only */

import { LightscaperNativePhotoRawPartsCurrentV1 as RawParts } from './lightscaper-native-photo-raw-parts-current-v1.ts';
import { types } from 'node:util';
import type { LightscaperNativePhotoLibraryServicesCurrentV1 as Services } from './lightscaper-native-photo-library-services-current-v1.ts';
import { openLightscaperNativePhotoLinkedComponentsCurrentV1 as openLinked, type LightscaperNativePhotoLinkedComponentsCurrentV1 as Linked } from './lightscaper-native-photo-linked-components-current-v1.ts';
import { verifyPhotoResourcesCurrentV1 } from '../src/lightscaper/storage/photo-media-resource-verification-current-v1.ts';
import { LightscaperNativeCatalogStoreCurrentV1 as Catalog } from './lightscaper-native-catalog-store-current-v1.ts';
import { LightscaperNativePhotoMediaCurrentV1 as Media } from './lightscaper-native-photo-media-current-v1.ts';
import { LightscaperNativePhotoResourcesCurrentV1 as Resources } from './lightscaper-native-photo-resources-current-v1.ts';
import { LightscaperNativePhotoSettingsCurrentV1 as Settings } from './lightscaper-native-photo-settings-current-v1.ts';
import { LightscaperNativePhotoOriginalsCurrentV1 as Originals } from './lightscaper-native-photo-originals-current-v1.ts';
import { LightscaperNativePhotoOriginalTicketsCurrentV1 as OriginalTickets } from './lightscaper-native-photo-original-tickets-current-v1.ts';
import { checkLightscaperNativePhotoMediaSignalCurrentV1 as check } from './lightscaper-native-photo-media-lifetime-current-v1.ts';

export interface LightscaperNativePhotoLibraryComponentsCurrentV1 {
	readonly rawParts?: RawParts;
	readonly linked?: Readonly<Linked>;
	readonly catalog: Catalog;
	readonly media: Media;
	readonly resources: Resources;
	readonly settings: Settings;
	readonly originals: Originals;
	readonly originalTickets: OriginalTickets;
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
	unretired: () => void, scope: Readonly<{ signal: AbortSignal; assertCurrent(): void }>, services: Readonly<Services> = {}): Promise<Readonly<LightscaperNativePhotoLibraryComponentsCurrentV1>> {
	const dependents: Array<() => Promise<void>> = [];
	let retireRaw: (() => Promise<void>) | undefined;
	let retireLinked: (() => Promise<void>) | undefined, retireCatalog: (() => Promise<void>) | undefined;
	let retireResources: (() => Promise<void>) | undefined, retireOriginals: (() => Promise<void>) | undefined, retireTickets: (() => Promise<void>) | undefined;
	let quiesceWriters: (() => Promise<void>) | undefined, closing: Promise<void> | undefined;
	const close = (): Promise<void> => {
		if (closing) return closing;
		let resolve!: () => void, reject!: (error: unknown) => void;
		closing = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; });
		const start = (retire: (() => Promise<void>) | undefined): Promise<void> => {
			try { return (retire?.() ?? Promise.resolve()).catch((error: unknown) => { unretired(); throw error; }); }
			catch (error) { unretired(); return Promise.reject(error); }
		};
		// An idle writer can own the OriginalStore queue ahead of a read. Start
		// cancellation before joining readers, while retaining physical owners.
		// Tickets own reader callbacks. Fence and release them before starting
		// reader retirement; all three physical barriers join before children.
		const writers = start(quiesceWriters), raw = start(retireRaw);
		void Promise.allSettled([writers, raw]).then(async owned => {
			const rawResult = owned[1]!;
			if (rawResult.status === 'rejected') throw new AggregateError(owned.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []), 'Native RAW component retirement is unproved; dependent physical owners retained.');
			const initial = await Promise.allSettled([writers, start(retireTickets), start(retireOriginals)]);
			const failures = initial.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
			const catalogResult=await Promise.allSettled([start(retireCatalog)]);failures.push(...catalogResult.flatMap(value=>value.status==='rejected'?[value.reason as unknown]:[]));
			try{await retireLinked?.();}catch(error){unretired();failures.push(error);}
			const results = await Promise.allSettled(dependents.map(retire => start(retire)));
			failures.push(...results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []));
			try { await retireResources?.(); } catch (error) { failures.push(error); }
			if (failures.length) { unretired(); throw new AggregateError(failures, 'Native library component retirement is unproved.'); }
		}).then(resolve, reject);
		return closing;
	};
	try {
		check(signal); const resources = await openLightscaperNativePhotoLibraryOwnerCurrentV1(() => Resources.open({ appDataPath }), unretired);
		const resourceClose = resources.close; retireResources = () => Reflect.apply(resourceClose, resources, []); check(signal);
		const media = await openLightscaperNativePhotoLibraryOwnerCurrentV1(() => Media.open({ appDataPath }), unretired), mediaClose = media.close;
		const mediaQuiesce = media.quiesceEscapedWritersCurrentV1; quiesceWriters = () => Reflect.apply(mediaQuiesce, media, []);
		dependents.push(() => Reflect.apply(mediaClose, media, [])); const bindLinked=media.bindLinkedOriginalsCurrentV1;check(signal);
		const linked=await openLinked(appDataPath,services,scope,unretired);if(linked){const retire=linked.close;retireLinked=()=>Reflect.apply(retire,linked,[]);check(signal);Reflect.apply(bindLinked,media,[linked.originals]);}check(signal);
		const settings = await openLightscaperNativePhotoLibraryOwnerCurrentV1(() => Settings.open({ appDataPath, scope: 'selected:library' }), unretired), settingsClose = settings.close;
		dependents.push(() => Reflect.apply(settingsClose, settings, [])); check(signal);
		const catalog = await openLightscaperNativePhotoLibraryOwnerCurrentV1(() => Catalog.open({ appDataPath,
			verifyResources: (photo, selected) => verifyPhotoResourcesCurrentV1(photo, resources, selected), ...(linked?{linkedOriginals:linked.originals}:{}) }), unretired);
		const catalogClose = catalog.close; retireCatalog=() => Reflect.apply(catalogClose, catalog, []); check(signal);
		linked?.bindCatalog(catalog);check(signal);
		const originals = Originals.create({ catalog, media, settings, scope }), originalsClose = originals.close;
		retireOriginals = () => Reflect.apply(originalsClose, originals, []); check(signal);
		const originalTickets = OriginalTickets.create({ originals, scope, unretired }), ticketsClose = originalTickets.close;
		retireTickets = () => Reflect.apply(ticketsClose, originalTickets, []); check(signal);
		const rawParts = services.prepareRaw ? RawParts.create({ catalog, originals, prepare: services.prepareRaw, scope, unretired }) : undefined;
		if (rawParts) { const retire = rawParts.close; retireRaw = () => Reflect.apply(retire, rawParts, []); } check(signal);
		return Object.freeze({ ...(rawParts ? { rawParts } : {}), ...(linked?{linked}:{}), catalog, media, resources, settings, originals, originalTickets, close });
	} catch (primary) {
		try { await close(); }
		catch (cleanup) { throw new AggregateError([primary, cleanup], 'Native library component opening and retirement failed.', { cause: cleanup }); }
		throw primary;
	}
}
