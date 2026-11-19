/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { open, type FileHandle } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { parentPort, workerData } from 'node:worker_threads';
import { LightscaperNativePhotoMediaCurrentV1 as Media } from '../../desktop/lightscaper-native-photo-media-current-v1.ts';
import { deriveLightscaperNativePhotoOriginalPathsCurrentV1 as paths,
	lightscaperNativePhotoOriginalBodyPathCurrentV1 as bodyPath } from '../../desktop/lightscaper-native-original-index-current-v1.ts';
import { assertLightscaperNativePhotoOriginalUnpinnedCurrentV1 as unpinned } from '../../desktop/lightscaper-native-photo-original-read-pins-current-v1.ts';

export interface NativeInspectionQuarantineReportCurrentV1 {
	readonly causes: boolean; readonly pin: boolean; readonly capacity: boolean; readonly closeRefused: boolean;
}

async function run(): Promise<void> {
	const data: unknown = workerData;
	assert.ok(data && typeof data === 'object' && 'appDataPath' in data && typeof data.appDataPath === 'string');
	const bytes = new TextEncoder().encode('actual native quarantine body'), sha256 = createHash('sha256').update(bytes).digest('hex');
	const media = await Media.open({ appDataPath: data.appDataPath });
	await media.writeAsset('asset', new Blob([bytes]));
	await media.catalogOriginals.retain('catalog', [{ photoId: 'photo', assetId: 'asset', sourceId: 'source', sha256, size: bytes.length }]);
	const derived = paths(data.appDataPath), db = new DatabaseSync(derived.databasePath), witness = await open(bodyPath(derived, sha256), 'r');
	const stamp = await witness.stat({ bigint: true }), prototype = Object.getPrototypeOf(witness) as object;
	const descriptor = Object.getOwnPropertyDescriptor(prototype, 'stat');
	assert.ok(descriptor && typeof descriptor.value === 'function'); const nativeStat = descriptor.value as FileHandle['stat']; await witness.close();
	const primary = new Error('owned actual read receipt failure'), cleanup = new Error('owned actual handle close refusal');
	let actualClose: (() => Promise<void>) | undefined, installed = false;
	Object.defineProperty(prototype, 'stat', { ...descriptor, value: async function (this: FileHandle, ...args: unknown[]) {
		const value = await Reflect.apply(nativeStat, this, args) as Awaited<ReturnType<FileHandle['stat']>>;
		if (!installed && value.ino === stamp.ino && value.dev === stamp.dev) {
			installed = true; actualClose = this.close.bind(this); const read = this.read;
			Object.defineProperty(this, 'close', { configurable: true, value: async () => { throw cleanup; } });
			Object.defineProperty(this, 'read', { configurable: true, value: async (...params: unknown[]) => { await Reflect.apply(read, this, params); throw primary; } });
		}
		return value;
	} });
	let failure: unknown;
	try {
		await media.inspectCatalogOriginalBody({ catalogId: 'catalog', importId: null, photoId: 'photo', assetId: 'asset', sourceId: 'source',
			sha256, size: bytes.length, name: 'original.bin', mimeType: 'application/octet-stream' });
	} catch (error) { failure = error; }
	finally { Object.defineProperty(prototype, 'stat', descriptor); }
	assert.ok(failure instanceof AggregateError); assert.ok(failure.errors.includes(primary)); assert.ok(failure.errors.includes(cleanup));
	assert.throws(() => { unpinned(db, 'asset'); });
	const slots = [media.reserveOriginalRead(), media.reserveOriginalRead(), media.reserveOriginalRead()];
	try { assert.throws(() => media.reserveOriginalRead()); } finally { for (const slot of slots) slot.release(); }
	await assert.rejects(media.close()); assert.equal(typeof actualClose, 'function'); await actualClose!(); db.close();
	const report: Readonly<NativeInspectionQuarantineReportCurrentV1> = { causes: true, pin: true, capacity: true, closeRefused: true };
	parentPort?.postMessage(report);
}

try { await run(); }
catch (error) { parentPort?.postMessage({ failure: error instanceof Error ? error.stack?.slice(0, 4096) : 'Inspection quarantine failed.' }); process.exitCode = 1; }
finally { parentPort?.close(); }
