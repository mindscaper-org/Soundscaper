/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import { normalizeCatalogOriginalRepairBindingV1, type CatalogOriginalRepairBindingV1 } from '../src/common/editor/storage/media-catalog-original-repair-contract.ts';
import type { CatalogOriginalInspectionOutcomeV1 } from '../src/common/editor/storage/media-catalog-original-inspection-repository.ts';
import type { LightscaperNativeOriginalStoreCurrentV1 } from './lightscaper-native-original-store-current-v1.ts';
import { readLightscaperNativeOriginalBindingCurrentV1 } from './lightscaper-native-original-index-current-v1.ts';
import { readLightscaperNativePhotoOriginalInspectionCustodyCurrentV1 as custody } from './lightscaper-native-photo-original-inspection-custody-current-v1.ts';
import { checkLightscaperNativePhotoMediaSignalCurrentV1 as check } from './lightscaper-native-photo-media-lifetime-current-v1.ts';
import { isLightscaperNativeOriginalInspectionRetirementFailureCurrentV1 as unretired } from './lightscaper-native-original-files-current-v1.ts';
import { registerLightscaperNativePhotoOriginalPinsCurrentV1 as register,
	activateLightscaperNativePhotoOriginalReadReservationCurrentV1 as activate,
	holdLightscaperNativePhotoOriginalReadReservationCurrentV1 as hold,
	type LightscaperNativePhotoOriginalReadReservationCurrentV1 as Reservation } from './lightscaper-native-photo-original-read-pins-current-v1.ts';

type Pins = ReturnType<typeof register>;
type Quarantine = Readonly<{ owner: Pins; database: DatabaseSync; originals: LightscaperNativeOriginalStoreCurrentV1;
	reservation: Readonly<Reservation> | undefined; held: Readonly<{ retire(): void }> | undefined;
	pin: Readonly<{ release(): void }> | undefined; failure: unknown }>;
// At most the existing four namespace read slots can be quarantined. Keeping
// the actual file owner also prevents GC from substituting for handle close.
const QUARANTINED = new Set<Quarantine>();

/** Owning admission happens within Media's registered capture, before its
 * queue wait; no metadata/body or invented Photo descriptor participates. */
export function captureLightscaperNativePhotoOriginalInspectionCurrentV1(value: unknown): Readonly<CatalogOriginalRepairBindingV1> {
	const binding = normalizeCatalogOriginalRepairBindingV1(value);
	readLightscaperNativeOriginalBindingCurrentV1({ storageKey: binding.assetId, byteLength: binding.size, contentSha256: binding.sha256 });
	return binding;
}

/** Genuine read-only inspection. Custody is checked before and after the
 * joined full file authentication, with no SQLite snapshot across FS IO. */
export async function inspectLightscaperNativePhotoOriginalCurrentV1(database: DatabaseSync, originals: LightscaperNativeOriginalStoreCurrentV1,
	binding: Readonly<CatalogOriginalRepairBindingV1>, signal?: AbortSignal): Promise<CatalogOriginalInspectionOutcomeV1> {
	check(signal); const owner = register(database);
	let reservation: Readonly<Reservation> | undefined, held: Readonly<{ retire(): void }> | undefined, pin: Readonly<{ release(): void }> | undefined;
	let result: CatalogOriginalInspectionOutcomeV1 | undefined, failed = false, primary: unknown;
	try {
		reservation = owner.reserve(); activate(reservation); held = hold(database, reservation);
		const before = custody(database, binding, signal);
		if (before.asset === null) result = Object.freeze({ status: 'missing', reason: 'media-row' });
		else {
			pin = owner.pin(before.asset.key, before.asset.token);
			result = await originals.inspectBinding({ storageKey: binding.assetId, byteLength: binding.size, contentSha256: binding.sha256 }, { signal });
			check(signal); const after = custody(database, binding, signal);
			if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Native Original custody or asset generation changed during inspection.');
		}
		check(signal);
	} catch (error) {
		if (unretired(error)) {
			QUARANTINED.add(Object.freeze({ owner, database, originals, reservation, held, pin, failure: error }));
			throw error;
		}
		failed = true; primary = error;
	}
	const cleanup: unknown[] = [];
	try { pin?.release(); } catch (error) { cleanup.push(error); }
	try { held?.retire(); } catch (error) { cleanup.push(error); }
	try { reservation?.release(); } catch (error) { cleanup.push(error); }
	try { await owner.close(); } catch (error) { cleanup.push(error); }
	if (cleanup.length) {
		const failure = new AggregateError([...(failed ? [primary] : []), ...cleanup], 'Native Original inspection reservation retirement failed.');
		QUARANTINED.add(Object.freeze({ owner, database, originals, reservation, held, pin, failure })); throw failure;
	}
	if (failed) throw primary;
	check(signal); return result!;
}
