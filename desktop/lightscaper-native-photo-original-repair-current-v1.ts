/* SPDX-License-Identifier: AGPL-3.0-only */

import { realpathSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import type { CatalogOriginalRepairBindingV1, CatalogOriginalRepairReceiptV1 } from '../src/common/editor/storage/media-catalog-original-repair-contract.ts';
import { captureLightscaperNativePhotoOriginalInspectionCurrentV1 as captureBinding } from './lightscaper-native-photo-original-inspection-current-v1.ts';
import { captureLightscaperNativePhotoMediaWriteCurrentV1 as captureWrite, readLightscaperNativePhotoMediaWriteCurrentV1 as readWrite,
	digestLightscaperNativePhotoMediaWriteCurrentV1 as digest, lightscaperNativePhotoMediaWriteChunksCurrentV1 as chunks,
	type LightscaperNativePhotoMediaWriteCurrentV1 as Write } from './lightscaper-native-photo-media-blob-current-v1.ts';
import { retireLightscaperNativeOriginalRepairPublicationCurrentV1 as retireProof,
	type LightscaperNativeOriginalStoreCurrentV1 as Originals } from './lightscaper-native-original-store-current-v1.ts';
import { readLightscaperNativePhotoOriginalRepairStateCurrentV1 as state } from './lightscaper-native-photo-original-repair-custody-current-v1.ts';
import { publishLightscaperNativePhotoOriginalRepairCurrentV1 as publish } from './lightscaper-native-photo-original-repair-publication-current-v1.ts';
import { registerLightscaperNativePhotoOriginalPinsCurrentV1 as register } from './lightscaper-native-photo-original-read-pins-current-v1.ts';
import { checkLightscaperNativePhotoMediaSignalCurrentV1 as check } from './lightscaper-native-photo-media-lifetime-current-v1.ts';
import { rollbackLightscaperNativePhotoOriginalRepairCurrentV1 as rollback,
	hasLightscaperNativePhotoOriginalRepairRetirementFailureCurrentV1 as unretired } from './lightscaper-native-photo-original-repair-retirement-current-v1.ts';

type Capture = Readonly<object>;
type Captured = { readonly binding: Readonly<CatalogOriginalRepairBindingV1>; readonly write: Write; readonly key: string; readonly database: DatabaseSync; retired: boolean; quarantined: boolean };
const captures = new WeakMap<object, Captured>();
const repairing = new Set<string>();
const QUARANTINED = new Set<object>();

/** Registered by Media before native Blob/record capture. No body read is
 * admitted here; hashing happens only under the namespace repair admission. */
export async function captureLightscaperNativePhotoOriginalRepairCurrentV1(db: DatabaseSync, value: unknown, selected: unknown): Promise<Capture> {
	const file = db.prepare('PRAGMA database_list').get()?.file;
	if (typeof file !== 'string' || !file) throw new Error('Native Original repair requires its actual file-backed namespace.');
	const canonical = realpathSync.native(file), key = process.platform === 'win32' ? canonical.toLowerCase() : canonical;
	if (repairing.has(key)) throw new Error('Native Original repair capacity is busy.');
	repairing.add(key);
	try {
		const binding = captureBinding(value);
		const write = await captureWrite(binding.assetId, selected, { name: binding.name, mimeType: binding.mimeType });
		if (readWrite(write).size !== binding.size) throw new Error('Selected native Original repair body has the wrong byte length.');
		const token = Object.freeze({}); captures.set(token, { binding, write, key, database: db, retired: false, quarantined: false }); return token;
	} catch (error) { repairing.delete(key); throw error; }
}

/** Called only after Media's registered work (including capture) has settled.
 * This retires admission, never a physical locator or its durable debt. */
export function retireLightscaperNativePhotoOriginalRepairCaptureCurrentV1(value: Capture): void {
	const captured = captures.get(value);
	if (!captured) throw new TypeError('Native Original repair retirement requires its genuine capture.');
	if (captured.retired || captured.quarantined) return;
	captured.retired = true; repairing.delete(captured.key);
}

export async function restoreLightscaperNativePhotoOriginalCurrentV1(db: DatabaseSync, originals: Originals,
	captured: Capture, signal?: AbortSignal): Promise<Readonly<CatalogOriginalRepairReceiptV1>> {
	check(signal);
	let owner: ReturnType<typeof register> | undefined, pin: Readonly<{ release(): void }> | undefined, proof: unknown;
	let failed = false, primary: unknown, result: Readonly<CatalogOriginalRepairReceiptV1> | undefined;
	try {
		if (db.isTransaction) throw new Error('Native Original repair requires no unsettled transaction.');
		const input = captures.get(captured);
		if (!input || input.retired || input.quarantined || input.database !== db) throw new TypeError('Native Original repair requires its genuine admitted namespace capture.');
		const { binding, write } = input;
		db.exec('BEGIN');
		let before;
		try { before = state(db, binding, signal); db.exec('COMMIT'); }
		catch (error) { rollback(db, error); throw error; }
		owner = register(db); pin = owner.pin(binding.assetId, before.root.mediaContentToken);
		const actual = await digest(write, signal);
		if (actual.contentSha256 !== binding.sha256 || actual.byteLength !== binding.size) throw new Error('Selected native Original repair bytes do not match retained custody.');
		proof = await originals.prepareRepairBinding(actual, chunks(write, signal), { signal, expectedHead: before.head });
		result = publish(db, binding, before, write, proof, signal);
	} catch (error) {
		if (unretired(db)) {
			const input = captures.get(captured); if (input) input.quarantined = true;
			QUARANTINED.add(Object.freeze({ database: db, originals, captured, owner, pin, proof, failure: error }));
			throw error;
		}
		failed = true; primary = error;
	}
	const cleanup: unknown[] = [];
	try { if (proof !== undefined) retireProof(proof); } catch (error) { cleanup.push(error); }
	try { pin?.release(); } catch (error) { cleanup.push(error); }
	try { await owner?.close(); } catch (error) { cleanup.push(error); }
	if (cleanup.length) throw new AggregateError([...(failed ? [primary] : []), ...cleanup], 'Native Original repair retirement failed.', { cause: failed ? primary : cleanup[0] });
	if (failed) throw primary;
	// Publication owns its ACK. Cancellation after the actual COMMIT cannot
	// turn success into a claim that the repair rolled back.
	return result!;
}
